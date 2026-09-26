import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanupSteps,
  cleanApiBuild,
  discoverIntegrationTests,
  requireFreePorts,
  runCommand,
  runFoundationDatabaseTest
} from '../test-integration.mjs';

test('integration discovery includes newly built health integration tests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-discovery-'));
  try {
    for (const name of ['startup.test.js', 'health.contract.test.js', 'health.integration.test.js']) {
      await writeFile(join(dir, name), '');
    }
    assert.deepEqual(await discoverIntegrationTests(dir), [
      join(dir, 'health.contract.test.js'),
      join(dir, 'health.integration.test.js')
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stale integration output is removed before discovery without deleting source files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-clean-build-'));
  const apiRoot = join(dir, 'apps', 'api');
  const dist = join(apiRoot, 'dist');
  const testDir = join(dist, 'tests');
  const stale = join(testDir, 'deleted.integration.test.js');
  const source = join(apiRoot, 'src', 'keep.ts');
  try {
    await mkdir(testDir, { recursive: true });
    await mkdir(join(apiRoot, 'src'), { recursive: true });
    await writeFile(stale, 'stale');
    await writeFile(source, 'keep');
    await cleanApiBuild(dist, apiRoot);
    await assert.rejects(access(stale), { code: 'ENOENT' });
    await mkdir(testDir, { recursive: true });
    const contract = join(testDir, 'health.contract.test.js');
    await writeFile(contract, 'current build');
    assert.deepEqual(await discoverIntegrationTests(testDir), [contract]);
    assert.equal(await readFile(source, 'utf8'), 'keep');
    await assert.rejects(cleanApiBuild(join(dir, 'other', 'dist'), apiRoot), /UNSAFE_BUILD_DIRECTORY/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('failed database setup child gets exact project cleanup and preserves both failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-foundation-child-'));
  const script = join(dir, 'fail.mjs');
  const pidFile = join(dir, 'pid');
  const projects = [];
  try {
    await writeFile(script, `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2], String(process.pid));\nprocess.exit(7);\n`);
    await assert.rejects(runFoundationDatabaseTest({
      testCommand: process.execPath,
      testArgs: [script, pidFile],
      downProject: async project => { projects.push(project); throw new Error('private'); }
    }), error => error.message ===
      'DATABASE_SETUP_TEST_FAILED: EXIT_7; CLEANUP_FAILED: FOUNDATION_DATABASE');
    assert.deepEqual(projects, [`handoff-foundation-${await readFile(pidFile, 'utf8')}`]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('command failure keeps child output and secrets out of diagnostics', async () => {
  const secret = 'runner-private-test-value';
  await assert.rejects(
    runCommand(process.execPath, ['-e', `process.stderr.write('${secret}'); process.exit(7)`], {
      label: 'SAMPLE', timeoutMs: 5_000
    }),
    error => error.message === 'SAMPLE_FAILED: EXIT_7' && !error.message.includes(secret)
  );
});

test('cleanup runs in reverse order and reports a failed step', async () => {
  const order = [];
  await assert.rejects(cleanupSteps([
    ['database', async () => { order.push('database'); }],
    ['api', async () => { order.push('api'); throw new Error('secret'); }],
    ['web', async () => { order.push('web'); }]
  ]), /CLEANUP_FAILED: API/);
  assert.deepEqual(order, ['web', 'api', 'database']);
});

test('occupied port is reported without closing its listener', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await assert.rejects(requireFreePorts([['WEB_PORT', address.port]]), /PORT_IN_USE: WEB_PORT/);
    assert.equal(server.listening, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
