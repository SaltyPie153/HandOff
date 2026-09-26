import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { runPrismaCommand } from '../lib/prisma-command.mjs';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const composePath = join(root, 'compose.test.yml');

function envText(password) {
  return [
    'NODE_ENV=test',
    'API_PORT=3001',
    'WEB_PORT=5174',
    'DB_PORT=5433',
    'POSTGRES_USER=handoff',
    `POSTGRES_PASSWORD=${password}`,
    'POSTGRES_DB=handoff_test',
    `DATABASE_URL=postgresql://handoff:${password}@127.0.0.1:5433/handoff_test`,
    ''
  ].join('\n');
}

async function compose(project, envPath, ...args) {
  return await execFileAsync(
    'docker',
    ['compose', '--project-name', project, '--env-file', envPath, '-f', composePath, ...args],
    { cwd: root, windowsHide: true }
  );
}

test('empty test database migrates explicitly and reapplies without reset', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-db-setup-'));
  const envPath = join(dir, '.env');
  const password = randomBytes(18).toString('base64url');
  const databaseUrl = `postgresql://handoff:${password}@127.0.0.1:5433/handoff_test`;
  const project = `handoff-foundation-${process.pid}`;
  let started = false;
  try {
    await writeFile(envPath, envText(password), { mode: 0o600 });
    await compose(project, envPath, 'up', '-d', '--wait', '--wait-timeout', '60');
    started = true;

    const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    await client.connect();
    try {
      const before = await client.query(`SELECT to_regclass('public.bootstrap_probes') AS table_name`);
      assert.equal(before.rows[0].table_name, null);
    } finally {
      await client.end();
    }

    assert.equal(await runPrismaCommand('migrate', { envPath }), 0);
    assert.equal(await runPrismaCommand('migrate', { envPath }), 0);

    const verified = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    await verified.connect();
    try {
      const table = await verified.query(`SELECT to_regclass('public.bootstrap_probes') AS table_name`);
      const rows = await verified.query('SELECT count(*)::int AS count FROM bootstrap_probes');
      assert.equal(table.rows[0].table_name, 'bootstrap_probes');
      assert.equal(rows.rows[0].count, 0);
    } finally {
      await verified.end();
    }
  } finally {
    if (started) {
      await compose(project, envPath, 'down', '--volumes');
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('migration rejects production and remote database targets before spawning Prisma', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-db-guard-'));
  const envPath = join(dir, '.env');
  let spawned = false;
  const spawnImpl = () => {
    spawned = true;
    throw new Error('must not spawn');
  };
  try {
    await writeFile(envPath, envText('guard-value').replace('NODE_ENV=test', 'NODE_ENV=production'));
    await assert.rejects(runPrismaCommand('migrate', { envPath, spawnImpl }), /UNSAFE_ENVIRONMENT/);

    await writeFile(envPath, envText('guard-value').replace('127.0.0.1', 'db.example.com'));
    await assert.rejects(runPrismaCommand('migrate', { envPath, spawnImpl }), /UNSAFE_DATABASE_HOST/);
    assert.equal(spawned, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
