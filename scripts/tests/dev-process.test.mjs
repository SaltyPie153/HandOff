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
    await Promise.all([other, second].filter(Boolean)
      .map(server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
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
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', chunk => { output = (output + chunk.toString()).slice(-65536); });
  }
  return { child, output: () => output };
}

function waitForClose(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
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
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', resolve);
      killer.once('close', resolve);
    });
  } else {
    child.kill('SIGTERM');
  }
  await waitForClose(child, 3000);
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

function assertSafeDiagnostic(output, secret, port, setting) {
  assert.ok(!output.includes(secret), `${setting} error exposed the test password`);
  assert.ok(!output.includes(`postgresql://handoff:${secret}`), `${setting} error exposed the database URL`);
  assert.ok(/PORT_IN_USE|EADDRINUSE|port.+in use/i.test(output), `${setting} conflict needs a useful diagnostic`);
  assert.ok(output.includes(String(port)) || output.includes(setting), `${setting} conflict needs the affected setting or port`);
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
    assert.notEqual(await waitForClose(running.child, 15_000), 0);
    assert.equal(occupant.listening, true);
    assert.equal(await canConnect(apiPort), true, 'the API port occupant must survive');
    assertSafeDiagnostic(running.output(), secret, apiPort, 'API_PORT');
  } finally {
    if (running) await stopCandidate(running.child);
    await new Promise((resolve, reject) => occupant.close(error => error ? reject(error) : resolve()));
    if (dir) await rm(dir, { recursive: true, force: true });
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
    assert.notEqual(await waitForClose(running.child, 8_000), 0);
    assert.equal(occupant.listening, true);
    assert.equal(await canConnect(webPort), true, 'the web port occupant must survive');
    assertSafeDiagnostic(running.output(), secret, webPort, 'WEB_PORT');
  } finally {
    if (running) await stopCandidate(running.child);
    await new Promise((resolve, reject) => occupant.close(error => error ? reject(error) : resolve()));
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});
