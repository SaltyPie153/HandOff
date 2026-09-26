import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaPath = new URL('../../apps/api/prisma/schema.prisma', import.meta.url);
const migrationPath = new URL(
  '../../apps/api/prisma/migrations/0001_bootstrap_probe/migration.sql',
  import.meta.url
);

test('BootstrapProbe schema and migration enforce the development probe contract', async () => {
  const [schema, migration] = await Promise.all([
    readFile(schemaPath, 'utf8'),
    readFile(migrationPath, 'utf8')
  ]);

  assert.match(schema, /model\s+BootstrapProbe\s*{/);
  assert.match(schema, /id\s+String\s+@id\s+@db\.Uuid/);
  assert.match(schema, /value\s+String\s+@db\.VarChar\(128\)/);
  assert.match(schema, /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\(['\x22]created_at['\x22]\)\s+@db\.Timestamptz\(6\)/);
  assert.match(schema, /@@map\(['\x22]bootstrap_probes['\x22]\)/);
  assert.doesNotMatch(schema, /User|Project|Contract|Handoff/);

  assert.match(migration, /CREATE TABLE ['\x22]?bootstrap_probes['\x22]?/);
  assert.match(migration, /['\x22]?id['\x22]? UUID NOT NULL/);
  assert.match(migration, /['\x22]?value['\x22]? VARCHAR\(128\) NOT NULL/);
  assert.match(migration, /char_length\(['\x22]?value['\x22]?\) BETWEEN 1 AND 128/);
  assert.match(migration, /['\x22]?created_at['\x22]? TIMESTAMPTZ\(6\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(migration, /PRIMARY KEY \(['\x22]?id['\x22]?\)/);
});
