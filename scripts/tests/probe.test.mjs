import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { validateConfig } from '../lib/dev-environment.mjs';
import { createTestEnvironment } from '../test-integration.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const probeScript = join(root, 'scripts', 'probe.mjs');

function assertIsolatedTestEnvironment(env) {
  const config = validateConfig(env);
  assert.equal(config.nodeEnv, 'test');
  assert.equal(config.databaseName, 'handoff_test');
  assert.equal(config.databaseHost, '127.0.0.1');
  assert.equal(config.dbPort, 5433);
  assert.match(env.HANDOFF_TEST_PROJECT ?? '', /^handoff-test-[0-9]+-[a-f0-9]{10}$/);
  return config;
}

function runProbe(env, action, id, value) {
  const args = [probeScript, action, '--id', id];
  if (value !== undefined) args.push('--value', value);
  const result = spawnSync(process.execPath, args, {
    cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 20_000
  });
  assert.equal(result.error, undefined, 'probe process must terminate');
  // Never include child output in assertion diagnostics: it might contain credentials.
  assert.equal(result.stdout.includes(env.POSTGRES_PASSWORD), false);
  assert.equal(result.stderr.includes(env.POSTGRES_PASSWORD), false);
  assert.equal(result.stdout.includes(env.DATABASE_URL), false);
  assert.equal(result.stderr.includes(env.DATABASE_URL), false);
  assert.equal(/MODULE_NOT_FOUND/.test(result.stderr), false, 'probe CLI entrypoint must exist');
  return result.status;
}

async function readProbe(client, id) {
  const result = await client.query(
    'SELECT id, value, created_at FROM bootstrap_probes WHERE id = $1::uuid', [id]
  );
  return result.rows[0] ?? null;
}

test('probe CLI validates inputs and changes only its own rows in an isolated test database',
  { timeout: 180_000 }, async t => {
    const ownedEnvironment = process.env.HANDOFF_TEST_PROJECT ? null : await createTestEnvironment();
    const env = ownedEnvironment
      ? { ...process.env, ...ownedEnvironment.env, HANDOFF_TEST_PROJECT: ownedEnvironment.project }
      : process.env;
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    let client;
    try {
      const config = assertIsolatedTestEnvironment(env);
      client = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 2_000 });
      await client.connect();

      await t.test('accepts one and 128 character values and rejects invalid UUID or value lengths', async () => {
        assert.equal(runProbe(env, 'create', ids[0], 'x'), 0);
        assert.equal((await readProbe(client, ids[0])).value, 'x');
        assert.equal(runProbe(env, 'create', ids[1], 'a'.repeat(128)), 0);
        assert.equal((await readProbe(client, ids[1])).value, 'a'.repeat(128));

        for (const action of ['create', 'verify', 'cleanup']) {
          assert.equal(runProbe(env, action, 'not-a-uuid', action === 'cleanup' ? undefined : 'x'), 1);
        }
        assert.equal(runProbe(env, 'create', ids[2], ''), 1);
        assert.equal(runProbe(env, 'create', ids[2], 'a'.repeat(129)), 1);
        assert.equal(await readProbe(client, ids[2]), null);
      });

      await t.test('repeating the same id and value preserves the original row; a different value conflicts', async () => {
        const before = await readProbe(client, ids[0]);
        assert.equal(runProbe(env, 'create', ids[0], 'x'), 0);
        const retry = await readProbe(client, ids[0]);
        assert.deepEqual(retry, before);
        assert.equal(runProbe(env, 'create', ids[0], 'different'), 1);
        assert.deepEqual(await readProbe(client, ids[0]), before);
      });

      await t.test('verify fails for absent or mismatched data without creating or changing rows', async () => {
        const before = await readProbe(client, ids[0]);
        assert.equal(runProbe(env, 'verify', ids[0], 'x'), 0);
        assert.equal(runProbe(env, 'verify', ids[0], 'different'), 1);
        assert.equal(runProbe(env, 'verify', ids[2], 'x'), 1);
        assert.deepEqual(await readProbe(client, ids[0]), before);
        assert.equal(await readProbe(client, ids[2]), null);
      });

      await t.test('cleanup deletes only the selected id', async () => {
        assert.equal(runProbe(env, 'create', ids[3], 'keep'), 0);
        assert.equal(runProbe(env, 'cleanup', ids[1]), 0);
        assert.equal(await readProbe(client, ids[1]), null);
        assert.equal((await readProbe(client, ids[3])).value, 'keep');
      });

      await t.test('production and remote targets are refused before changing test data', async () => {
        const before = await readProbe(client, ids[3]);
        assert.equal(runProbe({ ...env, NODE_ENV: 'production' }, 'create', ids[4], 'blocked'), 1);
        assert.equal(runProbe({ ...env,
          DATABASE_URL: env.DATABASE_URL.replace('127.0.0.1', 'db.example.invalid')
        }, 'create', ids[4], 'blocked'), 1);
        assert.equal(await readProbe(client, ids[4]), null);
        assert.deepEqual(await readProbe(client, ids[3]), before);
      });
    } finally {
      try {
        if (client) {
          try {
            await client.query('DELETE FROM bootstrap_probes WHERE id = ANY($1::uuid[])', [ids]);
          } finally {
            await client.end();
          }
        }
      } finally {
        await ownedEnvironment?.close();
      }
    }
  });
