import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanupSteps,
  discoverIntegrationTests,
  requireFreePorts,
  runCommand
} from '../test-integration.mjs';

test('integration discovery includes newly built health integration tests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-discovery-'));
  try {
    for (const name of ['startup.test.js', 'health.contract.test.js', 'health.integration.test.js']) {
      await writeFile(join(dir, name), '');
    }
    assert.deepEqual(await discoverIntegrationTests(dir), [
      join(dir, 'health.contract.test.js'),
      join(dir, 'health.integration.test.js')
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('command failure keeps child output and secrets out of diagnostics', async () => {
  const secret = 'runner-private-test-value';
  await assert.rejects(
    runCommand(process.execPath, ['-e', `process.stderr.write('${secret}'); process.exit(7)`], {
      label: 'SAMPLE', timeoutMs: 5_000
    }),
    error => error.message === 'SAMPLE_FAILED: EXIT_7' && !error.message.includes(secret)
  );
});

test('cleanup runs in reverse order and reports a failed step', async () => {
  const order = [];
  await assert.rejects(cleanupSteps([
    ['database', async () => { order.push('database'); }],
    ['api', async () => { order.push('api'); throw new Error('secret'); }],
    ['web', async () => { order.push('web'); }]
  ]), /CLEANUP_FAILED: API/);
  assert.deepEqual(order, ['web', 'api', 'database']);
});

test('occupied port is reported without closing its listener', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await assert.rejects(requireFreePorts([['WEB_PORT', address.port]]), /PORT_IN_USE: WEB_PORT/);
    assert.equal(server.listening, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
