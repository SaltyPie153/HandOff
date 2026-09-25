import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const host = '127.0.0.1';
const composeFile = join(root, 'compose.test.yml');
const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js');
const tscCli = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const viteCli = join(root, 'apps', 'web', 'node_modules', 'vite', 'bin', 'vite.js');
const apiRoot = join(root, 'apps', 'api');
const apiDist = join(apiRoot, 'dist');
const builtTests = join(apiRoot, 'dist', 'tests');
const ports = [['DB_PORT', 5433], ['API_PORT', 3001], ['WEB_PORT', 5174]];

function failure(label, reason) {
  return new Error(`${label}_FAILED: ${reason}`);
}

function launch(command, args, { cwd = root, env = process.env } = {}) {
  const child = spawn(command, args, {
    cwd, env, windowsHide: true, stdio: 'ignore', detached: process.platform !== 'win32'
  });
  const done = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('SPAWN_ERROR')));
    child.once('close', code => resolve(code ?? 1));
  });
  // A readiness failure may arrive before the caller awaits the child.
  void done.catch(() => undefined);
  return { child, done };
}

async function within(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function stopChild(running) {
  const { child, done } = running;
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
    await within(done.catch(() => 1), 3_000);
    return;
  }
  if (process.platform === 'win32') {
    const killer = launch('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    const code = await within(killer.done.catch(() => 1), 5_000);
    if (code !== 0 && child.exitCode === null && child.signalCode === null) {
      throw new Error('TASKKILL_FAILED');
    }
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch { child.kill('SIGTERM'); }
  }
  await within(done.catch(() => 1), 5_000);
}

export async function runCommand(command, args, {
  label, timeoutMs = 60_000, cwd = root, env = process.env, signal, onSpawn
}) {
  const running = launch(command, args, { cwd, env });
  let timer;
  let abortHandler;
  try {
    if (running.child.pid) onSpawn?.(running.child.pid);
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
    });
    const aborted = new Promise((_, reject) => {
      abortHandler = () => reject(new Error('ABORTED'));
      if (signal?.aborted) abortHandler();
      else signal?.addEventListener('abort', abortHandler, { once: true });
    });
    const code = await Promise.race([running.done, deadline, aborted]);
    if (code !== 0) throw failure(label, `EXIT_${code}`);
  } catch (error) {
    if (childIsRunning(running.child)) {
      try { await stopChild(running); }
      catch { throw failure(label, 'CLEANUP_FAILED'); }
    }
    if (error.message?.startsWith(`${label}_FAILED:`)) throw error;
    throw failure(label, error.message === 'TIMEOUT' ? 'TIMEOUT' :
      error.message === 'ABORTED' ? 'ABORTED' : 'SPAWN_ERROR');
  } finally {
    clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener('abort', abortHandler);
  }
}

function childIsRunning(child) {
  return child.pid && child.exitCode === null && child.signalCode === null;
}

export async function requireFreePorts(entries) {
  for (const [name, port] of entries) {
    const server = createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
    } catch (error) {
      throw new Error(`${error.code === 'EADDRINUSE' ? 'PORT_IN_USE' : 'PORT_CHECK_FAILED'}: ${name}`);
    } finally {
      if (server.listening) {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    }
  }
}

export async function cleanupSteps(steps) {
  const failed = [];
  for (const [name, cleanup] of [...steps].reverse()) {
    try { await cleanup(); }
    catch { failed.push(name.toUpperCase()); }
  }
  if (failed.length) throw new Error(`CLEANUP_FAILED: ${failed.join(',')}`);
}

export async function discoverIntegrationTests(dir = builtTests) {
  const files = await readdir(dir);
  if (!files.includes('health.contract.test.js')) throw new Error('TEST_DISCOVERY_FAILED: HEALTH_CONTRACT');
  return files.filter(name => name === 'health.contract.test.js' || name.endsWith('.integration.test.js'))
    .sort().map(name => join(dir, name));
}

export async function cleanApiBuild(target = apiDist, allowedRoot = apiRoot) {
  const resolvedRoot = resolve(allowedRoot);
  const resolvedTarget = resolve(target);
  if (basename(resolvedTarget) !== 'dist' || dirname(resolvedTarget) !== resolvedRoot ||
      await realpath(dirname(resolvedTarget)) !== await realpath(resolvedRoot)) {
    throw new Error('UNSAFE_BUILD_DIRECTORY');
  }
  let entry;
  try { entry = await lstat(resolvedTarget); }
  catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('UNSAFE_BUILD_DIRECTORY');
  await rm(resolvedTarget, { recursive: true, force: true });
}

async function downFoundationProject(project) {
  await runCommand('docker', ['compose', '--project-name', project, '-f', composeFile, 'down', '--volumes'], {
    label: 'FOUNDATION_DOWN', timeoutMs: 45_000,
    env: { ...process.env, POSTGRES_PASSWORD: 'cleanup-only' }
  });
}

export async function runFoundationDatabaseTest({
  testCommand = process.execPath,
  testArgs = [join(root, 'scripts', 'tests', 'database-setup.test.mjs')],
  downProject = downFoundationProject,
  signal
} = {}) {
  let project;
  let error;
  try {
    // Direct execution keeps the node:test file in this child PID.
    await runCommand(testCommand, testArgs, {
      label: 'DATABASE_SETUP_TEST', timeoutMs: 150_000, signal,
      onSpawn: pid => { project = `handoff-foundation-${pid}`; }
    });
  } catch (caught) {
    error = caught;
  } finally {
    if (project) {
      try { await downProject(project); }
      catch {
        const cleanup = new Error('CLEANUP_FAILED: FOUNDATION_DATABASE');
        error = error ? new Error(`${error.message}; ${cleanup.message}`) : cleanup;
      }
    }
  }
  if (error) throw error;
}

function testSettings(password) {
  const databaseUrl = `postgresql://handoff:${password}@${host}:5433/handoff_test`;
  const values = {
    NODE_ENV: 'test', API_PORT: '3001', WEB_PORT: '5174', DB_PORT: '5433',
    POSTGRES_USER: 'handoff', POSTGRES_PASSWORD: password,
    POSTGRES_DB: 'handoff_test', DATABASE_URL: databaseUrl
  };
  return { values, content: Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n' };
}

function composeArgs(project, envPath, ...args) {
  return ['compose', '--project-name', project, '--env-file', envPath, '-f', composeFile, ...args];
}

async function waitReady(url, label, running, signal) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw failure(label, 'ABORTED');
    if (!childIsRunning(running.child)) throw failure(label, 'CHILD_EXITED');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* Startup is still in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw failure(label, 'READINESS_TIMEOUT');
}

export async function createTestEnvironment({ withServices = false, signal } = {}) {
  await requireFreePorts(ports);
  const workRoot = join(root, 'work');
  await mkdir(workRoot, { recursive: true });
  const directory = await mkdtemp(join(workRoot, 'test-run-'));
  const project = `handoff-test-${process.pid}-${randomBytes(5).toString('hex')}`;
  const envPath = join(directory, '.env');
  const { values, content } = testSettings(randomBytes(24).toString('hex'));
  const env = { ...process.env, ...values };
  const steps = [['settings', () => rm(directory, { recursive: true, force: true })]];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await cleanupSteps(steps);
  };
  try {
    await writeFile(envPath, content, { mode: 0o600, flag: 'wx' });
    // Register before up: Compose can create a container or volume before reporting failure.
    steps.push(['database', () => runCommand('docker', composeArgs(project, envPath, 'down', '--volumes'), {
      label: 'DB_DOWN', timeoutMs: 45_000
    })]);
    await runCommand('docker', composeArgs(project, envPath, 'up', '-d', '--wait', '--wait-timeout', '60'), {
      label: 'DB_UP', timeoutMs: 75_000, signal
    });
    await runCommand(process.execPath, [prismaCli, 'generate', '--config', 'apps/api/prisma.config.ts'], {
      label: 'PRISMA_GENERATE', timeoutMs: 60_000, env, signal
    });
    await runCommand(process.execPath, [prismaCli, 'migrate', 'deploy', '--config', 'apps/api/prisma.config.ts'], {
      label: 'DB_MIGRATE', timeoutMs: 60_000, env, signal
    });
    await cleanApiBuild();
    await runCommand(process.execPath, [tscCli, '-p', join(apiRoot, 'tsconfig.json')], {
      label: 'API_BUILD', timeoutMs: 60_000, env, signal
    });
    if (withServices) {
      const api = launch(process.execPath, [join(apiRoot, 'dist', 'src', 'main.js')], { env });
      steps.push(['api', () => stopChild(api)]);
      await waitReady(`http://${host}:3001/api/health/ready`, 'API', api, signal);
      const web = launch(process.execPath, [viteCli, 'apps/web', '--host', host], { env });
      steps.push(['web', () => stopChild(web)]);
      await waitReady(`http://${host}:5174/`, 'WEB', web, signal);
    }
    return { env, project, close };
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new Error(`${error.message}; ${cleanupError.message}`); }
    throw error;
  }
}

async function main() {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let environment;
  let error;
  try {
    await requireFreePorts(ports);
    console.log('INTEGRATION_TESTS: scripts/tests/database-setup.test.mjs');
    await runFoundationDatabaseTest({ signal: controller.signal });
    environment = await createTestEnvironment({ signal: controller.signal });
    const files = await discoverIntegrationTests();
    console.log(`INTEGRATION_TESTS: ${files.map(file => file.slice(root.length)).join(', ')}`);
    await runCommand(process.execPath, ['--test', ...files], {
      label: 'INTEGRATION_TEST', timeoutMs: 120_000, env: environment.env, signal: controller.signal
    });
  } catch (caught) {
    error = caught;
  } finally {
    try { await environment?.close(); }
    catch (cleanupError) { error = error ? new Error(`${error.message}; ${cleanupError.message}`) : cleanupError; }
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
  if (error) {
    console.error(`TEST_INTEGRATION_FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
