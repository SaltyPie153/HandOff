import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const { AgentKeyStore } = await import('../dist/src/admin/agent-key.store.js');

test('server key persists across store instances and never appears in status', async () => {
  const secretDir = await mkdtemp(join(tmpdir(), 'handoff-agent-key-'));
  const first = new AgentKeyStore({ nodeEnv: 'test', secretDir });
  await first.save('sk-test-secret-value');
  const second = new AgentKeyStore({ nodeEnv: 'test', secretDir });
  const current = await second.read();
  assert.equal(current.key, 'sk-test-secret-value');
  assert.equal(current.configured, true);
  assert.equal(current.source, 'file');
  assert.ok(current.generation);
  if (process.platform !== 'win32') {
    assert.equal((await stat(secretDir)).mode & 0o777, 0o700);
    assert.equal((await stat(join(secretDir, 'agent-key.json'))).mode & 0o777, 0o600);
  }
});

test('disable records a tombstone and masks the environment key after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'handoff-agent-key-'));
  const secretDir = join(root, 'secrets');
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-env-fallback';
  try {
    const store = new AgentKeyStore({ nodeEnv: 'test', secretDir });
    assert.equal((await store.read()).source, 'environment');
    await store.disable();
    assert.equal((await new AgentKeyStore({ nodeEnv: 'test', secretDir }).read()).configured, false);
    assert.equal((await store.read()).source, 'disabled');
    assert.equal((await store.read()).key, undefined);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test('invalid key is rejected without changing the stored key or echoing the input', async () => {
  const secretDir = await mkdtemp(join(tmpdir(), 'handoff-agent-key-'));
  const store = new AgentKeyStore({ nodeEnv: 'test', secretDir });
  await store.save('sk-good-value');
  const bad = 'sk-bad\nSECRET-NEVER-ECHO';
  await assert.rejects(store.save(bad), error => !String(error).includes('SECRET-NEVER-ECHO'));
  assert.equal((await store.read()).key, 'sk-good-value');
});

test('malformed file fails closed instead of using environment key', async () => {
  const secretDir = await mkdtemp(join(tmpdir(), 'handoff-agent-key-'));
  const store = new AgentKeyStore({ nodeEnv: 'test', secretDir });
  await store.save('sk-good-value');
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-env-fallback';
  try {
    await writeFile(join(secretDir, 'agent-key.json'), '{bad json');
    await assert.rejects(store.read());
    assert.equal((await readFile(join(secretDir, 'agent-key.json'), 'utf8')).includes('sk-env-fallback'), false);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test('production rejects relative secret directory', async () => {
  assert.throws(() => new AgentKeyStore({ nodeEnv: 'production', secretDir: 'work/server-secrets' }));
});

test('custom secret directory cannot be placed in Git or web paths', () => {
  const root = join(tmpdir(), 'handoff-boundary');
  assert.throws(() => new AgentKeyStore({ nodeEnv: 'development', workRoot: root, secretDir: join(root, 'docs', 'keys') }));
  assert.throws(() => new AgentKeyStore({ nodeEnv: 'development', workRoot: root, secretDir: join(root, 'apps', 'web', 'public', 'secrets') }));
  assert.throws(() => new AgentKeyStore({ nodeEnv: 'production', workRoot: root, secretDir: join(root, '..secrets') }));
  assert.doesNotThrow(() => new AgentKeyStore({ nodeEnv: 'development', workRoot: root, secretDir: join(root, 'work', 'keys') }));
});

test('API launched from apps/api keeps the default key under repository work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'handoff-agent-root-'));
  const api = join(root, 'apps', 'api');
  await mkdir(api, { recursive: true });
  const previousCwd = process.cwd();
  const previousDir = process.env.HANDOFF_SECRET_DIR;
  delete process.env.HANDOFF_SECRET_DIR;
  try {
    process.chdir(api);
    const { HandoffModule } = await import('../dist/src/handoff/handoff.module.js');
    const module = HandoffModule.register({ nodeEnv: 'development' });
    const provider = module.providers.find(item => item.provide === AgentKeyStore);
    const store = provider.useFactory();
    await store.save('sk-fake-root-key');
    assert.equal((await stat(join(root, 'work', 'server-secrets', 'agent-key.json'))).isFile(), true);
  } finally {
    process.chdir(previousCwd);
    if (previousDir !== undefined) process.env.HANDOFF_SECRET_DIR = previousDir;
    assert.ok(root.startsWith(join(tmpdir(), 'handoff-agent-root-')));
    await rm(root, { recursive: true, force: true });
  }
});
