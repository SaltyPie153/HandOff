import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthRepository } from '../src/auth/auth.repository.js';

const integrationTest = process.env.NODE_ENV === 'test' && process.env.DATABASE_URL ? test : test.skip;

integrationTest('only an approved service admin can manage the key with CSRF, and responses never return it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'handoff-agent-api-'));
  const dir = join(root, 'protected');
  const oldDir = process.env.HANDOFF_SECRET_DIR;
  process.env.HANDOFF_SECRET_DIR = dir;
  const prisma = new PrismaService({ databaseUrl: process.env.DATABASE_URL! });
  const repo = new AuthRepository(prisma);
  const adminId = randomUUID(), memberId = randomUUID();
  await prisma.user.createMany({ data: [{ id: adminId }, { id: memberId, status: 'APPROVED' }] });
  const adminSession = await repo.issueSession(adminId);
  const memberSession = await repo.issueSession(memberId);
  const module = await Test.createTestingModule({ imports: [AppModule.register({
    nodeEnv: 'test', apiPort: 0, webPort: 0, dbPort: 5433, databaseName: 'handoff_test', databaseHost: '127.0.0.1',
    postgresUser: 'handoff', postgresPassword: 'not-used', databaseUrl: process.env.DATABASE_URL!
  })] }).compile();
  const app = module.createNestApplication();
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as { port: number }).port;
  const key = 'sk-fake-admin-integration-key';
  const request = (token: string | undefined, method = 'GET', csrf?: string, body?: unknown) => fetch(`http://127.0.0.1:${port}/api/admin/agent-key`, {
    method, headers: { ...(token ? { Cookie: `ho_session=${token}` } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  try {
    assert.equal((await request(undefined)).status, 401);
    assert.equal((await request(memberSession.token)).status, 403);
    assert.equal((await request(adminSession.token)).status, 403);
    await prisma.user.update({ where: { id: adminId }, data: { status: 'APPROVED', isServiceAdmin: true } });
    const malformed = await fetch(`http://127.0.0.1:${port}/api/admin/agent-key`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'sk-DUMMY-REVIEW-LEAK'
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get('cache-control'), 'no-store');
    assert.equal((await malformed.text()).includes('sk-DUMMY-REVIEW-LEAK'), false);
    assert.equal((await request(adminSession.token, 'PUT', undefined, { key })).status, 403);
    const saved = await request(adminSession.token, 'PUT', adminSession.csrf, { key });
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get('cache-control'), 'no-store');
    assert.equal((await saved.text()).includes(key), false);
    const status = await request(adminSession.token);
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('cache-control'), 'no-store');
    const statusBody = await status.text();
    assert.equal(statusBody.includes(key), false);
    assert.equal(JSON.parse(statusBody).configured, true);
    assert.equal((await request(memberSession.token, 'DELETE', memberSession.csrf)).status, 403);
    assert.equal((await request(adminSession.token, 'DELETE')).status, 403);
    const disabled = await request(adminSession.token, 'DELETE', adminSession.csrf);
    assert.equal(disabled.status, 200);
    assert.equal(JSON.parse(await disabled.text()).configured, false);
  } finally {
    await app.close();
    await prisma.user.deleteMany({ where: { id: { in: [adminId, memberId] } } });
    await prisma.$disconnect();
    assert.ok(root.startsWith(join(tmpdir(), 'handoff-agent-api-')));
    await rm(root, { recursive: true, force: true });
    if (oldDir === undefined) delete process.env.HANDOFF_SECRET_DIR;
    else process.env.HANDOFF_SECRET_DIR = oldDir;
  }
});
