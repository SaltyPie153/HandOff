import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { HealthService } from '../src/health/health.service.js';
import type { PrismaService } from '../src/database/prisma.service.js';

type FakeDatabase = {
  prisma: PrismaService;
  calls: { connects: number; reads: number; disconnects: number };
};

function fakeDatabase(options: {
  row?: { id: string } | null;
  connectError?: unknown;
  readError?: unknown;
} = {}): FakeDatabase {
  const calls = { connects: 0, reads: 0, disconnects: 0 };
  const prisma = {
    $connect: async () => {
      calls.connects += 1;
      if (options.connectError !== undefined) throw options.connectError;
    },
    $disconnect: async () => { calls.disconnects += 1; },
    bootstrapProbe: {
      findFirst: async (_args: { select: { id: true } }) => {
        calls.reads += 1;
        if (options.readError !== undefined) throw options.readError;
        return options.row ?? null;
      }
    }
  } as unknown as PrismaService;
  return { prisma, calls };
}

function databaseError(code: string): Error & { code: string } {
  return Object.assign(new Error('SELECT secret FROM bootstrap_probes; password=test-only'), { code });
}

function assertSnapshot(
  value: Awaited<ReturnType<HealthService['check']>>,
  expected: { status: 'ready' | 'degraded'; database: 'ok' | 'unavailable' | 'schema_missing'; code: 'OK' | 'DATABASE_UNAVAILABLE' | 'SCHEMA_NOT_READY' }
): void {
  assert.deepEqual(Object.keys(value).sort(), ['checkedAt', 'code', 'database', 'service', 'status']);
  assert.equal(value.status, expected.status);
  assert.equal(value.service, 'ok');
  assert.equal(value.database, expected.database);
  assert.equal(value.code, expected.code);
  assert.match(value.checkedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Number.isFinite(Date.parse(value.checkedAt)));
  assert.ok(!JSON.stringify(value).includes('secret'));
  assert.ok(!JSON.stringify(value).includes('test-only'));
}

for (const row of [null, { id: 'e18262b9-5e0a-4939-bec2-067e58568e84' }]) {
  test(`a ${row === null ? 'empty' : 'populated'} probe table is ready`, async () => {
    const { prisma, calls } = fakeDatabase({ row });
    const snapshot = await new HealthService(prisma).check();
    assertSnapshot(snapshot, { status: 'ready', database: 'ok', code: 'OK' });
    assert.deepEqual(calls, { connects: 1, reads: 1, disconnects: 0 });
    assert.ok(!JSON.stringify(snapshot).includes('e18262b9'));
  });
}

for (const code of ['P2021', '42P01']) {
  test(`${code} from the table read means schema missing`, async () => {
    const { prisma, calls } = fakeDatabase({ readError: databaseError(code) });
    const snapshot = await new HealthService(prisma).check();
    assertSnapshot(snapshot, { status: 'degraded', database: 'schema_missing', code: 'SCHEMA_NOT_READY' });
    assert.deepEqual(calls, { connects: 1, reads: 1, disconnects: 0 });
    assert.ok(!JSON.stringify(snapshot).includes(code));
  });
}

test('a nested PostgreSQL missing-table code means schema missing', async () => {
  const wrapped = Object.assign(databaseError('P2010'), { meta: { code: '42P01' } });
  const { prisma } = fakeDatabase({ readError: wrapped });
  assertSnapshot(await new HealthService(prisma).check(), {
    status: 'degraded', database: 'schema_missing', code: 'SCHEMA_NOT_READY'
  });
});

for (const code of ['P1001', 'ETIMEDOUT']) {
  test(`${code} from connection is unavailable and skips table read`, async () => {
    const { prisma, calls } = fakeDatabase({ connectError: databaseError(code) });
    const snapshot = await new HealthService(prisma).check();
    assertSnapshot(snapshot, { status: 'degraded', database: 'unavailable', code: 'DATABASE_UNAVAILABLE' });
    assert.deepEqual(calls, { connects: 1, reads: 0, disconnects: 0 });
    assert.ok(!JSON.stringify(snapshot).includes(code));
  });
}

test('query timeout is unavailable', async () => {
  const { prisma } = fakeDatabase({ readError: databaseError('57014') });
  assertSnapshot(await new HealthService(prisma).check(), {
    status: 'degraded', database: 'unavailable', code: 'DATABASE_UNAVAILABLE'
  });
});

test('unknown probe failure is unavailable without diagnostic leakage', async () => {
  const { prisma } = fakeDatabase({ readError: new Error('secret SQL and password=test-only') });
  assertSnapshot(await new HealthService(prisma).check(), {
    status: 'degraded', database: 'unavailable', code: 'DATABASE_UNAVAILABLE'
  });
});

test('cyclic error causes are still normalized as unavailable', async () => {
  const first: { code: string; cause?: unknown } = { code: 'P2010' };
  const second: { code: string; cause?: unknown } = { code: 'UNKNOWN', cause: first };
  first.cause = second;
  const { prisma } = fakeDatabase({ readError: first });
  assertSnapshot(await new HealthService(prisma).check(), {
    status: 'degraded', database: 'unavailable', code: 'DATABASE_UNAVAILABLE'
  });
});

test('repeated checks keep the shared Prisma client connected for module shutdown', async () => {
  const { prisma, calls } = fakeDatabase();
  const service = new HealthService(prisma);
  await service.check();
  await service.check();
  assert.deepEqual(calls, { connects: 2, reads: 2, disconnects: 0 });
});
