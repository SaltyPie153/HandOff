import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createConnection, createServer, type Server } from 'node:net';
import { fileURLToPath } from 'node:url';

const mainPath = fileURLToPath(new URL('../src/main.js', import.meta.url));
const host = '127.0.0.1';

async function listeningServer(): Promise<Server> {
  const server = createServer(socket => {
    socket.on('error', () => undefined);
    socket.end('fixture');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  return server;
}

function serverPort(server: Server): number {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function unusedPorts(): Promise<[number, number]> {
  const first = await listeningServer();
  let second: Server | undefined;
  try {
    second = await listeningServer();
    return [serverPort(first), serverPort(second)];
  } finally {
    await Promise.all([first, second].filter((server): server is Server => server !== undefined)
      .map(server => new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())
      )));
  }
}

function childEnv(apiPort: number, dbPort: number, secret: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    NODE_ENV: 'test', API_PORT: String(apiPort),
    WEB_PORT: String([5174, 5175, 5176].find(port => port !== apiPort && port !== dbPort)),
    DB_PORT: String(dbPort),
    POSTGRES_USER: 'handoff', POSTGRES_PASSWORD: secret, POSTGRES_DB: 'handoff_test',
    DATABASE_URL: `postgresql://handoff:${secret}@${host}:${dbPort}/handoff_test`
  };
}

function startApi(env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [mainPath], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-65536); });
  }
  return { child, output: () => output };
}

function waitForClose(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('API process did not exit within the test deadline')); }, timeoutMs);
    const onClose = (code: number | null) => { cleanup(); resolve(code); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => {
      clearTimeout(timer);
      child.off('close', onClose);
      child.off('error', onError);
    };
    child.once('close', onClose);
    child.once('error', onError);
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', () => resolve());
      killer.once('close', () => resolve());
    });
  } else {
    child.kill('SIGTERM');
  }
  await waitForClose(child, 3000);
}

function canConnect(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function waitForListening(child: ChildProcess, port: number): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && child.exitCode === null) {
    if (await canConnect(port)) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

function expectNoSecret(output: string, secret: string): void {
  assert.ok(!output.includes(secret), 'API diagnostic exposed the test password');
  assert.ok(!output.includes(`postgresql://handoff:${secret}`), 'API diagnostic exposed the database URL');
}

test('API startup rejects a missing required setting with its name and no secret', { timeout: 15_000 }, async () => {
  const secret = randomBytes(18).toString('hex');
  const [apiPort, dbPort] = await unusedPorts();
  const env = childEnv(apiPort, dbPort, secret);
  delete env.DATABASE_URL;
  const running = startApi(env);
  try {
    assert.notEqual(await waitForClose(running.child, 10_000), 0);
    const output = running.output();
    expectNoSecret(output, secret);
    assert.ok(/MISSING_SETTING/.test(output) && /DATABASE_URL/.test(output), 'missing DATABASE_URL must be identified by a fixed diagnostic');
  } finally {
    await stopChild(running.child);
  }
});

test('API startup refuses production without exposing configuration secrets', { timeout: 15_000 }, async () => {
  const secret = randomBytes(18).toString('hex');
  const [apiPort, dbPort] = await unusedPorts();
  const env = childEnv(apiPort, dbPort, secret);
  env.NODE_ENV = 'production';
  const running = startApi(env);
  try {
    assert.notEqual(await waitForClose(running.child, 10_000), 0);
    const output = running.output();
    expectNoSecret(output, secret);
    assert.ok(/UNSAFE_ENVIRONMENT/.test(output) && /NODE_ENV/.test(output), 'production must be rejected by a fixed diagnostic');
  } finally {
    await stopChild(running.child);
  }
});

test('API port conflict fails only the new process and preserves its occupant', { timeout: 15_000 }, async () => {
  const occupant = await listeningServer();
  let running: ReturnType<typeof startApi> | undefined;
  try {
    const port = serverPort(occupant);
    const secret = randomBytes(18).toString('hex');
    const [dbPort] = await unusedPorts();
    running = startApi(childEnv(port, dbPort, secret));
    assert.notEqual(await waitForClose(running.child, 10_000), 0);
    const output = running.output();
    expectNoSecret(output, secret);
    assert.equal(occupant.listening, true);
    assert.equal(await canConnect(port), true, 'the existing listener must survive the candidate failure');
    assert.ok(/PORT_IN_USE|EADDRINUSE|port.+in use/i.test(output), 'API port conflict needs a useful diagnostic');
    assert.ok(output.includes(String(port)) || output.includes('API_PORT'), 'API port conflict needs the affected setting or port');
  } finally {
    if (running) await stopChild(running.child);
    await new Promise<void>((resolve, reject) => occupant.close(error => error ? reject(error) : resolve()));
  }
});

test('API starts on loopback while its configured database is unavailable', { timeout: 15_000 }, async () => {
  const [apiPort, dbPort] = await unusedPorts();
  const secret = randomBytes(18).toString('hex');
  const running = startApi(childEnv(apiPort, dbPort, secret));
  try {
    assert.equal(await waitForListening(running.child, apiPort), true, 'API must listen even without a database connection');
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(running.child.exitCode, null, 'API must stay alive while the database is unavailable');
    expectNoSecret(running.output(), secret);
  } finally {
    await stopChild(running.child);
  }
});
