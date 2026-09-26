import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfig, ConfigError } from './lib/dev-environment.mjs';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ProbeInputError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function parseArgs(args) {
  const [action, ...options] = args;
  if (!['create', 'verify', 'cleanup'].includes(action)) {
    throw new ProbeInputError('INVALID_ACTION');
  }
  const parsed = {};
  for (let index = 0; index < options.length; index += 2) {
    const flag = options[index];
    if (!['--id', '--value'].includes(flag) || parsed[flag] !== undefined ||
        index + 1 >= options.length) {
      throw new ProbeInputError('INVALID_ARGUMENTS');
    }
    parsed[flag] = options[index + 1];
  }
  if (!uuidPattern.test(parsed['--id'] ?? '')) throw new ProbeInputError('INVALID_ID');
  if (action === 'cleanup') {
    if (parsed['--value'] !== undefined) throw new ProbeInputError('INVALID_ARGUMENTS');
  } else {
    const length = Array.from(parsed['--value'] ?? '').length;
    if (length < 1 || length > 128) throw new ProbeInputError('INVALID_VALUE');
  }
  return { action, id: parsed['--id'], value: parsed['--value'] };
}

async function run() {
  const { action, id, value } = parseArgs(process.argv.slice(2));
  const config = process.env.DATABASE_URL
    ? validateConfig(process.env)
    : await loadConfig(envPath, process.env);
  const { PrismaService } = await import('../apps/api/dist/src/database/prisma.service.js');
  const { ProbeRepository } = await import('../apps/api/dist/src/database/probe.repository.js');
  const prisma = new PrismaService({ databaseUrl: config.databaseUrl });
  try {
    const repository = new ProbeRepository(prisma);
    const result = action === 'create'
      ? await repository.create(id, value)
      : action === 'verify'
        ? await repository.verify(id, value)
        : (await repository.cleanup(id), 'cleaned');
    if (result === 'conflict' || result === 'missing' || result === 'mismatch') {
      console.error(`PROBE_${result.toUpperCase()}`);
      process.exitCode = 1;
    } else {
      console.log(`PROBE_${result.toUpperCase()}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await run();
} catch (error) {
  const diagnostic = error instanceof ConfigError
    ? error.message
    : error instanceof ProbeInputError
      ? error.code
      : 'DATABASE_ERROR';
  console.error(`PROBE_FAILED: ${diagnostic}`);
  process.exitCode = 1;
}
