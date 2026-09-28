import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaService } from '../src/database/prisma.service.js';
import { ProjectRepository } from '../src/projects/project.repository.js';
import { HandoffRepository } from '../src/handoff/handoff.repository.js';

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
    const reply = await handoffs.publishReply(recipientId, first.id, { body: 'Implementation confirmed', source: 'HUMAN', idempotencyKey: replyKey });
    assert.equal((await handoffs.publishReply(recipientId, first.id, { body: 'Implementation confirmed', source: 'HUMAN', idempotencyKey: replyKey })).id, reply.id);
    assert.equal(await prisma.handoffReply.count({ where: { requestId: first.id } }), 1);
    assert.equal((await handoffs.listFeed(teammateId, projectId))[0]?.replies[0]?.body, 'Implementation confirmed');
  } finally {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [senderId, recipientId, teammateId, outsiderId] } } });
    await prisma.$disconnect();
  }
});
