import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createConnection, createServer, type AddressInfo, type Server } from 'node:net';
import { fileURLToPath } from 'node:url';

const mainPath = fileURLToPath(new URL('../src/main.js', import.meta.url));
const mainUrl = new URL('../src/main.js', import.meta.url).href;
const host = '127.0.0.1';
const maxOutput = 65536;
type CapturedOutput = { stdout: string; stderr: string; overflow: boolean };

function withDeadline<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded its cleanup deadline`)), timeoutMs);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

async function closeServer(server: Server): Promise<void> {
  await withDeadline(new Promise<void>((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())
  ), 2000, 'fixture server close');
}

async function cleanupIndependently(steps: Array<[string, () => Promise<unknown>]>): Promise<void> {
  const failed: string[] = [];
  for (const [name, step] of steps) {
    try { await step(); } catch { failed.push(name); }
  }
  assert.deepEqual(failed, [], 'test resources failed to close');
}

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
    await cleanupIndependently(
      [first, second].filter((server): server is Server => server !== undefined)
        .map(server => ['reserved port', () => closeServer(server)])
    );
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
  const output: CapturedOutput = { stdout: '', stderr: '', overflow: false };
  child.stdout?.on('data', (chunk: Buffer) => {
    const next = output.stdout + chunk.toString();
    if (next.length > maxOutput) output.overflow = true;
    output.stdout = next.slice(0, maxOutput);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const next = output.stderr + chunk.toString();
    if (next.length > maxOutput) output.overflow = true;
    output.stderr = next.slice(0, maxOutput);
  });
  return { child, output: () => output };
}

function waitForClose(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
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

function expectNoSecret(output: CapturedOutput, secret: string): void {
  assert.equal(output.overflow, false, 'API emitted more than the diagnostic capture limit');
  assert.ok(!output.stdout.includes(secret) && !output.stderr.includes(secret), 'API diagnostic exposed the test password');
  assert.ok(!output.stdout.includes('postgresql://') && !output.stderr.includes('postgresql://'), 'API diagnostic exposed a database URL');
}

function expectOnlyDiagnostic(output: CapturedOutput, secret: string, expected: string): void {
  expectNoSecret(output, secret);
  const line = [expected, `${expected}\n`, `${expected}\r\n`];
  assert.ok(
    (output.stdout === '' && line.includes(output.stderr)) ||
    (output.stderr === '' && line.includes(output.stdout)),
    `API must emit only the fixed diagnostic ${expected}`
  );
}

test('API startup rejects a missing required setting with its name and no secret', { timeout: 15_000 }, async () => {
  const secret = randomBytes(18).toString('hex');
  const [apiPort, dbPort] = await unusedPorts();
  const env = childEnv(apiPort, dbPort, secret);
  delete env.DATABASE_URL;
  const running = startApi(env);
  try {
    assert.equal(await waitForClose(running.child, 10_000), 1);
    expectOnlyDiagnostic(running.output(), secret, 'API_START_FAILED: MISSING_SETTING: DATABASE_URL');
  } finally {
    await cleanupIndependently([['API process', () => stopChild(running.child)]]);
  }
});

test('API startup refuses production without exposing configuration secrets', { timeout: 15_000 }, async () => {
  const secret = randomBytes(18).toString('hex');
  const [apiPort, dbPort] = await unusedPorts();
  const env = childEnv(apiPort, dbPort, secret);
  env.NODE_ENV = 'production';
  const running = startApi(env);
  try {
    assert.equal(await waitForClose(running.child, 10_000), 1);
    expectOnlyDiagnostic(running.output(), secret, 'API_START_FAILED: UNSAFE_ENVIRONMENT: NODE_ENV');
  } finally {
    await cleanupIndependently([['API process', () => stopChild(running.child)]]);
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
    assert.equal(await waitForClose(running.child, 10_000), 1);
    assert.equal(occupant.listening, true);
    assert.equal(await canConnect(port), true, 'the existing listener must survive the candidate failure');
    expectOnlyDiagnostic(running.output(), secret, 'API_START_FAILED: PORT_IN_USE: API_PORT');
  } finally {
    await cleanupIndependently([
      ['API process', () => running ? stopChild(running.child) : Promise.resolve()],
      ['occupying fixture', () => closeServer(occupant)]
    ]);
  }
});

test('API bootstrap binds its actual HTTP server to loopback only', { timeout: 20_000 }, async () => {
  const [apiPort, dbPort] = await unusedPorts();
  const secret = randomBytes(18).toString('hex');
  const env = childEnv(apiPort, dbPort, secret);
  let module: { startApi?: (config: unknown) => Promise<{
    getHttpServer(): { address(): AddressInfo | string | null; closeAllConnections?(): void };
    close(): Promise<unknown>;
  }> } = {};
  try {
    module = await import(mainUrl);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  const startApi = module.startApi;
  assert.ok(startApi && typeof startApi === 'function', 'API must export import-safe startApi(config)');
  const config = {
    nodeEnv: 'test', apiPort, webPort: Number(env.WEB_PORT), dbPort,
    databaseName: 'handoff_test', databaseHost: host, postgresUser: 'handoff',
    postgresPassword: secret, databaseUrl: env.DATABASE_URL
  };
  const app = await withDeadline(startApi(config), 10_000, 'API bootstrap startup');
  try {
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address !== 'string', 'API HTTP server must be listening');
    assert.equal(address.address, host, 'API HTTP server must bind 127.0.0.1, not a wildcard address');
  } finally {
    const server = app.getHttpServer() as Server & { closeAllConnections?(): void };
    await cleanupIndependently([
      ['Nest application', () => withDeadline(app.close(), 3000, 'API bootstrap close')],
      ['HTTP server', async () => {
        server.closeAllConnections?.();
        if (server.listening) await closeServer(server);
      }]
    ]);
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
    await cleanupIndependently([['API process', () => stopChild(running.child)]]);
  }
});
