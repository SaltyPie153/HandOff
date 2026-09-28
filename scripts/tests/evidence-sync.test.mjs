import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { syncArguments, syncFile } from '../sync-evidence.mjs';

test('local connector accepts only an explicit file and reports dirty before upload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-evidence-test-'));
  const path = join(dir, 'contract.md');
  const sourceId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const calls = [];
  try {
    await writeFile(path, 'Explicit contract statement');
    const args = syncArguments(['--file', path, '--source-id', sourceId]);
    const http = async (url, options) => {
      calls.push({ url, options });
      return new Response('{}', { status: 200 });
    };
    const result = await syncFile(args, token, http);
    assert.equal(result.contentHash.length, 64);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].url.endsWith('/dirty'));
    assert.ok(calls[1].url.endsWith('/sync'));
    assert.equal(JSON.parse(calls[1].options.body).content, 'Explicit contract statement');
    assert.throws(() => syncArguments(['--file', path, '--source-id', sourceId, '--api-origin', 'http://public.example']));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
