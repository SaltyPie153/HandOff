import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaService } from '../src/database/prisma.service.js';
import { ProjectRepository } from '../src/projects/project.repository.js';
import { HandoffRepository } from '../src/handoff/handoff.repository.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';

const integrationTest = process.env.NODE_ENV === 'test' && process.env.DATABASE_URL ? test : test.skip;

integrationTest('private request stays between participants while title and published reply reach members', async () => {
  const prisma = new PrismaService({ databaseUrl: process.env.DATABASE_URL! });
  const projects = new ProjectRepository(prisma);
  const handoffs = new HandoffRepository(prisma);
  const [senderId, recipientId, teammateId, outsiderId] = Array.from({ length: 4 }, () => randomUUID());
  let projectId: string | undefined;
  try {
    await prisma.user.createMany({ data: [senderId, recipientId, teammateId, outsiderId].map(id => ({ id, status: 'APPROVED' })) });
    projectId = (await projects.createProject(senderId, { name: 'Contract room', description: null })).id;
    await prisma.projectMembership.createMany({ data: [recipientId, teammateId].map(userId => ({ projectId: projectId!, userId, role: 'MEMBER' })) });
    const payload = { recipientId, publicTitle: 'API delivery', privateBody: 'private contract terms', idempotencyKey: randomUUID() };
    const first = await handoffs.createRequest(senderId, projectId, payload);
    const retry = await handoffs.createRequest(senderId, projectId, payload);
    assert.equal(retry.id, first.id);
    assert.equal(await prisma.handoffRequest.count({ where: { projectId } }), 1);
    assert.equal(await prisma.handoffVersion.count({ where: { requestId: first.id } }), 1);
    await assert.rejects(handoffs.createRequest(senderId, projectId, { ...payload, privateBody: 'different' }));
    assert.deepEqual((await handoffs.listFeed(teammateId, projectId)).map(item => item.publicTitle), ['API delivery']);
    assert.ok(!(JSON.stringify(await handoffs.listFeed(teammateId, projectId))).includes('private contract terms'));
    assert.equal((await handoffs.listFeed(outsiderId, projectId).catch(() => [] as never[])).length, 0);
    assert.equal((await handoffs.getPrivateRequest(recipientId, first.id)).privateBody, 'private contract terms');
    await assert.rejects(handoffs.getPrivateRequest(teammateId, first.id));
    await assert.rejects(handoffs.getPrivateRequest(outsiderId, first.id));
    const replyKey = randomUUID();
    const reply = await handoffs.publishReply(recipientId, first.id, { body: 'Implementation confirmed', source: 'HUMAN', version: 1, idempotencyKey: replyKey });
    assert.equal((await handoffs.publishReply(recipientId, first.id, { body: 'Implementation confirmed', source: 'HUMAN', version: 1, idempotencyKey: replyKey })).id, reply.id);
    assert.equal(await prisma.handoffReply.count({ where: { requestId: first.id } }), 1);
    assert.equal((await prisma.handoffJob.findFirstOrThrow({ where: { requestId: first.id } })).status, 'COMPLETED');
    assert.equal((await handoffs.listFeed(teammateId, projectId))[0]?.replies[0]?.body, 'Implementation confirmed');
  } finally {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [senderId, recipientId, teammateId, outsiderId] } } });
    await prisma.$disconnect();
  }
});

integrationTest('MCP grant is scoped, revocable and cannot reveal the private request to a teammate', async () => {
  const databaseUrl = process.env.DATABASE_URL!;
  const prisma = new PrismaService({ databaseUrl });
  const projects = new ProjectRepository(prisma);
  const auth = new AuthRepository(prisma);
  const [senderId, recipientId, teammateId, outsiderId] = Array.from({ length: 4 }, () => randomUUID());
  let projectId: string | undefined;
  let app: INestApplication | undefined;
  try {
    await prisma.user.createMany({ data: [senderId, recipientId, teammateId, outsiderId].map(id => ({ id, status: 'APPROVED' })) });
    projectId = (await projects.createProject(senderId, { name: 'MCP room', description: null })).id;
    await prisma.projectMembership.createMany({ data: [recipientId, teammateId].map(userId => ({ projectId: projectId!, userId, role: 'MEMBER' })) });
    const senderSession = await auth.issueSession(senderId);
    const recipientSession = await auth.issueSession(recipientId);
    const teammateSession = await auth.issueSession(teammateId);
    const outsiderSession = await auth.issueSession(outsiderId);
    const module = await Test.createTestingModule({ imports: [AppModule.register({
      nodeEnv: 'test', apiPort: 0, webPort: 0, dbPort: 5433, databaseName: 'handoff_test', databaseHost: '127.0.0.1',
      postgresUser: 'handoff', postgresPassword: 'not-used', databaseUrl
    })] }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const request = (path: string, options: { method?: string; token?: string; csrf?: string; bearer?: string; body?: unknown } = {}) => fetch(base + path, {
      method: options.method ?? 'GET',
      headers: { ...(options.token ? { Cookie: `ho_session=${options.token}` } : {}),
        ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
        ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
    const grantBody = { projectId };
    assert.equal((await request('/api/mcp/grants', { method: 'POST', token: senderSession.token, body: grantBody })).status, 403);
    const grantResponse = await request('/api/mcp/grants', { method: 'POST', token: senderSession.token, csrf: senderSession.csrf, body: grantBody });
    assert.equal(grantResponse.status, 201, grantResponse.status === 201 ? undefined : await grantResponse.text());
    const grant = await grantResponse.json() as { id: string; token: string };
    assert.ok(grant.token.length >= 40);
    assert.equal(await prisma.mcpGrant.count({ where: { id: grant.id, tokenHash: grant.token } }), 0);
    const body = { projectId, recipientId, publicTitle: 'Public checkpoint', privateBody: 'Do not show C', idempotencyKey: randomUUID() };
    assert.equal((await request('/api/mcp/requests', { method: 'POST', body })).status, 401);
    const sentResponse = await request('/api/mcp/requests', { method: 'POST', bearer: grant.token, body });
    assert.equal(sentResponse.status, 201);
    const sent = await sentResponse.json() as { id: string };
    assert.equal((await request('/api/mcp/requests', { method: 'POST', bearer: grant.token, body })).status, 201);
    assert.equal((await prisma.handoffRequest.count({ where: { projectId } })), 1);
    const feedResponse = await request(`/api/projects/${projectId}/feed`, { token: teammateSession.token });
    assert.equal(feedResponse.status, 200);
    const feedText = await feedResponse.text();
    assert.ok(feedText.includes('Public checkpoint'));
    assert.ok(!feedText.includes('Do not show C'));
    assert.equal((await request(`/api/projects/${projectId}/requests/${sent.id}`, { token: teammateSession.token })).status, 404);
    assert.equal((await request(`/api/projects/${projectId}/requests/${sent.id}`, { token: outsiderSession.token })).status, 404);
    assert.equal((await request(`/api/projects/${projectId}/requests/${sent.id}`, { token: recipientSession.token })).status, 200);
    assert.equal((await request(`/api/projects/${projectId}/requests/${sent.id}/replies`, {
      method: 'POST', token: recipientSession.token, body: { body: 'Confirmed', version: 1, idempotencyKey: randomUUID() }
    })).status, 403);
    assert.equal((await request(`/api/projects/${projectId}/requests/${sent.id}/replies`, {
      method: 'POST', token: recipientSession.token, csrf: recipientSession.csrf, body: { body: 'Confirmed', version: 1, idempotencyKey: randomUUID() }
    })).status, 201);
    const publicFeed = await request(`/api/projects/${projectId}/feed`, { token: teammateSession.token }).then(response => response.text());
    assert.ok(publicFeed.includes('Confirmed'));
    assert.ok(!publicFeed.includes('Do not show C'));
    assert.equal((await request(`/api/mcp/grants/${grant.id}`, { method: 'DELETE', token: senderSession.token, csrf: senderSession.csrf })).status, 200);
    assert.equal((await request('/api/mcp/requests', { method: 'POST', bearer: grant.token, body: { ...body, idempotencyKey: randomUUID() } })).status, 401);
  } finally {
    await app?.close();
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [senderId, recipientId, teammateId, outsiderId] } } });
    await prisma.$disconnect();
  }
});
