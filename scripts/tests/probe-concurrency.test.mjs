import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestEnvironment } from '../test-integration.mjs';
import { validateConfig } from '../lib/dev-environment.mjs';

test('concurrent creates for one id leave one unchanged row', { timeout: 120_000 }, async () => {
  const ownedEnvironment = process.env.HANDOFF_TEST_PROJECT ? null : await createTestEnvironment();
  const id = randomUUID();
  let prisma;
  try {
    const env = ownedEnvironment ? ownedEnvironment.env : process.env;
    const config = validateConfig(env);
    assert.equal(config.nodeEnv, 'test');
    assert.equal(config.databaseName, 'handoff_test');
    assert.equal(config.databaseHost, '127.0.0.1');
    const { PrismaService } = await import('../../apps/api/dist/src/database/prisma.service.js');
    const { ProbeRepository } = await import('../../apps/api/dist/src/database/probe.repository.js');
    prisma = new PrismaService({ databaseUrl: config.databaseUrl });
    const repository = new ProbeRepository(prisma);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repository.create(id, 'concurrent'))
    );
    assert.equal(results.filter(result => result === 'created').length, 1);
    assert.equal(results.filter(result => result === 'existing').length, 7);
    const before = await prisma.bootstrapProbe.findUniqueOrThrow({ where: { id } });
    assert.equal(before.value, 'concurrent');

    assert.equal(await repository.create(id, 'concurrent'), 'existing');
    assert.equal(await repository.create(id, 'different'), 'conflict');
    assert.deepEqual(await prisma.bootstrapProbe.findUniqueOrThrow({ where: { id } }), before);
  } finally {
    try {
      if (prisma) await prisma.bootstrapProbe.deleteMany({ where: { id } });
    } finally {
      try {
        await prisma?.$disconnect();
      } finally {
        await ownedEnvironment?.close();
      }
    }
  }
});
