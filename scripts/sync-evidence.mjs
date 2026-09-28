import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function syncArguments(args) {
  const values = new Map();
  const watch = args.includes('--watch');
  args = args.filter(arg => arg !== '--watch');
  for (let index = 0; index < args.length; index += 2) {
    if (!['--file', '--source-id', '--api-origin'].includes(args[index]) || !args[index + 1] || values.has(args[index])) {
      throw new Error('Use --file <approved file> --source-id <id> [--api-origin <origin>]');
    }
    values.set(args[index], args[index + 1]);
  }
  if (!values.has('--file') || !/^[0-9a-f-]{36}$/i.test(values.get('--source-id') ?? '')) {
    throw new Error('Use --file <approved file> --source-id <id> [--api-origin <origin>]');
  }
  const origin = new URL(values.get('--api-origin') ?? 'http://127.0.0.1:3000');
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)))) {
    throw new Error('API origin must be HTTPS or local loopback HTTP');
  }
  return { path: resolve(values.get('--file')), sourceId: values.get('--source-id'), origin: origin.origin, watch };
}

export async function syncFile({ path, sourceId, origin }, token, http = fetch) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('HANDOFF_SYNC_TOKEN is missing');
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink() || file.size > 60_000) throw new Error('Approved file is not a regular text file under 60 KB');
  const root = `${origin}/api/evidence/local/${encodeURIComponent(sourceId)}`;
  const options = { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  const dirty = await http(`${root}/dirty`, options);
  if (!dirty.ok) throw new Error(`Evidence dirty report failed (${dirty.status})`);
  const content = await readFile(path, 'utf8');
  const after = await lstat(path);
  if (!after.isFile() || after.isSymbolicLink() || after.ino !== file.ino || after.dev !== file.dev ||
      after.size !== file.size || after.mtimeMs !== file.mtimeMs || Buffer.byteLength(content, 'utf8') > 60_000) {
    throw new Error('File changed during sync; source remains marked stale');
  }
  const contentHash = createHash('sha256').update(content).digest('hex');
  const response = await http(`${root}/sync`, { ...options, body: JSON.stringify({ path, content, contentHash }) });
  if (!response.ok) throw new Error(`Evidence sync failed (${response.status})`);
  return { contentHash };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = syncArguments(process.argv.slice(2));
    const run = async () => {
      const result = await syncFile(args, process.env.HANDOFF_SYNC_TOKEN);
      console.log(`Evidence synced: ${result.contentHash}`);
    };
    if (args.watch) {
      await run().catch(error => console.error(error instanceof Error ? error.message : 'Evidence sync failed'));
      let busy = false;
      setInterval(() => {
        if (busy) return;
        busy = true;
        void run().catch(error => console.error(error instanceof Error ? error.message : 'Evidence sync failed'))
          .finally(() => { busy = false; });
      }, 60 * 60 * 1000);
    } else await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Evidence sync failed');
    process.exitCode = 1;
  }
}
