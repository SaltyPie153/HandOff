import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDbCommand } from '../db.mjs';

const root = join(tmpdir(), 'handoff-db-owner');
const composePath = join(root, 'compose.dev.yml');
const validEnv = [
  'NODE_ENV=development', 'API_PORT=3000', 'WEB_PORT=5173', 'DB_PORT=5432',
  'POSTGRES_USER=handoff', 'POSTGRES_PASSWORD=file-password',
  'POSTGRES_DB=handoff_dev',
  'DATABASE_URL=postgresql://handoff:file-password@127.0.0.1:5432/handoff_dev', ''
].join('\n');

async function withEnv(run) {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-db-command-'));
  const envPath = join(dir, '.env');
  try {
    await writeFile(envPath, validEnv);
    await run(envPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function labels(workingDir = root, configFile = composePath) {
  return JSON.stringify({
    'com.docker.compose.project': 'handoff-dev',
    'com.docker.compose.project.working_dir': workingDir,
    'com.docker.compose.project.config_files': configFile
  });
}

function dockerFixture(containerIds, labelsById = {}) {
  const inspections = [];
  const actions = [];
  return {
    inspections,
    actions,
    runDocker: async args => {
      inspections.push(args);
      if (args[0] === 'ps') return `${containerIds.join('\n')}${containerIds.length ? '\n' : ''}`;
      if (args[0] === 'inspect') return `${labelsById[args.at(-1)]}\n`;
      throw new Error(`unexpected docker query: ${args[0]}`);
    },
    spawnImpl: (command, args, options) => {
      actions.push({ command, args, options });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    }
  };
}

test('up and down reject a container from another checkout before Compose action', async () => {
  await withEnv(async envPath => {
    for (const action of ['up', 'down']) {
      const docker = dockerFixture(['foreign'], { foreign: labels(join(root, 'other'), join(root, 'other', 'compose.dev.yml')) });
      await assert.rejects(
        runDbCommand(action, { envPath, root, composePath, ...docker }),
        error => error.code === 'COMPOSE_PROJECT_MISMATCH' && !error.message.includes('other')
      );
      assert.equal(docker.actions.length, 0);
    }
  });
});

test('all existing project containers must have matching working directory and config file', async () => {
  await withEnv(async envPath => {
    const docker = dockerFixture(['own', 'foreign'], {
      own: labels(), foreign: labels(root, join(root, 'other.yml'))
    });
    await assert.rejects(
      runDbCommand('down', { envPath, root, composePath, ...docker }),
      error => error.code === 'COMPOSE_PROJECT_MISMATCH'
    );
    assert.equal(docker.actions.length, 0);
    assert.equal(docker.inspections.filter(args => args[0] === 'inspect').length, 2);
  });
});

test('matching or absent containers allow the requested Compose action', async () => {
  await withEnv(async envPath => {
    for (const [action, ids] of [['up', []], ['down', ['own']]]) {
      const docker = dockerFixture(ids, { own: labels() });
      assert.equal(await runDbCommand(action, { envPath, root, composePath, ...docker }), 0);
      assert.equal(docker.actions.length, 1);
      assert.equal(docker.actions[0].args.includes(action), true);
    }
  });
});

test('Compose child receives validated file values despite conflicting parent environment', async () => {
  await withEnv(async envPath => {
    const docker = dockerFixture([]);
    const parentEnv = {
      ...process.env, POSTGRES_USER: 'wrong-user', POSTGRES_PASSWORD: 'wrong-password',
      POSTGRES_DB: 'wrong_db', DB_PORT: '9999'
    };
    assert.equal(await runDbCommand('up', { envPath, root, composePath, parentEnv, ...docker }), 0);
    const childEnv = docker.actions[0].options.env;
    assert.equal(childEnv.POSTGRES_USER, 'handoff');
    assert.equal(childEnv.POSTGRES_PASSWORD, 'file-password');
    assert.equal(childEnv.POSTGRES_DB, 'handoff_dev');
    assert.equal(childEnv.DB_PORT, '5432');
  });
});

test('Docker daemon failure during project inspection has a fixed non-secret diagnostic', async () => {
  await withEnv(async envPath => {
    for (const failingCommand of ['ps', 'inspect']) {
      const docker = dockerFixture(['own'], { own: labels() });
      const runDocker = async args => {
        if (args[0] === failingCommand) {
          throw Object.assign(new Error('daemon failure with file-password'), { code: 1 });
        }
        return docker.runDocker(args);
      };
      await assert.rejects(
        runDbCommand('down', { envPath, root, composePath, ...docker, runDocker }),
        error => error.code === 'DOCKER_UNAVAILABLE' && !error.message.includes('file-password')
      );
      assert.equal(docker.actions.length, 0);
    }
  });
});

test('missing Docker CLI preserves the existing Docker-not-found diagnostic', async () => {
  await withEnv(async envPath => {
    const docker = dockerFixture([]);
    await assert.rejects(
      runDbCommand('up', {
        envPath, root, composePath, ...docker,
        runDocker: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }
      }),
      error => error.code === 'ENOENT'
    );
    assert.equal(docker.actions.length, 0);
  });
});
