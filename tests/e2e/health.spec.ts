import { test, expect, type Page, type APIResponse } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const apiUrl = 'http://127.0.0.1:3001/api/health/ready';
const healthPath = '/api/health/ready';

test.describe.configure({ mode: 'serial' });

function isolatedProject() {
  expect(process.env.NODE_ENV).toBe('test');
  const project = process.env.HANDOFF_TEST_PROJECT ?? '';
  expect(project).toMatch(/^handoff-test-\d+-[0-9a-f]{10}$/);
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  expect(databaseUrl.hostname).toBe('127.0.0.1');
  expect(databaseUrl.port).toBe('5433');
  expect(databaseUrl.pathname).toBe('/handoff_test');
  return project;
}

async function compose(project: string, action: 'stop' | 'start') {
  await execFileAsync('docker', ['compose', '--project-name', project, '-f', 'compose.test.yml', action, 'db'], {
    cwd: root, env: process.env, windowsHide: true, timeout: 45_000
  });
}

type Health = {
  status: 'ready' | 'degraded';
  checkedAt: string;
  service: 'ok';
  database: 'ok' | 'unavailable' | 'schema_missing';
  code: 'OK' | 'DATABASE_UNAVAILABLE' | 'SCHEMA_NOT_READY';
};

async function assertHealth(response: APIResponse, http: number, database: Health['database']) {
  expect(response.status()).toBe(http);
  expect(response.headers()['cache-control']).toBe('no-store');
  const body = await response.json() as Health;
  expect(Object.keys(body).sort()).toEqual(['checkedAt', 'code', 'database', 'service', 'status']);
  expect(body).toMatchObject({
    status: http === 200 ? 'ready' : 'degraded',
    service: 'ok', database,
    code: database === 'ok' ? 'OK' : database === 'schema_missing' ? 'SCHEMA_NOT_READY' : 'DATABASE_UNAVAILABLE'
  });
  expect(new Date(body.checkedAt).toISOString()).toBe(body.checkedAt);
  return body;
}

async function check(page: Page, status: string, storage: string, maxMs = 10_000) {
  const started = performance.now();
  await page.getByRole('button', { name: '상태 확인' }).click();
  await expect(page.getByRole('status')).toHaveText(status, { timeout: maxMs });
  const elapsed = performance.now() - started;
  expect(elapsed, 'screen confirmation must finish inside the 10-second client budget').toBeLessThan(maxMs + 750);
  await expect(page.getByText(`저장소 상태: ${storage}`)).toBeVisible();
  return elapsed;
}

test('real PostgreSQL outage and recovery update HTTP and browser state', async ({ page, request }) => {
  const project = isolatedProject();
  let dbStopped = false;
  let failure: unknown;
  try {
    await page.goto('/');
    const initial = await request.get(healthPath);
    await assertHealth(initial, 200, 'ok');
    await check(page, '준비 완료', '정상');
    await expect(page.getByText(/^확인 시각 \d{4}-\d{2}-\d{2}T/)).toBeVisible();

    await compose(project, 'stop');
    dbStopped = true;
    const unavailable = await request.get(healthPath);
    await assertHealth(unavailable, 503, 'unavailable');
    await check(page, '저장소 점검 필요', '연결 불가');
    await expect(page.getByText(/^확인 시각 \d{4}-\d{2}-\d{2}T/)).toBeVisible();
    await expect(page.getByText(/DB 설정을 확인하고 npm run db:up/)).toBeVisible();
    await expect(page.getByText('준비 완료')).toHaveCount(0);

    await compose(project, 'start');
    dbStopped = false;
    await expect.poll(async () => (await request.get(healthPath)).status(), { timeout: 30_000 }).toBe(200);
    await assertHealth(await request.get(healthPath), 200, 'ok');
    await check(page, '준비 완료', '정상');
  } catch (error) { failure = error; }
  finally {
    if (dbStopped) {
      try { await compose(project, 'start'); }
      catch (cleanupError) {
        failure = failure ? new AggregateError([failure, cleanupError], 'DB recovery cleanup failed') : cleanupError;
      }
    }
  }
  if (failure) throw failure;
});

test('missing real schema is degraded, guides migration, and recovers after restoring the table', async ({ page, request }) => {
  isolatedProject();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2_000 });
  let renamed = false;
  let failure: unknown;
  try {
    await client.connect();
    await page.goto('/');
    await client.query('ALTER TABLE bootstrap_probes RENAME TO bootstrap_probes_health_e2e_hidden');
    renamed = true;
    await assertHealth(await request.get(healthPath), 503, 'schema_missing');
    await check(page, '저장소 점검 필요', '스키마 준비 필요');
    await expect(page.getByText(/npm run db:migrate/)).toBeVisible();
    await client.query('ALTER TABLE bootstrap_probes_health_e2e_hidden RENAME TO bootstrap_probes');
    renamed = false;
    await assertHealth(await request.get(healthPath), 200, 'ok');
    await check(page, '준비 완료', '정상');
  } catch (error) { failure = error; }
  finally {
    if (renamed) {
      try { await client.query('ALTER TABLE bootstrap_probes_health_e2e_hidden RENAME TO bootstrap_probes'); }
      catch (cleanupError) {
        failure = failure ? new AggregateError([failure, cleanupError], 'schema cleanup failed') : cleanupError;
      }
    }
    try { await client.end(); }
    catch (cleanupError) { failure = failure ? new AggregateError([failure, cleanupError], 'connection cleanup failed') : cleanupError; }
  }
  if (failure) throw failure;
});

async function waitForApi(responseExpected: boolean, timeoutMs = 30_000) {
  await expect.poll(async () => {
    try {
      const response = await fetch(apiUrl, { signal: AbortSignal.timeout(1_000) });
      return response.ok;
    } catch { return false; }
  }, { timeout: timeoutMs }).toBe(responseExpected);
}

async function stopChild(child: ChildProcess) {
  if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await new Promise<void>((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error('API_TEST_CLEANUP_TIMEOUT')), 5_000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
  });
}

test('stopped API becomes unavailable in the browser and a fresh API restores ready', async ({ page, request }) => {
  isolatedProject();
  const apiPid = Number(process.env.HANDOFF_TEST_API_PID);
  expect(Number.isSafeInteger(apiPid) && apiPid > 0).toBe(true);
  let replacement: ChildProcess | undefined;
  let failure: unknown;
  try {
    await waitForApi(true);
    await page.goto('/');
    process.kill(apiPid, 'SIGTERM');
    await waitForApi(false);
    await check(page, '확인 불가', '확인 불가');
    await expect(page.getByText(/API 프로세스를 확인하세요/)).toBeVisible();
    await expect(page.getByText(/확인 시도 시각/)).toBeVisible();
    expect((await request.get(healthPath)).status()).not.toBe(200);

    replacement = spawn(process.execPath, ['apps/api/dist/src/main.js'], {
      cwd: root, env: process.env, windowsHide: true, stdio: 'ignore'
    });
    await waitForApi(true);
    await assertHealth(await request.get(healthPath), 200, 'ok');
    await check(page, '준비 완료', '정상');
  } catch (error) { failure = error; }
  finally {
    if (replacement) {
      try { await stopChild(replacement); }
      catch (cleanupError) { failure = failure ? new AggregateError([failure, cleanupError], 'API cleanup failed') : cleanupError; }
    }
  }
  if (failure) throw failure;
});

test('a delayed API response is aborted by the browser at ten seconds', async ({ page }) => {
  isolatedProject();
  await page.route(`**${healthPath}`, async route => {
    await new Promise(resolve => setTimeout(resolve, 15_000));
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    catch { /* The browser aborted the request before this delayed response. */ }
  });
  await page.goto('/');
  const started = performance.now();
  await page.getByRole('button', { name: '상태 확인' }).click();
  await expect(page.getByRole('status')).toHaveText('확인 중');
  await page.waitForTimeout(9_000);
  await expect(page.getByRole('status')).toHaveText('확인 중');
  await expect(page.getByRole('status')).toHaveText('확인 불가', { timeout: 2_500 });
  const elapsed = performance.now() - started;
  expect(elapsed).toBeGreaterThanOrEqual(9_500);
  expect(elapsed).toBeLessThan(10_750);
  await expect(page.getByText('저장소 상태: 확인 불가')).toBeVisible();
  await expect(page.getByText(/API 프로세스를 확인하세요/)).toBeVisible();
  await expect(page.getByText(/확인 시도 시각/)).toBeVisible();
});
