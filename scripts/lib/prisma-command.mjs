import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './dev-environment.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const defaultEnvPath = fileURLToPath(new URL('../../.env', import.meta.url));
const prismaCli = fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url));
const prismaConfig = 'apps/api/prisma.config.ts';

function argsFor(action) {
  if (action === 'generate') {
    return [prismaCli, 'generate', '--config', prismaConfig];
  }
  if (action === 'migrate') {
    return [prismaCli, 'migrate', 'deploy', '--config', prismaConfig];
  }
  const error = new Error('INVALID_PRISMA_ACTION');
  error.code = 'INVALID_PRISMA_ACTION';
  throw error;
}

export async function runPrismaCommand(
  action,
  {
    envPath = defaultEnvPath,
    spawnImpl = spawn,
    nodePath = process.execPath
  } = {}
) {
  const config = await loadConfig(envPath);
  const child = spawnImpl(nodePath, argsFor(action), {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: config.databaseUrl
    },
    stdio: 'inherit',
    windowsHide: true
  });
  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
}
