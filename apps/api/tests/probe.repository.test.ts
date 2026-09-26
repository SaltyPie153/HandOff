import test from 'node:test';
import assert from 'node:assert/strict';
import { ProbeRepository } from '../src/database/probe.repository.js';
import type { PrismaService } from '../src/database/prisma.service.js';

const id = '50fc982f-9ff8-46e3-8e84-29297911392b';

test('unique-key retry reads the existing probe without replacing its value or timestamp', async () => {
  const existing = { id, value: 'original', createdAt: new Date('2026-09-21T00:00:00.000Z') };
  const prisma = {
    bootstrapProbe: {
      create: async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }); },
      findUnique: async () => existing,
      update: async () => { throw new Error('unexpected update'); }
    }
  } as unknown as PrismaService;
  const repository = new ProbeRepository(prisma);

  assert.equal(await repository.create(id, 'original'), 'existing');
  assert.equal(await repository.create(id, 'different'), 'conflict');
  assert.equal(existing.value, 'original');
  assert.equal(existing.createdAt.toISOString(), '2026-09-21T00:00:00.000Z');
});

test('failed lookup after a unique-key collision stays a failure', async () => {
  const lookupFailure = new Error('query failed');
  const prisma = {
    bootstrapProbe: {
      create: async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }); },
      findUnique: async () => { throw lookupFailure; },
      update: async () => { throw new Error('unexpected update'); }
    }
  } as unknown as PrismaService;
  const repository = new ProbeRepository(prisma);

  await assert.rejects(repository.create(id, 'value'), error => error === lookupFailure);
});
