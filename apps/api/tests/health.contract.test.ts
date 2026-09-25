import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { AppModule, type ApiConfig } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

type DatabaseState = 'populated' | 'empty' | 'unavailable' | 'schema_missing';

const config: ApiConfig = {
  nodeEnv: 'test',
  apiPort: 0,
  webPort: 5174,
  dbPort: 5433,
  databaseName: 'handoff_test',
  databaseHost: '127.0.0.1',
  postgresUser: 'handoff',
  postgresPassword: 'test-only',
  databaseUrl: 'postgresql://handoff:test-only@127.0.0.1:5433/handoff_test'
};

const privateRow = {
  id: 'e18262b9-5e0a-4939-bec2-067e58568e84',
  value: 'private-probe-value',
  createdAt: new Date('2026-09-21T07:00:00.000Z')
};
const privateDiagnostic = 'test-only-password';
const privateSql = 'SELECT value FROM bootstrap_probes';
const privateUrl = `postgresql://handoff:${privateDiagnostic}@127.0.0.1:5433/handoff_test`;

function databaseError(code: 'P1001' | 'P2021'): Error & { code: string } {
  return Object.assign(new Error(`${privateSql}; ${privateUrl}; ${privateDiagnostic}`), { code });
}

function databaseFixture(state: DatabaseState) {
  const read = async () => {
    if (state === 'unavailable') throw databaseError('P1001');
    if (state === 'schema_missing') throw databaseError('P2021');
    return state === 'empty' ? [] : [privateRow];
  };
  return {
    $connect: async () => {
      if (state === 'unavailable') throw databaseError('P1001');
    },
    $disconnect: async () => undefined,
    bootstrapProbe: {
      findFirst: async () => (await read())[0] ?? null,
      findMany: read,
      count: async () => (await read()).length
    },
    $queryRaw: read,
    $queryRawUnsafe: read
  };
}

async function requestReady(state: DatabaseState): Promise<{
  response: Response;
}> {
  const module = await Test.createTestingModule({ imports: [AppModule.register(config)] })
    .overrideProvider(PrismaService)
    .useValue(databaseFixture(state))
    .compile();
  const app = module.createNestApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health/ready`);
    return { response };
  } finally {
    await app.close();
  }
}

function assertReadyResponse(
  response: Response,
  body: unknown,
  expected: { http: number; status: 'ready' | 'degraded'; database: 'ok' | 'unavailable' | 'schema_missing'; code: 'OK' | 'DATABASE_UNAVAILABLE' | 'SCHEMA_NOT_READY' }
): void {
  assert.equal(response.status, expected.http);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(body !== null && typeof body === 'object' && !Array.isArray(body), 'response must be a JSON object');
  const payload = body as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), ['checkedAt', 'code', 'database', 'service', 'status']);
  assert.equal(payload.status, expected.status);
  assert.equal(payload.service, 'ok');
  assert.equal(payload.database, expected.database);
  assert.equal(payload.code, expected.code);
  assert.match(String(payload.checkedAt), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
  const checkedAt = Date.parse(payload.checkedAt as string);
  assert.ok(Number.isFinite(checkedAt), 'checkedAt must be a parseable UTC ISO-8601 instant');
  assert.equal(new Date(checkedAt).toISOString().slice(0, 19), (payload.checkedAt as string).slice(0, 19), 'checkedAt must have valid UTC date and time fields');
  const serialized = JSON.stringify(payload) + '\n' +
    [...response.headers].map(([name, value]) => name + ': ' + value).join('\n');
  for (const sensitive of [privateRow.id, privateRow.value, privateSql, privateUrl, privateDiagnostic, 'P1001', 'P2021']) {
    assert.ok(!serialized.includes(sensitive), 'health response must not disclose probe data or raw diagnostics');
  }
}

for (const scenario of [
  { state: 'populated', http: 200, status: 'ready', database: 'ok', code: 'OK' },
  { state: 'empty', http: 200, status: 'ready', database: 'ok', code: 'OK' },
  { state: 'unavailable', http: 503, status: 'degraded', database: 'unavailable', code: 'DATABASE_UNAVAILABLE' },
  { state: 'schema_missing', http: 503, status: 'degraded', database: 'schema_missing', code: 'SCHEMA_NOT_READY' }
] as const) {
  test(`GET /api/health/ready reports ${scenario.state} database state`, async () => {
    const { response } = await requestReady(scenario.state);
    const body: unknown = await response.json();
    assertReadyResponse(response, body, scenario);
  });
}
