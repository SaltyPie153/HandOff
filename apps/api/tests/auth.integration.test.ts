import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';

const integrationTest = process.env.NODE_ENV === 'test' && process.env.DATABASE_URL ? test : test.skip;

integrationTest('provider key has one owner even when first sign-ins race', async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const subject = randomUUID();
  const first = randomUUID();
  const second = randomUUID();
  try {
    await pool.query('INSERT INTO users(id) VALUES ($1), ($2)', [first, second]);
    const results = await Promise.allSettled([
      pool.query('INSERT INTO provider_identities(id,user_id,provider,provider_subject) VALUES ($1,$2,$3,$4)', [randomUUID(), first, 'GOOGLE', subject]),
      pool.query('INSERT INTO provider_identities(id,user_id,provider,provider_subject) VALUES ($1,$2,$3,$4)', [randomUUID(), second, 'GOOGLE', subject])
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const owners = await pool.query<{ user_id: string }>('SELECT user_id FROM provider_identities WHERE provider = $1 AND provider_subject = $2', ['GOOGLE', subject]);
    assert.equal(owners.rowCount, 1);
  } finally {
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[first, second]]);
    await pool.end();
  }
});

integrationTest('first sign-in converges, email never merges users, and linking cannot steal an identity', async () => {
  const prisma = new PrismaService({ databaseUrl: process.env.DATABASE_URL! });
  const repo = new AuthRepository(prisma);
  const subject = randomUUID();
  const secondSubject = randomUUID();
  const created: string[] = [];
  try {
    const firstPair = await Promise.all([
      repo.signIn('GOOGLE', subject, 'Same name', 'same@example.test'),
      repo.signIn('GOOGLE', subject, 'Same name', 'same@example.test')
    ]);
    assert.equal(firstPair[0], firstPair[1]);
    created.push(firstPair[0]);
    const separate = await repo.signIn('DISCORD', secondSubject, 'Same name', 'same@example.test');
    created.push(separate);
    assert.notEqual(separate, firstPair[0]);
    assert.equal(await repo.link(firstPair[0], 'DISCORD', secondSubject, null, null), 'CONFLICT');
    const ownSubject = randomUUID();
    assert.equal(await repo.link(firstPair[0], 'DISCORD', ownSubject, null, null), 'LINKED');
    assert.equal(await repo.link(firstPair[0], 'DISCORD', ownSubject, null, null), 'ALREADY_LINKED');
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  }
});

integrationTest('explicit bootstrap and approval leave one audit record under retry', async () => {
  const prisma = new PrismaService({ databaseUrl: process.env.DATABASE_URL! });
  const repo = new AuthRepository(prisma);
  const actor = randomUUID();
  const target = randomUUID();
  try {
    await prisma.user.createMany({ data: [{ id: actor }, { id: target }] });
    await repo.bootstrapAdmin(actor);
    const results = await Promise.all([repo.approve(actor, target), repo.approve(actor, target)]);
    assert.equal(results.filter(value => value === 'APPROVED').length, 1);
    assert.equal(results.filter(value => value === 'ALREADY_APPROVED').length, 1);
    assert.equal(await prisma.membershipApproval.count({ where: { targetId: target } }), 1);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target } })).status, 'APPROVED');
    assert.equal(await repo.grantAdmin(actor, target), 'GRANTED');
    assert.equal(await repo.grantAdmin(actor, target), 'ALREADY_GRANTED');
    assert.equal(await prisma.adminGrant.count({ where: { targetId: target } }), 1);
  } finally {
    await prisma.membershipApproval.deleteMany({ where: { targetId: target } });
    await prisma.adminGrant.deleteMany({ where: { targetId: { in: [actor, target] } } });
    await prisma.user.deleteMany({ where: { id: { in: [actor, target] } } });
    await prisma.$disconnect();
  }
});

integrationTest('HTTP API denies pending/admin actions until current DB approval and checks CSRF', async () => {
  const databaseUrl = process.env.DATABASE_URL!;
  const prisma = new PrismaService({ databaseUrl });
  const repo = new AuthRepository(prisma);
  const actor = randomUUID();
  const target = randomUUID();
  await prisma.user.createMany({ data: [{ id: actor }, { id: target }] });
  const actorSession = await repo.issueSession(actor);
  const targetSession = await repo.issueSession(target);
  const module = await Test.createTestingModule({ imports: [AppModule.register({
    nodeEnv: 'test', apiPort: 0, webPort: 0, dbPort: 5433, databaseName: 'handoff_test', databaseHost: '127.0.0.1',
    postgresUser: 'handoff', postgresPassword: 'not-used', databaseUrl
  })] }).compile();
  const app = module.createNestApplication();
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const request = (path: string, token?: string, method = 'GET', csrf?: string) => fetch(base + path, {
    method, headers: { ...(token ? { Cookie: `ho_session=${token}` } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }
  });
  try {
    assert.equal((await request('/api/auth/me')).status, 401);
    assert.equal((await request('/api/admin/pending-users', targetSession.token)).status, 403);
    assert.equal((await request(`/api/admin/users/${target}/approve`, actorSession.token, 'POST', actorSession.csrf)).status, 403);
    await repo.bootstrapAdmin(actor);
    assert.equal((await request('/api/admin/pending-users', actorSession.token)).status, 200);
    assert.equal((await request(`/api/admin/users/${target}/approve`, actorSession.token, 'POST')).status, 403);
    assert.equal((await request(`/api/admin/users/${target}/approve`, actorSession.token, 'POST', actorSession.csrf)).status, 201);
    assert.equal((await request('/api/auth/me', targetSession.token).then(response => response.json()) as { status: string }).status, 'APPROVED');
  } finally {
    await app.close();
    await prisma.membershipApproval.deleteMany({ where: { targetId: target } });
    await prisma.adminGrant.deleteMany({ where: { targetId: actor } });
    await prisma.user.deleteMany({ where: { id: { in: [actor, target] } } });
    await prisma.$disconnect();
  }
});

integrationTest('OAuth attempt is consumed once and session rotation revokes the former token', async () => {
  const prisma = new PrismaService({ databaseUrl: process.env.DATABASE_URL! });
  const repo = new AuthRepository(prisma);
  const userId = randomUUID();
  const stateHash = 'a'.repeat(64);
  try {
    await prisma.user.create({ data: { id: userId } });
    await repo.create({ stateHash, provider: 'GOOGLE', intent: 'LOGIN', browserSessionId: 'browser', memberId: null,
      createdAt: Date.now(), expiresAt: Date.now() + 60_000, nonce: 'nonce', codeVerifier: 'verifier' });
    const consumed = await Promise.all([repo.consume(stateHash), repo.consume(stateHash)]);
    assert.equal(consumed.filter(Boolean).length, 1);
    const first = await repo.issueSession(userId);
    assert.ok(await repo.session(first.token));
    const next = await repo.issueSession(userId, first.token);
    assert.equal(await repo.session(first.token), null);
    assert.ok(await repo.session(next.token));
    await repo.revokeSession(next.token);
    assert.equal(await repo.session(next.token), null);
  } finally {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});

integrationTest('link refuses a session revoked after callback entry but before provider identity write', async () => {
  const prisma = new PrismaService({ databaseUrl: process.env.DATABASE_URL! });
  const repo = new AuthRepository(prisma);
  const userId = randomUUID();
  const subject = randomUUID();
  try {
    await prisma.user.create({ data: { id: userId } });
    const session = await repo.issueSession(userId);
    assert.ok(await repo.session(session.token), 'callback entry has a live session');
    await repo.revokeSession(session.token);
    assert.equal(await repo.link(userId, 'DISCORD', subject, null, null, session.token), 'SESSION_INVALID');
    assert.equal(await prisma.providerIdentity.count({ where: { provider: 'DISCORD', providerSubject: subject } }), 0);
  } finally {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
