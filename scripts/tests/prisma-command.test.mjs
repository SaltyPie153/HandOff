import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPrismaCommand } from '../lib/prisma-command.mjs';

const validEnv = [
  'NODE_ENV=test',
  'API_PORT=3001',
  'WEB_PORT=5174',
  'DB_PORT=5433',
  'POSTGRES_USER=handoff',
  'POSTGRES_PASSWORD=test-value',
  'POSTGRES_DB=handoff_test',
  'DATABASE_URL=postgresql://handoff:test-value@127.0.0.1:5433/handoff_test',
  ''
].join('\n');

function successfulSpawn(calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0));
    return child;
  };
}

test('generate and migrate use separate Prisma CLI commands with validated local env', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-prisma-'));
  const envPath = join(dir, '.env');
  const calls = [];
  try {
    await writeFile(envPath, validEnv);
    assert.equal(await runPrismaCommand('generate', { envPath, spawnImpl: successfulSpawn(calls) }), 0);
    assert.equal(await runPrismaCommand('migrate', { envPath, spawnImpl: successfulSpawn(calls) }), 0);
    assert.deepEqual(calls[0].args.slice(-3), ['generate', '--config', 'apps/api/prisma.config.ts']);
    assert.deepEqual(calls[1].args.slice(-4), ['migrate', 'deploy', '--config', 'apps/api/prisma.config.ts']);
    assert.equal(calls[1].options.env.DATABASE_URL.includes('handoff_test'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('migrate rejects an unsafe target before spawning Prisma', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-prisma-'));
  const envPath = join(dir, '.env');
  let spawned = false;
  try {
    await writeFile(envPath, validEnv.replace('127.0.0.1', 'db.example.com'));
    await assert.rejects(
      runPrismaCommand('migrate', {
        envPath,
        spawnImpl: () => {
          spawned = true;
          throw new Error('must not spawn');
        }
      }),
      /UNSAFE_DATABASE_HOST/
    );
    assert.equal(spawned, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
