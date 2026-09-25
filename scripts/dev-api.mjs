import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, validateConfig } from './lib/dev-environment.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = join(root, 'apps', 'api');
const compilerPath = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const entryPath = join(apiRoot, 'dist', 'src', 'main.js');
const host = '127.0.0.1';

async function checkApiPort(port) {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    if (error?.code === 'EADDRINUSE') throw new ConfigError('PORT_IN_USE', 'API_PORT');
    throw new ConfigError('BIND_FAILED', 'API_PORT');
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

function start(args) {
  return spawn(process.execPath, args, {
    cwd: apiRoot,
    env: process.env,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'inherit']
  });
}

function closed(child, name) {
  return new Promise(resolve => {
    child.once('close', code => resolve({ name, code }));
    child.once('error', () => resolve({ name, code: 1 }));
  });
}

async function within(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function stop(child, completion) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true
    });
    const finished = await within(new Promise(resolve => {
      killer.once('close', resolve);
      killer.once('error', resolve);
    }), 2_000);
    if (!finished) killer.kill('SIGKILL');
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
  if (!await within(completion, 2_000)) {
    child.kill('SIGKILL');
    if (!await within(completion, 1_000)) throw new Error('CLEANUP_TIMEOUT');
  }
}

async function run() {
  const config = validateConfig(process.env);
  await checkApiPort(config.apiPort);

  const compiler = start([compilerPath, '-p', join(apiRoot, 'tsconfig.json'), '--watch', '--preserveWatchOutput']);
  const compilerDone = closed(compiler, 'typescript');
  let stopping = false;
  let finished = false;
  let runtime;
  let runtimeDone;
  let resolveOutcome;
  const outcome = new Promise(resolve => { resolveOutcome = resolve; });
  const finish = result => {
    if (finished) return;
    finished = true;
    resolveOutcome(result);
  };
  const plannedStops = new WeakSet();
  let compilerOutput = '';
  let restart = Promise.resolve();
  compiler.stdout.on('data', chunk => {
    const text = chunk.toString();
    process.stdout.write(text);
    compilerOutput += text;
    let newline;
    while ((newline = compilerOutput.indexOf('\n')) !== -1) {
      const line = compilerOutput.slice(0, newline);
      compilerOutput = compilerOutput.slice(newline + 1);
      const summary = /Found (\d+) errors?\. Watching for file changes\./.exec(line);
      if (!summary) continue;
      restart = restart.then(async () => {
        if (stopping) return;
        if (runtime) {
          plannedStops.add(runtime);
          await stop(runtime, runtimeDone);
        }
        if (summary[1] !== '0' || stopping) return;
        runtime = start([entryPath]);
        runtime.stdout.pipe(process.stdout);
        runtimeDone = closed(runtime, 'node');
        const current = runtime;
        runtimeDone.then(result => {
          if (!stopping && !plannedStops.has(current)) finish(result);
        });
      }).catch(() => finish({ name: 'launcher', code: 1 }));
    }
  });
  compilerDone.then(result => { if (!stopping) finish(result); });
  process.once('SIGINT', () => finish({ name: 'signal', code: 0 }));
  process.once('SIGTERM', () => finish({ name: 'signal', code: 0 }));

  const result = await outcome;
  stopping = true;
  await restart;
  await Promise.all([stop(runtime, runtimeDone), stop(compiler, compilerDone)]);
  if (result.name === 'signal') return 0;
  process.stderr.write('DEV_API_FAILED: CHILD_FAILED: ' + result.name.toUpperCase() + '\n');
  return result.code || 1;
}

try {
  process.exitCode = await run();
} catch (error) {
  const diagnostic = error instanceof ConfigError ? error.message : 'INTERNAL_ERROR';
  process.stderr.write(`DEV_API_FAILED: ${diagnostic}\n`);
  process.exitCode = 1;
}
