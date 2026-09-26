import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const host = '127.0.0.1';
const apiUrl = `http://${host}:3001/api/health/ready`;
const webUrl = `http://${host}:5174/`;

function isolatedFixture() {
  expect(process.env.NODE_ENV).toBe('test');
  const project = process.env.HANDOFF_TEST_PROJECT ?? '';
  expect(project).toMatch(/^handoff-test-\d+-[0-9a-f]{10}$/);
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  expect(databaseUrl.protocol).toBe('postgresql:');
  expect(databaseUrl.hostname).toBe(host);
  expect(databaseUrl.port).toBe('5433');
  expect(databaseUrl.pathname).toBe('/handoff_test');
  expect(process.env.POSTGRES_DB).toBe('handoff_test');
  expect(process.env.API_PORT).toBe('3001');
  expect(process.env.WEB_PORT).toBe('5174');
  expect(process.env.DB_PORT).toBe('5433');
  const controlUrl = new URL(process.env.HANDOFF_TEST_API_CONTROL_URL ?? '');
  expect(controlUrl.protocol).toBe('http:');
  expect(controlUrl.hostname).toBe(host);
  expect(process.env.HANDOFF_TEST_API_CONTROL_TOKEN).toMatch(/^[0-9a-f]{48}$/);
  return { project, controlUrl };
}

async function probe(action: 'create' | 'verify' | 'cleanup', id: string, value?: string) {
  const args = ['scripts/probe.mjs', action, '--id', id];
  if (value !== undefined) args.push('--value', value);
  try {
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: root, env: process.env, windowsHide: true, timeout: 15_000
    });
    expect(stdout.trim()).toBe(`PROBE_${action === 'create' ? 'CREATED' : action === 'verify' ? 'VERIFIED' : 'CLEANED'}`);
  } catch {
    throw new Error(`PROBE_${action.toUpperCase()}_FAILED`);
  }
}

async function compose(project: string, action: 'down' | 'up') {
  const args = ['compose', '--project-name', project, '-f', 'compose.test.yml'];
  args.push(...(action === 'down' ? ['down'] : ['up', '-d', '--wait', '--wait-timeout', '60']));
  try {
    await execFileAsync('docker', args, {
      cwd: root, env: process.env, windowsHide: true, timeout: 75_000
    });
  } catch {
    throw new Error(`TEST_DB_${action.toUpperCase()}_FAILED`);
  }
}

async function control(controlUrl: URL, action: 'stop' | 'start' | 'web-stop' | 'web-start') {
  const response = await fetch(new URL(`/${action}`, controlUrl), {
    method: 'POST',
    headers: { 'x-test-control-token': process.env.HANDOFF_TEST_API_CONTROL_TOKEN ?? '' },
    signal: AbortSignal.timeout(35_000)
  });
  expect(response.status, `fixture ${action} failed`).toBe(204);
}

async function available(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch { return false; }
}

async function waitAvailable(url: string, expected: boolean) {
  await expect.poll(() => available(url), { timeout: 30_000 }).toBe(expected);
}

test('one probe survives three complete ordinary restarts', async ({ page }) => {
  test.setTimeout(300_000);
  const { project, controlUrl } = isolatedFixture();
  const id = randomUUID();
  const value = randomBytes(24).toString('hex');
  let probeAttempted = false;
  let dbDownAttempted = false;
  let apiStopAttempted = false;
  let webStopAttempted = false;
  const failures: unknown[] = [];

  try {
    probeAttempted = true;
    await probe('create', id, value);
    for (let cycle = 1; cycle <= 3; cycle++) {
      webStopAttempted = true;
      await control(controlUrl, 'web-stop');
      await waitAvailable(webUrl, false);
      apiStopAttempted = true;
      await control(controlUrl, 'stop');
      await waitAvailable(apiUrl, false);
      dbDownAttempted = true;
      await compose(project, 'down');
      await compose(project, 'up');
      dbDownAttempted = false;
      await control(controlUrl, 'start');
      await waitAvailable(apiUrl, true);
      apiStopAttempted = false;
      await control(controlUrl, 'web-start');
      await waitAvailable(webUrl, true);
      webStopAttempted = false;
      await page.goto('/dev/health');
      await page.getByRole('button', { name: '상태 확인' }).click();
      await expect(page.getByRole('status')).toHaveText('준비 완료');
      await probe('verify', id, value);
      console.log(`PERSISTENCE_CYCLE_${cycle}: PROBE_VERIFIED`);
    }
  } catch (error) { failures.push(error); }
  finally {
    if (dbDownAttempted) {
      try { await compose(project, 'up'); }
      catch (error) { failures.push(error); }
    }
    if (apiStopAttempted) {
      try {
        if (!await available(apiUrl)) await control(controlUrl, 'start');
        await waitAvailable(apiUrl, true);
      } catch (error) { failures.push(error); }
    }
    if (webStopAttempted) {
      try {
        if (!await available(webUrl)) await control(controlUrl, 'web-start');
        await waitAvailable(webUrl, true);
      } catch (error) { failures.push(error); }
    }
    if (probeAttempted) {
      try { await probe('cleanup', id); }
      catch (error) { failures.push(error); }
    }
  }
  if (failures.length) throw new AggregateError(failures, 'PERSISTENCE_TEST_FAILED');
});
