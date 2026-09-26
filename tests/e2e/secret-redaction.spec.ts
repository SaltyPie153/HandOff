import { test, expect, type Page } from '@playwright/test';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const webRoot = join(root, 'apps', 'web');
const apiEntry = join(root, 'apps', 'api', 'dist', 'src', 'main.js');
const viteEntry = join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const healthUrl = 'http://127.0.0.1:3001/api/health/ready';
const execFileAsync = promisify(execFile);

type Secrets = { password: string; token: string; databaseUrl: string };
type Tracked = { child: ChildProcessWithoutNullStreams; done: Promise<number>; output: () => string };

function countLeak(text: string, secrets: Secrets): number {
  return Object.values(secrets).reduce((total, secret) => total + text.split(secret).length - 1, 0);
}

function assertNoLeaks(label: string, text: string, secrets: Secrets) {
  expect(countLeak(text, secrets), `${label}: secret occurrence count`).toBe(0);
}

function isolatedFixture() {
  expect(process.env.NODE_ENV).toBe('test');
  const project = process.env.HANDOFF_TEST_PROJECT ?? '';
  expect(project).toMatch(/^handoff-test-\d+-[0-9a-f]{10}$/);
  const url = new URL(process.env.DATABASE_URL ?? '');
  expect(url.hostname).toBe('127.0.0.1');
  expect(url.port).toBe('5433');
  expect(url.pathname).toBe('/handoff_test');
  const control = new URL(process.env.HANDOFF_TEST_API_CONTROL_URL ?? '');
  expect(control.hostname).toBe('127.0.0.1');
  expect(process.env.HANDOFF_TEST_API_CONTROL_TOKEN ?? '').toMatch(/^[0-9a-f]{48}$/);
  return { control, project };
}

async function compose(project: string, action: 'stop' | 'start') {
  try {
    await execFileAsync('docker', ['compose', '--project-name', project, '-f', 'compose.test.yml', action, 'db'], {
      cwd: root, env: process.env, windowsHide: true, timeout: 45_000
    });
  } catch { throw new Error(`TEST_DATABASE_${action.toUpperCase()}_FAILED`); }
}

async function controlApi(control: URL, action: 'stop' | 'start') {
  const response = await fetch(new URL(`/${action}`, control), {
    method: 'POST',
    headers: { 'x-test-control-token': process.env.HANDOFF_TEST_API_CONTROL_TOKEN ?? '' },
    signal: AbortSignal.timeout(35_000)
  });
  expect(response.status, `fixture API ${action} failed`).toBe(204);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('WEB_PORT_ALLOCATION_FAILED');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

function launch(entry: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Tracked {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let captured = '';
  let overflow = false;
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk: Buffer) => {
      captured += chunk.toString();
      if (captured.length > 1_000_000) overflow = true;
    });
  }
  const done = new Promise<number>((resolve, reject) => {
    child.once('error', () => reject(new Error('TEST_PROCESS_SPAWN_FAILED')));
    child.once('close', code => resolve(code ?? 1));
  });
  void done.catch(() => undefined);
  return { child, done, output: () => {
    expect(overflow, 'captured process output exceeded the scan limit').toBe(false);
    return captured;
  } };
}

async function stop(running: Tracked) {
  if (running.child.exitCode === null && running.child.signalCode === null && running.child.pid) {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/PID', String(running.child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      running.child.kill('SIGTERM');
    }
  }
  await running.done;
}

async function waitFor(url: string, expected: number) {
  await expect.poll(async () => {
    try { return (await fetch(url, { signal: AbortSignal.timeout(1_000) })).status; }
    catch { return 0; }
  }, { timeout: 30_000 }).toBe(expected);
}

async function screenState(page: Page, expected: string, secrets: Secrets, records: string[]) {
  await page.getByRole('button', { name: '상태 확인' }).click();
  await expect.poll(async () => {
    const status = await page.getByRole('status').textContent();
    assertNoLeaks('browser status', status ?? '', secrets);
    return status === expected;
  }, { timeout: 12_000 }).toBe(true);
  const html = await page.locator('html').evaluate(element => element.outerHTML);
  records.push(html);
  assertNoLeaks(`browser ${expected}`, html, secrets);
}

async function scanClientBuild(directory: string, secrets: Secrets) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scanClientBuild(path, secrets);
    else if (entry.isFile()) assertNoLeaks(`client artifact ${entry.name}`, await readFile(path, 'utf8'), secrets);
  }
}

test.describe.configure({ mode: 'serial' });

test('normal, invalid settings, failed DB login, DB outage and recovery reveal no test secrets', async ({ page, request }) => {
  test.setTimeout(240_000);
  const { control, project } = isolatedFixture();
  const secrets: Secrets = {
    password: randomBytes(24).toString('hex'),
    token: randomBytes(24).toString('hex'),
    databaseUrl: ''
  };
  secrets.databaseUrl = `postgresql://handoff:${secrets.password}@127.0.0.1:5433/handoff_test`;
  const webPort = await freePort();
  const testEnv = {
    ...process.env, POSTGRES_PASSWORD: secrets.password, DATABASE_URL: secrets.databaseUrl,
    HANDOFF_TEST_SECRET_TOKEN: secrets.token, WEB_PORT: String(webPort)
  };
  const records: string[] = [];
  const browserMessages: string[] = [];
  page.on('console', message => browserMessages.push(message.text()));
  page.on('pageerror', error => browserMessages.push(error.message));
  let web: Tracked | undefined;
  let trialApi: Tracked | undefined;
  let fixtureStopped = false;
  let dbStopped = false;
  let failure: unknown;
  try {
    expect((await request.get('/api/health/ready')).status()).toBe(200);
    web = launch(viteEntry, ['--host', '127.0.0.1'], webRoot, testEnv);
    const webUrl = `http://127.0.0.1:${webPort}/`;
    await waitFor(webUrl, 200);
    await page.goto(webUrl);
    await screenState(page, '준비 완료', secrets, records);

    fixtureStopped = true;
    await controlApi(control, 'stop');

    const missingEnv = { ...testEnv };
    delete missingEnv.POSTGRES_PASSWORD;
    const missing = launch(apiEntry, [], root, missingEnv);
    expect(await missing.done).toBe(1);
    const missingLog = missing.output();
    records.push(missingLog);
    assertNoLeaks('missing setting API log', missingLog, secrets);
    expect(missingLog.includes('MISSING_SETTING: POSTGRES_PASSWORD')).toBe(true);
    await screenState(page, '확인 불가', secrets, records);

    const malformed = launch(apiEntry, [], root, {
      ...testEnv, DATABASE_URL: `malformed/${secrets.password}/${secrets.token}`
    });
    expect(await malformed.done).toBe(1);
    const malformedLog = malformed.output();
    records.push(malformedLog);
    assertNoLeaks('invalid setting API log', malformedLog, secrets);
    expect(malformedLog.includes('INVALID_DATABASE_URL: DATABASE_URL')).toBe(true);
    await screenState(page, '확인 불가', secrets, records);

    trialApi = launch(apiEntry, [], root, testEnv);
    await waitFor(healthUrl, 503);
    const degraded = await request.get('/api/health/ready');
    const degradedBody = await degraded.text();
    records.push(degradedBody);
    assertNoLeaks('degraded health response', degradedBody, secrets);
    expect(degraded.status()).toBe(503);
    await screenState(page, '저장소 점검 필요', secrets, records);
    await stop(trialApi);
    records.push(trialApi.output());
    assertNoLeaks('database failure API log', trialApi.output(), secrets);
    trialApi = undefined;

    trialApi = launch(apiEntry, [], root, {
      ...process.env,
      HANDOFF_TEST_SECRET_PASSWORD: secrets.password,
      HANDOFF_TEST_SECRET_TOKEN: secrets.token,
      HANDOFF_TEST_SECRET_DATABASE_URL: secrets.databaseUrl
    });
    await waitFor(healthUrl, 200);
    dbStopped = true;
    await compose(project, 'stop');
    await waitFor(healthUrl, 503);
    const outage = await request.get('/api/health/ready');
    const outageBody = await outage.text();
    records.push(outageBody);
    assertNoLeaks('database outage response', outageBody, secrets);
    expect(outage.status()).toBe(503);
    await screenState(page, '저장소 점검 필요', secrets, records);
    await compose(project, 'start');
    dbStopped = false;
    await waitFor(healthUrl, 200);
    await screenState(page, '준비 완료', secrets, records);
    await stop(trialApi);
    records.push(trialApi.output());
    assertNoLeaks('database outage API log', trialApi.output(), secrets);
    trialApi = undefined;

    await controlApi(control, 'start');
    fixtureStopped = false;
    await waitFor(healthUrl, 200);
    await screenState(page, '준비 완료', secrets, records);

    const build = launch(viteEntry, ['build'], webRoot, testEnv);
    expect(await build.done).toBe(0);
    records.push(build.output());
    assertNoLeaks('web build log', build.output(), secrets);
    await scanClientBuild(join(webRoot, 'dist'), secrets);
    records.push(web.output(), ...browserMessages);
    assertNoLeaks('web runtime and browser logs', [...records, web.output(), ...browserMessages].join('\n'), secrets);
  } catch (error) { failure = error; }
  finally {
    if (trialApi) {
      try { await stop(trialApi); assertNoLeaks('trial API cleanup log', trialApi.output(), secrets); }
      catch (cleanupError) { failure = failure ? new AggregateError([failure, cleanupError], 'trial API cleanup failed') : cleanupError; }
    }
    if (dbStopped) {
      try { await compose(project, 'start'); dbStopped = false; }
      catch (cleanupError) { failure = failure ? new AggregateError([failure, cleanupError], 'fixture DB recovery failed') : cleanupError; }
    }
    if (fixtureStopped) {
      try { await controlApi(control, 'start'); await waitFor(healthUrl, 200); }
      catch (cleanupError) { failure = failure ? new AggregateError([failure, cleanupError], 'fixture API recovery failed') : cleanupError; }
    }
    if (web) {
      try { await stop(web); assertNoLeaks('web shutdown log', web.output(), secrets); }
      catch (cleanupError) { failure = failure ? new AggregateError([failure, cleanupError], 'web cleanup failed') : cleanupError; }
    }
  }
  if (failure) throw failure;
});
