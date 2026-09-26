import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { validateConfig } from '../lib/dev-environment.mjs';
import { createTestEnvironment, runCommand } from '../test-integration.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const verifyScript = join(root, 'scripts', 'verify-bootstrap.mjs');
const composeFile = join(root, 'compose.test.yml');

function assertIsolatedTestEnvironment(env) {
  const config = validateConfig(env);
  assert.equal(config.nodeEnv, 'test');
  assert.equal(config.databaseName, 'handoff_test');
  assert.equal(config.databaseHost, '127.0.0.1');
  assert.equal(config.dbPort, 5433);
  assert.match(env.HANDOFF_TEST_PROJECT ?? '', /^handoff-test-[0-9]+-[a-f0-9]{10}$/);
  return config;
}

function runVerify(env, args, secretValue) {
  const result = spawnSync(process.execPath, [verifyScript, ...args], {
    cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 20_000
  });
  assert.equal(result.error === undefined, true, 'verify process must terminate');
  const output = result.stdout + result.stderr;
  // Do not pass child output to assertions: it could contain credentials.
  for (const secret of [env.POSTGRES_PASSWORD, env.DATABASE_URL, secretValue]) {
    assert.equal(output.includes(secret), false, 'verify output must omit secret values');
  }
  assert.equal(/MODULE_NOT_FOUND/.test(output), false, 'verify CLI entrypoint must exist');
  return { status: result.status, output };
}

function assertCheckResult(output, label, state, message) {
  // A nearby state must belong to this item, not to a different item in a summary.
  const separator = '(?:[ \\t]+(?:check|status|상태))?[ \\t:._=/-]+';
  const start = '(?:^|[ \\t,;{\\[])';
  const end = '(?=$|[ \\t,;}:\\]])';
  const itemFirst = new RegExp(start + '(?:' + label + ')' + separator +
    '(?:' + state + ')' + end, 'i');
  const stateFirst = new RegExp(start + '(?:' + state + ')[ \\t:._=/-]+' +
    '(?:' + label + ')' + end, 'i');
  assert.equal(output.split(/\r?\n/).some(line => itemFirst.test(line) || stateFirst.test(line)),
    true, message);
}

const successState = 'ok|pass(?:ed)?|ready|success(?:ful)?|match(?:ed)?|정상|성공|일치';
const databaseFailure = 'unavailable|degraded|fail(?:ed|ure)?|error|실패|불가|오류';
const probeFailure = 'mismatch|missing|absent|not[_ -]?found|fail(?:ed|ure)?|error|불일치|없음|누락|실패|오류';

async function readProbe(client, id) {
  const result = await client.query(
    'SELECT id, value, created_at FROM bootstrap_probes WHERE id = $1::uuid', [id]
  );
  return result.rows[0] ?? null;
}

async function compose(env, project, ...args) {
  await runCommand('docker', ['compose', '--project-name', project, '-f', composeFile, ...args], {
    label: 'VERIFY_TEST_DATABASE', timeoutMs: 75_000, env
  });
}

async function controlApi(url, token, action) {
  assert.match(url ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(token, 'test API control token must be provided');
  const response = await fetch(`${url}/${action}`, {
    method: 'POST', headers: { 'x-test-control-token': token },
    signal: AbortSignal.timeout(15_000)
  });
  assert.ok(response.status === 204 || (action === 'start' && response.status === 409),
    `test API ${action} control failed`);
}

test('verify-bootstrap checks an existing probe and reports failures in an isolated test database',
  { timeout: 240_000 }, async t => {
    const ownedEnvironment = process.env.HANDOFF_TEST_PROJECT
      ? null : await createTestEnvironment({ withServices: true });
    const env = ownedEnvironment
      ? { ...process.env, ...ownedEnvironment.env, HANDOFF_TEST_PROJECT: ownedEnvironment.project }
      : process.env;
    const id = randomUUID();
    const absentId = randomUUID();
    const storedValue = `probe-secret-${randomUUID()}`;
    const wrongValue = `wrong-secret-${randomUUID()}`;
    const apiControlUrl = ownedEnvironment?.apiControlUrl ?? env.HANDOFF_TEST_CONTROL_URL;
    const apiControlToken = ownedEnvironment?.apiControlToken ?? env.HANDOFF_TEST_CONTROL_TOKEN;
    let client;
    let config;
    let databaseStopped = false;
    try {
      config = assertIsolatedTestEnvironment(env);
      client = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 2_000 });
      await client.connect();
      await client.query('INSERT INTO bootstrap_probes (id, value) VALUES ($1::uuid, $2)', [id, storedValue]);

      await t.test('requires both --id and --value', () => {
        for (const args of [[], ['--id', id], ['--value', storedValue]]) {
          assert.equal(runVerify(env, args, storedValue).status, 1);
        }
      });

      await t.test('reports service, database, and stored-probe checks with exit 0', () => {
        const result = runVerify(env, ['--id', id, '--value', storedValue], storedValue);
        assert.equal(result.status, 0);
        assertCheckResult(result.output, 'service|health|서비스|진단', successState,
          'service diagnosis must report success');
        assertCheckResult(result.output, 'database|db|저장소', successState,
          'database diagnosis must report success');
        assertCheckResult(result.output, 'probe|검증[ -]?자료|저장값', successState,
          'stored-probe check must report success');
      });

      await t.test('mismatched stored value exits 1 and names the failed probe check', async () => {
        const before = await readProbe(client, id);
        const result = runVerify(env, ['--id', id, '--value', wrongValue], wrongValue);
        assert.equal(result.status, 1);
        assertCheckResult(result.output, 'probe|검증[ -]?자료|저장값', probeFailure,
          'mismatch must report a failed stored-probe check');
        const after = await readProbe(client, id);
        assert.equal(after?.id, before?.id);
        assert.equal(after?.value === storedValue, true, 'mismatch must not change the stored value');
        assert.deepEqual(after?.created_at, before?.created_at);
      });

      await t.test('missing probe exits 1 without creating a row', async () => {
        assert.equal(await readProbe(client, absentId), null);
        const result = runVerify(env, ['--id', absentId, '--value', storedValue], storedValue);
        assert.equal(result.status, 1);
        assertCheckResult(result.output, 'probe|검증[ -]?자료|저장값', probeFailure,
          'missing probe must report a failed stored-probe check');
        assert.equal(await readProbe(client, absentId), null);
      });

      await t.test('API outage keeps the database and probe healthy while the service fails', async () => {
        try {
          await controlApi(apiControlUrl, apiControlToken, 'stop');
          const result = runVerify(env, ['--id', id, '--value', storedValue], storedValue);
          assert.equal(result.status, 1);
          assertCheckResult(result.output, 'service|서비스', databaseFailure,
            'stopped API must fail the service check');
          assertCheckResult(result.output, 'database|db|저장소', successState,
            'direct database read must report a healthy database');
          assertCheckResult(result.output, 'probe|검증[ -]?자료|저장값', successState,
            'stored probe must still match while the API is stopped');
        } finally {
          await controlApi(apiControlUrl, apiControlToken, 'start');
        }
        assert.equal(runVerify(env, ['--id', id, '--value', storedValue], storedValue).status, 0);
      });

      await t.test('database outage exits 1 and names the failed database check', async () => {
        await client.end();
        client = undefined;
        databaseStopped = true;
        try {
          await compose(env, env.HANDOFF_TEST_PROJECT, 'stop', 'db');
          const result = runVerify(env, ['--id', id, '--value', storedValue], storedValue);
          assert.equal(result.status, 1);
          assertCheckResult(result.output, 'database|db|저장소', databaseFailure,
            'outage must report a failed database check');

          for (const [unsafeEnv, expected] of [
            [{ ...env, NODE_ENV: 'production' }, 'UNSAFE_ENVIRONMENT: NODE_ENV'],
            [{ ...env, DATABASE_URL: env.DATABASE_URL.replace('127.0.0.1', 'db.example.invalid') },
              'UNSAFE_DATABASE_HOST: DATABASE_URL']
          ]) {
            const guarded = runVerify(unsafeEnv, ['--id', id, '--value', storedValue], storedValue);
            assert.equal(guarded.status, 1);
            assert.equal(guarded.output.includes(expected), true,
              'unsafe target must be rejected by the configuration guard before DB access');
          }
        } finally {
          await compose(env, env.HANDOFF_TEST_PROJECT, 'up', '-d', '--wait', '--wait-timeout', '60', 'db');
          databaseStopped = false;
        }
        assert.equal(runVerify(env, ['--id', id, '--value', storedValue], storedValue).status, 0);
      });
    } finally {
      try {
        if (databaseStopped) {
          await compose(env, env.HANDOFF_TEST_PROJECT, 'up', '-d', '--wait', '--wait-timeout', '60', 'db');
        }
        if (!client && config) {
          client = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 2_000 });
          await client.connect();
        }
        if (client) {
          try {
            await client.query('DELETE FROM bootstrap_probes WHERE id = ANY($1::uuid[])', [[id, absentId]]);
          } finally {
            await client.end();
          }
        }
      } finally {
        await ownedEnvironment?.close();
      }
    }
  });
