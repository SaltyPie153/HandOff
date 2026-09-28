import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PrismaService } from '../src/database/prisma.service.js';
import { ProjectRepository } from '../src/projects/project.repository.js';
import { HandoffRepository } from '../src/handoff/handoff.repository.js';
import { EvidenceService } from '../src/evidence/evidence.service.js';
import { HandoffBackgroundWorker } from '../src/handoff/background-worker.js';
import { AgentKeyStore } from '../src/admin/agent-key.store.js';

const integrationTest = process.env.NODE_ENV === 'test' && process.env.DATABASE_URL ? test : test.skip;

integrationTest('worker publishes only one minimal reply after explicit evidence and agent confirmation', async () => {
  const oldKey = process.env.HANDOFF_EVIDENCE_KEY;
  process.env.HANDOFF_EVIDENCE_KEY = 'b'.repeat(64);
  const prisma = new PrismaService({ databaseUrl: process.env.DATABASE_URL! });
  const projects = new ProjectRepository(prisma);
  const handoffs = new HandoffRepository(prisma);
  const evidence = new EvidenceService(prisma);
  const root = await mkdtemp(join(tmpdir(), 'handoff-worker-key-'));
  const store = new AgentKeyStore({ nodeEnv: 'test', secretDir: join(root, 'protected') });
  await store.save('sk-fake-worker-key');
  let onConfirm = async () => true;
  const agent = { confirmExplicitClaim: async () => onConfirm() };
  const worker = new HandoffBackgroundWorker(prisma, evidence, agent, store);
  const senderId = randomUUID(), recipientId = randomUUID(), teammateId = randomUUID();
  let projectId: string | undefined;
  try {
    await prisma.user.createMany({ data: [senderId, recipientId, teammateId].map(id => ({ id, status: 'APPROVED' })) });
    projectId = (await projects.createProject(senderId, { name: 'Worker room', description: null })).id;
    await prisma.projectMembership.createMany({ data: [recipientId, teammateId].map(userId => ({ projectId: projectId!, userId, role: 'MEMBER' })) });
    const grant = await prisma.mcpGrant.create({ data: { id: randomUUID(), userId: senderId, projectId,
      tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'), expiresAt: new Date(Date.now() + 60_000) } });
    const source = await evidence.registerLocal(recipientId, projectId, 'C:\\contracts\\worker.md');
    const content = 'API_SCOPE: read-only';
    await evidence.syncLocal(source.id, source.syncToken, 'C:\\contracts\\worker.md', content,
      createHash('sha256').update(content).digest('hex'));
    const request = await handoffs.createRequest(senderId, projectId, { recipientId, grantId: grant.id,
      publicTitle: 'Scope', privateBody: 'Please check scope privately', verificationClaim: content, idempotencyKey: randomUUID() });
    await Promise.all([worker.processPendingJobs(), worker.processPendingJobs()]);
    assert.equal(await prisma.handoffReply.count({ where: { requestId: request.id, source: 'CODEX_AUTO' } }), 1);
    const feed = await handoffs.listFeed(teammateId, projectId);
    assert.equal(feed[0]?.replies.length, 1);
    assert.ok(!JSON.stringify(feed).includes('API_SCOPE: read-only'));
    assert.ok(!JSON.stringify(feed).includes('Please check scope privately'));
    assert.equal((await prisma.handoffJob.findUniqueOrThrow({ where: { requestId: request.id } })).status, 'COMPLETED');
    const rotated = await handoffs.createRequest(senderId, projectId, { recipientId, grantId: grant.id,
      publicTitle: 'Rotating key', privateBody: 'private', verificationClaim: content, idempotencyKey: randomUUID() });
    onConfirm = async () => { await store.disable(); return true; };
    await worker.processPendingJobs();
    assert.equal(await prisma.handoffReply.count({ where: { requestId: rotated.id, source: 'CODEX_AUTO' } }), 0);
    assert.equal((await prisma.handoffJob.findUniqueOrThrow({ where: { requestId: rotated.id } })).status, 'REVIEW_REQUIRED');
    const unavailable = await handoffs.createRequest(senderId, projectId, { recipientId, grantId: grant.id,
      publicTitle: 'Missing key', privateBody: 'private', verificationClaim: content, idempotencyKey: randomUUID() });
    await worker.processPendingJobs();
    assert.equal(await prisma.handoffReply.count({ where: { requestId: unavailable.id } }), 0);
    assert.equal((await prisma.handoffJob.findUniqueOrThrow({ where: { requestId: unavailable.id } })).reviewReason, '서버 Codex 확인 불가');
    await store.save('sk-fake-worker-key-v2');
    await worker.wakeUnavailableJobs();
    assert.equal((await prisma.handoffJob.findUniqueOrThrow({ where: { requestId: unavailable.id } })).status, 'PENDING');
    onConfirm = async () => true;
    await worker.processPendingJobs();
    assert.equal(await prisma.handoffReply.count({ where: { requestId: unavailable.id, source: 'CODEX_AUTO' } }), 1);
    const changed = await handoffs.createRequest(senderId, projectId, { recipientId, grantId: grant.id,
      publicTitle: 'Changing evidence', privateBody: 'private', verificationClaim: content, idempotencyKey: randomUUID() });
    onConfirm = async () => {
      await prisma.evidenceSnapshot.update({ where: { sourceId: source.id },
        data: { dirtyAt: new Date(Date.now() + 1_000) } });
      return true;
    };
    await worker.processPendingJobs();
    assert.equal(await prisma.handoffReply.count({ where: { requestId: changed.id } }), 0);
    assert.equal((await prisma.handoffJob.findUniqueOrThrow({ where: { requestId: changed.id } })).status, 'REVIEW_REQUIRED');
    const revoked = await handoffs.createRequest(senderId, projectId, { recipientId, grantId: grant.id,
      publicTitle: 'Later scope', privateBody: 'private', verificationClaim: content, idempotencyKey: randomUUID() });
    await prisma.mcpGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    await worker.processPendingJobs();
    assert.equal(await prisma.handoffReply.count({ where: { requestId: revoked.id } }), 0);
    assert.equal((await prisma.handoffJob.findUniqueOrThrow({ where: { requestId: revoked.id } })).status, 'REVIEW_REQUIRED');
    assert.ok(!JSON.stringify(await handoffs.listMine(senderId, projectId)).includes('현재 요청 권한'));
    assert.ok(JSON.stringify(await handoffs.listMine(recipientId, projectId)).includes('현재 요청 권한'));
  } finally {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [senderId, recipientId, teammateId] } } });
    await prisma.$disconnect();
    if (oldKey === undefined) delete process.env.HANDOFF_EVIDENCE_KEY;
    else process.env.HANDOFF_EVIDENCE_KEY = oldKey;
    assert.ok(root.startsWith(join(tmpdir(), 'handoff-worker-key-')));
    await rm(root, { recursive: true, force: true });
  }
});
