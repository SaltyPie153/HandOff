import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { promisify } from 'node:util';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { AppModule, type ApiConfig } from '../src/app.module.js';

const execFileAsync = promisify(execFile);
const healthPath = '/api/health/ready';
const integrationTest = process.env.HANDOFF_TEST_PROJECT === undefined ? test.skip : test;

function testConfig(databaseUrl: string): ApiConfig {
  const url = new URL(databaseUrl);
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/handoff_test');
  return {
    nodeEnv: 'test', apiPort: 0, webPort: 5174, dbPort: 5433,
    databaseName: 'handoff_test', databaseHost: '127.0.0.1',
    postgresUser: process.env.POSTGRES_USER ?? '',
    postgresPassword: process.env.POSTGRES_PASSWORD ?? '',
    databaseUrl
  };
}

async function startHealthServer(databaseUrl: string) {
  const module = await Test.createTestingModule({ imports: [AppModule.register(testConfig(databaseUrl))] }).compile();
  const app = module.createNestApplication();
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}${healthPath}`, close: () => app.close() };
}

type Expected = {
  http: number;
  status: 'ready' | 'degraded';
  database: 'ok' | 'unavailable' | 'schema_missing';
  code: 'OK' | 'DATABASE_UNAVAILABLE' | 'SCHEMA_NOT_READY';
};

async function readHealth(url: string, expected: Expected, maxMs = 5_500) {
  const started = performance.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(6_500) });
  const elapsedMs = performance.now() - started;
  const body: unknown = await response.json();
  assert.ok(elapsedMs < maxMs, `server diagnostic exceeded ${maxMs}ms: ${elapsedMs.toFixed(0)}ms`);
  assert.equal(response.status, expected.http);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(body && typeof body === 'object' && !Array.isArray(body));
  const value = body as Record<string, unknown>;
  assert.deepEqual(Object.keys(value).sort(), ['checkedAt', 'code', 'database', 'service', 'status']);
  assert.equal(value.status, expected.status);
  assert.equal(value.service, 'ok');
  assert.equal(value.database, expected.database);
  assert.equal(value.code, expected.code);
  assert.ok(typeof value.checkedAt === 'string' && !Number.isNaN(Date.parse(value.checkedAt)));
  assert.equal(new Date(value.checkedAt as string).toISOString(), value.checkedAt);
  return elapsedMs;
}

const ready: Expected = { http: 200, status: 'ready', database: 'ok', code: 'OK' };
const dbDown: Expected = { http: 503, status: 'degraded', database: 'unavailable', code: 'DATABASE_UNAVAILABLE' };
const schemaMissing: Expected = { http: 503, status: 'degraded', database: 'schema_missing', code: 'SCHEMA_NOT_READY' };

function isolatedProject(): string {
  const project = process.env.HANDOFF_TEST_PROJECT ?? '';
  assert.match(project, /^handoff-test-\d+-[0-9a-f]{10}$/);
  return project;
}

async function compose(project: string, action: 'stop' | 'start') {
  await execFileAsync('docker', ['compose', '--project-name', project, '-f', 'compose.test.yml', action, 'db'], {
    cwd: process.cwd(), windowsHide: true, env: process.env, timeout: 45_000
  });
}

async function waitForHealth(url: string, expected: Expected, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try { return await readHealth(url, expected); }
    catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw lastError;
}

integrationTest('real test PostgreSQL reports migrated empty table, outage, recovery and missing schema', { timeout: 120_000 }, async () => {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const project = isolatedProject();
  const health = await startHealthServer(databaseUrl);
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
  let dbStopped = false;
  let tableRenamed = false;
  let failure: unknown;
  try {
    await client.connect();
    const rows = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM bootstrap_probes');
    assert.equal(rows.rows[0].count, 0, 'fresh migrated test table must be empty');
    await readHealth(health.url, ready);

    await client.end();
    await compose(project, 'stop');
    dbStopped = true;
    await readHealth(health.url, dbDown);
    await compose(project, 'start');
    dbStopped = false;
    await waitForHealth(health.url, ready);

    const schema = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    await schema.connect();
    try {
      await schema.query('ALTER TABLE bootstrap_probes RENAME TO bootstrap_probes_health_test_hidden');
      tableRenamed = true;
      await readHealth(health.url, schemaMissing);
    } finally {
      if (tableRenamed) {
        await schema.query('ALTER TABLE bootstrap_probes_health_test_hidden RENAME TO bootstrap_probes');
        tableRenamed = false;
      }
      await schema.end();
    }
    await readHealth(health.url, ready);
  } catch (error) { failure = error; }
  finally {
    const cleanupErrors: string[] = [];
    if (dbStopped) {
      try { await compose(project, 'start'); }
      catch { cleanupErrors.push('DB_RESTART'); }
    }
    try { await client.end(); } catch { cleanupErrors.push('CLIENT_CLOSE'); }
    try { await health.close(); } catch { cleanupErrors.push('API_CLOSE'); }
    if (cleanupErrors.length) {
      const cleanup = new Error(`CLEANUP_FAILED: ${cleanupErrors.join(',')}`);
      failure = failure ? new AggregateError([failure, cleanup]) : cleanup;
    }
  }
  if (failure) throw failure;
});

integrationTest('blocked real table read times out near two seconds and repeated requests do not accumulate active connections', { timeout: 45_000 }, async () => {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const health = await startHealthServer(databaseUrl);
  const locker = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
  const observer = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
  let failure: unknown;
  let locked = false;
  try {
    await locker.connect();
    await observer.connect();
    await readHealth(health.url, ready);
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE bootstrap_probes IN ACCESS EXCLUSIVE MODE');
    locked = true;
    for (let index = 0; index < 5; index++) {
      const elapsed = await readHealth(health.url, dbDown);
      assert.ok(elapsed >= 1_500 && elapsed < 2_750, `query budget differs from server budget: ${elapsed.toFixed(0)}ms`);
      const activity = await observer.query<{ active: number; total: number }>(
        `SELECT count(*) FILTER (WHERE state = 'active')::int AS active,
                count(*)::int AS total
         FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`
      );
      assert.equal(activity.rows[0].active, 0, 'timed-out queries must leave no active backend');
      assert.ok(activity.rows[0].total <= 6, 'health pool must remain bounded at four connections');
    }
    await locker.query('ROLLBACK');
    locked = false;
    await readHealth(health.url, ready);
  } catch (error) { failure = error; }
  finally {
    const cleanupErrors: string[] = [];
    if (locked) {
      try { await locker.query('ROLLBACK'); } catch { cleanupErrors.push('LOCK_ROLLBACK'); }
    }
    try { await locker.end(); } catch { cleanupErrors.push('LOCKER_CLOSE'); }
    try { await observer.end(); } catch { cleanupErrors.push('OBSERVER_CLOSE'); }
    try { await health.close(); } catch { cleanupErrors.push('API_CLOSE'); }
    if (cleanupErrors.length) {
      const cleanup = new Error(`CLEANUP_FAILED: ${cleanupErrors.join(',')}`);
      failure = failure ? new AggregateError([failure, cleanup]) : cleanup;
    }
  }
  if (failure) throw failure;
});

integrationTest('silent PostgreSQL peer ends connection attempts near the two-second connect budget', { timeout: 25_000 }, async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  const sockets = new Set<Socket>();
  const peer = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.resume();
  });
  await new Promise<void>((resolve, reject) => peer.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const port = (peer.address() as { port: number }).port;
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.port = String(port);
  const module = await Test.createTestingModule({ imports: [AppModule.register({ ...testConfig(process.env.DATABASE_URL ?? ''), databaseUrl: url.toString() })] }).compile();
  const app = module.createNestApplication();
  let failure: unknown;
  try {
    await app.listen(0, '127.0.0.1');
    const apiPort = (app.getHttpServer().address() as { port: number }).port;
    for (let index = 0; index < 3; index++) {
      const elapsed = await readHealth(`http://127.0.0.1:${apiPort}${healthPath}`, dbDown);
      assert.ok(elapsed >= 1_500 && elapsed < 2_750, `connect budget differs from server budget: ${elapsed.toFixed(0)}ms`);
    }
  } catch (error) { failure = error; }
  finally {
    const cleanupErrors: string[] = [];
    try { await app.close(); } catch { cleanupErrors.push('API_CLOSE'); }
    const closeDeadline = Date.now() + 2_000;
    while (sockets.size > 0 && Date.now() < closeDeadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const leaked = sockets.size;
    for (const socket of sockets) socket.destroy();
    try { await new Promise<void>((resolve, reject) => peer.close(error => error ? reject(error) : resolve())); }
    catch { cleanupErrors.push('PEER_CLOSE'); }
    assert.equal(leaked, 0, 'timed-out connection attempts must not survive app shutdown');
    if (cleanupErrors.length) {
      const cleanup = new Error(`CLEANUP_FAILED: ${cleanupErrors.join(',')}`);
      failure = failure ? new AggregateError([failure, cleanup]) : cleanup;
    }
  }
  if (failure) throw failure;
});
