import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const apiLauncher = fileURLToPath(new URL('../dev-api.mjs', import.meta.url));
const viteCli = fileURLToPath(new URL('../../apps/web/node_modules/vite/bin/vite.js', import.meta.url));
const webRoot = join(root, 'apps', 'web');
const host = '127.0.0.1';
const maxOutput = 65536;

function withDeadline(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded its cleanup deadline`)), timeoutMs);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

async function closeServer(server) {
  await withDeadline(new Promise((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())
  ), 2000, 'fixture server close');
}

async function cleanupIndependently(steps) {
  const failed = [];
  for (const [name, step] of steps) {
    try { await step(); } catch { failed.push(name); }
  }
  assert.deepEqual(failed, [], 'test resources failed to close');
}

async function listen() {
  const server = createServer(socket => {
    socket.on('error', () => undefined);
    socket.end('fixture');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  return server;
}

function portOf(server) {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function fixturePorts(occupied) {
  const other = await listen();
  let second;
  try {
    second = await listen();
    return [portOf(occupied), portOf(other), portOf(second)];
  } finally {
    await cleanupIndependently(
      [other, second].filter(Boolean).map(server => ['reserved port', () => closeServer(server)])
    );
  }
}

function envText(apiPort, webPort, dbPort, secret) {
  return [
    'NODE_ENV=test', `API_PORT=${apiPort}`, `WEB_PORT=${webPort}`, `DB_PORT=${dbPort}`,
    'POSTGRES_USER=handoff', `POSTGRES_PASSWORD=${secret}`, 'POSTGRES_DB=handoff_test',
    `DATABASE_URL=postgresql://handoff:${secret}@${host}:${dbPort}/handoff_test`, ''
  ].join('\n');
}

function isolatedEnvironment() {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function start(script, cwd, envPath) {
  const child = spawn(process.execPath, [`--env-file=${envPath}`, script], {
    cwd, env: isolatedEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = { stdout: '', stderr: '', overflow: false };
  child.stdout?.on('data', chunk => {
    const next = output.stdout + chunk.toString();
    if (next.length > maxOutput) output.overflow = true;
    output.stdout = next.slice(0, maxOutput);
  });
  child.stderr?.on('data', chunk => {
    const next = output.stderr + chunk.toString();
    if (next.length > maxOutput) output.overflow = true;
    output.stderr = next.slice(0, maxOutput);
  });
  return { child, output: () => output };
}

function waitForClose(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('development process did not exit after its port conflict')); }, timeoutMs);
    const onClose = code => { cleanup(); resolve(code); };
    const onError = error => { cleanup(); reject(error); };
    const cleanup = () => {
      clearTimeout(timer);
      child.off('close', onClose);
      child.off('error', onError);
    };
    child.once('close', onClose);
    child.once('error', onError);
  });
}

async function stopCandidate(child) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  let taskkillFailed = false;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    try {
      await waitForClose(killer, 2000);
    } catch {
      taskkillFailed = true;
      killer.kill('SIGKILL');
      await waitForClose(killer, 1000).catch(() => undefined);
    }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  } else {
    child.kill('SIGTERM');
  }
  await waitForClose(child, 3000);
  assert.equal(taskkillFailed, false, 'taskkill failed or exceeded its cleanup deadline');
}

function canConnect(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

function assertOnlyDiagnostic(output, secret, expected) {
  assert.equal(output.overflow, false, 'development process exceeded the diagnostic capture limit');
  assert.ok(!output.stdout.includes(secret) && !output.stderr.includes(secret), 'port conflict exposed the test password');
  assert.ok(!output.stdout.includes('postgresql://') && !output.stderr.includes('postgresql://'), 'port conflict exposed a database URL');
  const line = [expected, `${expected}\n`, `${expected}\r\n`];
  assert.ok(
    (output.stdout === '' && line.includes(output.stderr)) ||
    (output.stderr === '' && line.includes(output.stdout)),
    `development process must emit only the fixed diagnostic ${expected}`
  );
}

test('dev:api reports an occupied API port, exits, and leaves the occupant alive', { timeout: 20_000 }, async () => {
  const occupant = await listen();
  let dir;
  let running;
  try {
    const [apiPort, webPort, dbPort] = await fixturePorts(occupant);
    dir = await mkdtemp(join(tmpdir(), 'handoff-dev-api-test-'));
    const envPath = join(dir, '.env');
    const secret = randomBytes(18).toString('hex');
    await writeFile(envPath, envText(apiPort, webPort, dbPort, secret), { mode: 0o600 });
    running = start(apiLauncher, root, envPath);
    assert.equal(await waitForClose(running.child, 15_000), 1);
    assert.equal(occupant.listening, true);
    assert.equal(await canConnect(apiPort), true, 'the API port occupant must survive');
    assertOnlyDiagnostic(running.output(), secret, 'DEV_API_FAILED: PORT_IN_USE: API_PORT');
  } finally {
    await cleanupIndependently([
      ['API candidate', () => running ? stopCandidate(running.child) : Promise.resolve()],
      ['occupying fixture', () => closeServer(occupant)],
      ['temporary settings', () => dir ? withDeadline(rm(dir, { recursive: true, force: true }), 2000, 'temporary settings removal') : Promise.resolve()]
    ]);
  }
});

test('dev:web rejects an occupied configured port without moving or stopping the occupant', { timeout: 15_000 }, async () => {
  const occupant = await listen();
  let dir;
  let running;
  try {
    const [webPort, apiPort, dbPort] = await fixturePorts(occupant);
    dir = await mkdtemp(join(tmpdir(), 'handoff-dev-web-test-'));
    const envPath = join(dir, '.env');
    const secret = randomBytes(18).toString('hex');
    await writeFile(envPath, envText(apiPort, webPort, dbPort, secret), { mode: 0o600 });
    running = start(viteCli, webRoot, envPath);
    assert.equal(await waitForClose(running.child, 8_000), 1);
    assert.equal(occupant.listening, true);
    assert.equal(await canConnect(webPort), true, 'the web port occupant must survive');
    assertOnlyDiagnostic(running.output(), secret, 'DEV_WEB_FAILED: PORT_IN_USE: WEB_PORT');
  } finally {
    await cleanupIndependently([
      ['web candidate', () => running ? stopCandidate(running.child) : Promise.resolve()],
      ['occupying fixture', () => closeServer(occupant)],
      ['temporary settings', () => dir ? withDeadline(rm(dir, { recursive: true, force: true }), 2000, 'temporary settings removal') : Promise.resolve()]
    ]);
  }
});
