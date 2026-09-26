import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));

function isolatedFixture() {
  expect(process.env.NODE_ENV).toBe('test');
  const project = process.env.HANDOFF_TEST_PROJECT ?? '';
  expect(project).toMatch(/^handoff-test-\d+-[0-9a-f]{10}$/);
  expect(process.env.POSTGRES_DB).toBe('handoff_test');
  expect(process.env.POSTGRES_USER).toBe('handoff');
  expect(/^[0-9a-f]{48}$/.test(process.env.POSTGRES_PASSWORD ?? '')).toBe(true);
  expect(process.env.DB_PORT).toBe('5433');
  expect(process.env.API_PORT).toBe('3001');
  expect(process.env.WEB_PORT).toBe('5174');
  let databaseUrl: URL;
  try { databaseUrl = new URL(process.env.DATABASE_URL ?? ''); }
  catch { throw new Error('UNSAFE_TEST_DATABASE_URL'); }
  expect(databaseUrl.protocol).toBe('postgresql:');
  expect(databaseUrl.hostname).toBe('127.0.0.1');
  expect(databaseUrl.port).toBe('5433');
  expect(databaseUrl.pathname).toBe('/handoff_test');
  expect(databaseUrl.search).toBe('');
  expect(databaseUrl.hash).toBe('');
  expect(decodeURIComponent(databaseUrl.username) === process.env.POSTGRES_USER).toBe(true);
  expect(decodeURIComponent(databaseUrl.password) === process.env.POSTGRES_PASSWORD).toBe(true);
  let controlUrl: URL;
  try { controlUrl = new URL(process.env.HANDOFF_TEST_API_CONTROL_URL ?? ''); }
  catch { throw new Error('UNSAFE_TEST_CONTROL_URL'); }
  expect(controlUrl.protocol).toBe('http:');
  expect(controlUrl.hostname).toBe('127.0.0.1');
  expect(Number(controlUrl.port)).toBeGreaterThan(0);
  expect(controlUrl.pathname).toBe('/');
  expect(controlUrl.search).toBe('');
  expect(controlUrl.hash).toBe('');
  expect(/^[0-9a-f]{48}$/.test(process.env.HANDOFF_TEST_API_CONTROL_TOKEN ?? '')).toBe(true);
  return project;
}

async function runCli(script: string, args: string[]) {
  try {
    const result = await execFileAsync(process.execPath, [script, ...args], {
      cwd: root, env: process.env, windowsHide: true, timeout: 20_000
    });
    return { code: 0, output: result.stdout + result.stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    if (typeof failed.code !== 'number') throw new Error('TEST_CLI_PROCESS_FAILED');
    return { code: failed.code, output: (failed.stdout ?? '') + (failed.stderr ?? '') };
  }
}

async function probe(action: 'create' | 'verify' | 'cleanup', id: string, value?: string) {
  const args = [action, '--id', id];
  if (value !== undefined) args.push('--value', value);
  const result = await runCli('scripts/probe.mjs', args);
  const expected = action === 'create' ? 'PROBE_CREATED' :
    action === 'verify' ? 'PROBE_VERIFIED' : 'PROBE_CLEANED';
  expect(result.code, `probe ${action} must succeed`).toBe(0);
  expect(result.output.split(/\r?\n/).includes(expected), `probe ${action} result must be safe`).toBe(true);
}

async function probeMissing(id: string, value: string) {
  const result = await runCli('scripts/probe.mjs', ['verify', '--id', id, '--value', value]);
  expect(result.code, 'cleaned target must be absent').toBe(1);
  expect(result.output.split(/\r?\n/).includes('PROBE_MISSING'), 'missing probe must be reported safely').toBe(true);
}

async function verify(id: string, value: string) {
  const result = await runCli('scripts/verify-bootstrap.mjs', ['--id', id, '--value', value]);
  for (const secret of [process.env.POSTGRES_PASSWORD, process.env.DATABASE_URL,
    process.env.HANDOFF_TEST_API_CONTROL_TOKEN, value]) {
    expect(result.output.includes(secret ?? ''), 'verify output must omit secret values').toBe(false);
  }
  return result;
}

async function compose(project: string, action: 'stop' | 'start') {
  const args = ['compose', '--project-name', project, '-f', 'compose.test.yml',
    ...(action === 'stop' ? ['stop', 'db'] : ['up', '-d', '--wait', '--wait-timeout', '60', 'db'])];
  try {
    await execFileAsync('docker', args, {
      cwd: root, env: process.env, windowsHide: true, timeout: 75_000
    });
  } catch {
    throw new Error(`TEST_DB_${action.toUpperCase()}_FAILED`);
  }
}

test('verify:bootstrap reports one probe across normal, database outage, and recovery states', async () => {
  test.setTimeout(240_000);
  const project = isolatedFixture();
  const targetId = randomUUID();
  const targetValue = randomBytes(24).toString('hex');
  const sentinelId = randomUUID();
  const sentinelValue = randomBytes(24).toString('hex');
  let targetAttempted = false;
  let sentinelAttempted = false;
  let dbStopAttempted = false;
  const failures: unknown[] = [];

  try {
    targetAttempted = true;
    await probe('create', targetId, targetValue);
    sentinelAttempted = true;
    await probe('create', sentinelId, sentinelValue);

    const normal = await verify(targetId, targetValue);
    expect(normal.code).toBe(0);
    expect(/^DATABASE: OK$/m.test(normal.output), 'normal database item').toBe(true);
    expect(/^PROBE: OK$/m.test(normal.output), 'normal probe item').toBe(true);
    console.log(`VERIFY_SEQUENCE_NORMAL: EXIT_${normal.code}`);

    dbStopAttempted = true;
    await compose(project, 'stop');
    const outage = await verify(targetId, targetValue);
    expect(outage.code).toBe(1);
    expect(/^DATABASE: FAIL$/m.test(outage.output), 'outage database failure item').toBe(true);
    console.log(`VERIFY_SEQUENCE_OUTAGE: EXIT_${outage.code} DATABASE_FAIL`);

    await compose(project, 'start');
    const recovery = await verify(targetId, targetValue);
    expect(recovery.code).toBe(0);
    expect(/^DATABASE: OK$/m.test(recovery.output), 'recovered database item').toBe(true);
    expect(/^PROBE: OK$/m.test(recovery.output), 'same stored probe after recovery').toBe(true);
    console.log(`VERIFY_SEQUENCE_RECOVERY: EXIT_${recovery.code}`);

    await probe('cleanup', targetId);
    await probeMissing(targetId, targetValue);
    targetAttempted = false;
    await probe('verify', sentinelId, sentinelValue);
    console.log('VERIFY_SEQUENCE_CLEANUP: TARGET_MISSING SENTINEL_VERIFIED');
  } catch (error) { failures.push(error); }
  finally {
    if (dbStopAttempted) {
      try { await compose(project, 'start'); }
      catch (error) { failures.push(error); }
    }
    if (targetAttempted) {
      try {
        await probe('cleanup', targetId);
        await probeMissing(targetId, targetValue);
      }
      catch (error) { failures.push(error); }
    }
    if (sentinelAttempted) {
      try {
        await probe('cleanup', sentinelId);
        await probeMissing(sentinelId, sentinelValue);
        console.log('VERIFY_SEQUENCE_FINAL_CLEANUP: SENTINEL_MISSING');
      }
      catch (error) { failures.push(error); }
    }
  }
  if (failures.length) throw new AggregateError(failures, 'VERIFY_SEQUENCE_TEST_FAILED');
});
