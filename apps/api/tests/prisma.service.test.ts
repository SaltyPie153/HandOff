import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaService } from '../src/database/prisma.service.js';

test('onModuleDestroy disconnects the Prisma client exactly once', async () => {
  const service = new PrismaService({
    databaseUrl: 'postgresql://handoff:test-value@127.0.0.1:5433/handoff_test'
  });
  let disconnects = 0;
  service.$disconnect = async () => {
    disconnects += 1;
  };

  await service.onModuleDestroy();

  assert.equal(disconnects, 1);
});
