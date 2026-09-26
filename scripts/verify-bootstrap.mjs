import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig, validateConfig } from './lib/dev-environment.mjs';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class InputError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--id', '--value'].includes(flag) || values[flag] !== undefined ||
        index + 1 >= args.length) {
      throw new InputError('INVALID_ARGUMENTS');
    }
    values[flag] = args[index + 1];
  }
  if (!uuidPattern.test(values['--id'] ?? '')) throw new InputError('INVALID_ID');
  const length = Array.from(values['--value'] ?? '').length;
  if (length < 1 || length > 128) throw new InputError('INVALID_VALUE');
  return { id: values['--id'], value: values['--value'] };
}

async function checkHealth(apiPort) {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/health/ready`, {
      signal: AbortSignal.timeout(5_000)
    });
    const health = await response.json();
    if (!health || typeof health !== 'object' || Array.isArray(health) ||
        health.service !== 'ok' ||
        !['ready', 'degraded'].includes(health.status) ||
        !['ok', 'unavailable', 'schema_missing'].includes(health.database) ||
        !['OK', 'DATABASE_UNAVAILABLE', 'SCHEMA_NOT_READY'].includes(health.code) ||
        typeof health.checkedAt !== 'string' ||
        Number.isNaN(Date.parse(health.checkedAt))) {
      return { service: false, database: false };
    }
    return {
      service: response.status === 200 || response.status === 503,
      database: response.status === 200 && health.status === 'ready' &&
        health.database === 'ok' && health.code === 'OK'
    };
  } catch {
    return { service: false, database: false };
  }
}

async function checkProbe(databaseUrl, id, value) {
  let prisma;
  try {
    const { PrismaService } = await import('../apps/api/dist/src/database/prisma.service.js');
    const { ProbeRepository } = await import('../apps/api/dist/src/database/probe.repository.js');
    prisma = new PrismaService({ databaseUrl });
    const result = await new ProbeRepository(prisma).verify(id, value);
    return { database: true, probe: result === 'verified' ? 'OK' : result.toUpperCase() };
  } catch {
    return { database: false, probe: 'FAIL' };
  } finally {
    await prisma?.$disconnect();
  }
}

async function run() {
  const { id, value } = parseArgs(process.argv.slice(2));
  const config = process.env.DATABASE_URL
    ? validateConfig(process.env)
    : await loadConfig(envPath, process.env);
  const health = await checkHealth(config.apiPort);
  const stored = await checkProbe(config.databaseUrl, id, value);
  const database = health.database && stored.database;
  console.log(`SERVICE: ${health.service ? 'OK' : 'FAIL'}`);
  console.log(`DATABASE: ${database ? 'OK' : 'FAIL'}`);
  console.log(`PROBE: ${stored.probe}`);
  console.log(`CHECKED_AT: ${new Date().toISOString()}`);
  if (!health.service || !database || stored.probe !== 'OK') process.exitCode = 1;
}

try {
  await run();
} catch (error) {
  const diagnostic = error instanceof ConfigError || error instanceof InputError
    ? error.message
    : 'CHECK_FAILED';
  console.error(`VERIFY_BOOTSTRAP_FAILED: ${diagnostic}`);
  process.exitCode = 1;
}
