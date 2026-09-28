import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaService } from '../src/database/prisma.service.js';
import { ProjectRepository } from '../src/projects/project.repository.js';
import { EvidenceService } from '../src/evidence/evidence.service.js';

const integrationTest = process.env.NODE_ENV === 'test' && process.env.DATABASE_URL ? test : test.skip;

integrationTest('allowlisted local snapshot is encrypted, expires after 24 hours and revocation removes content', async () => {
  const oldKey = process.env.HANDOFF_EVIDENCE_KEY;
  process.env.HANDOFF_EVIDENCE_KEY = 'a'.repeat(64);
  const prisma = new PrismaService({ databaseUrl: process.env.DATABASE_URL! });
  const projects = new ProjectRepository(prisma);
  const evidence = new EvidenceService(prisma);
  const owner = randomUUID(), teammate = randomUUID();
  let projectId: string | undefined;
  try {
    await prisma.user.createMany({ data: [{ id: owner, status: 'APPROVED' }, { id: teammate, status: 'APPROVED' }] });
    projectId = (await projects.createProject(owner, { name: 'Evidence room', description: null })).id;
    await prisma.projectMembership.create({ data: { projectId, userId: teammate, role: 'MEMBER' } });
    const path = 'C:\\contracts\\scope.md';
    const source = await evidence.registerLocal(owner, projectId, path);
    await assert.rejects(evidence.syncLocal(source.id, 'wrong-token', path, 'Approved scope', createHash('sha256').update('Approved scope').digest('hex')));
    await assert.rejects(evidence.syncLocal(source.id, source.syncToken, 'C:\\contracts\\other.md', 'Approved scope', createHash('sha256').update('Approved scope').digest('hex')));
    const content = 'Approved scope';
    const contentHash = createHash('sha256').update(content).digest('hex');
    await evidence.syncLocal(source.id, source.syncToken, path, content, contentHash);
    const snapshot = await prisma.evidenceSnapshot.findUniqueOrThrow({ where: { sourceId: source.id } });
    assert.ok(!snapshot.encryptedContent.includes(content));
    assert.equal((await evidence.collect(owner, projectId)).records[0]?.content, content);
    await evidence.markDirty(source.id, source.syncToken);
    assert.ok((await evidence.collect(owner, projectId)).unavailable.includes('LOCAL_STALE'));
    await evidence.syncLocal(source.id, source.syncToken, path, content, contentHash);
    assert.equal((await evidence.collect(owner, projectId)).records[0]?.content, content);
    await prisma.evidenceSnapshot.update({ where: { sourceId: source.id }, data: { syncedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    assert.ok((await evidence.collect(owner, projectId)).unavailable.includes('LOCAL_STALE'));
    await evidence.revoke(owner, source.id);
    assert.equal(await prisma.evidenceSnapshot.count({ where: { sourceId: source.id } }), 0);
    await assert.rejects(evidence.syncLocal(source.id, source.syncToken, path, content, contentHash));
    await assert.rejects(evidence.registerLocal(teammate, randomUUID(), path));
  } finally {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, teammate] } } });
    await prisma.$disconnect();
    if (oldKey === undefined) delete process.env.HANDOFF_EVIDENCE_KEY;
    else process.env.HANDOFF_EVIDENCE_KEY = oldKey;
  }
});

integrationTest('registered GitHub file is read at resolved commit SHA, not a moving branch response', async () => {
  const prisma = new PrismaService({ databaseUrl: process.env.DATABASE_URL! });
  const projects = new ProjectRepository(prisma);
  const owner = randomUUID();
  let projectId: string | undefined;
  const sha = 'a'.repeat(40);
  const urls: string[] = [];
  const fakeFetch: typeof fetch = async url => {
    urls.push(String(url));
    return new Response(JSON.stringify(urls.length === 1 ? { sha } : {
      type: 'file', encoding: 'base64', size: 11, content: Buffer.from('Known clause').toString('base64')
    }), { status: 200 });
  };
  const evidence = new EvidenceService(prisma, fakeFetch);
  try {
    await prisma.user.create({ data: { id: owner, status: 'APPROVED' } });
    projectId = (await projects.createProject(owner, { name: 'GitHub evidence', description: null })).id;
    await evidence.registerGithub(owner, projectId, { owner: 'acme', repo: 'contracts', path: 'docs/scope.md', ref: 'main' });
    const collected = await evidence.collect(owner, projectId);
    assert.equal(collected.records[0]?.content, 'Known clause');
    assert.equal(collected.records[0]?.version, sha);
    assert.ok(urls[1]?.endsWith(`?ref=${sha}`));
    assert.equal(collected.unavailable.length, 0);
  } finally {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.user.delete({ where: { id: owner } });
    await prisma.$disconnect();
  }
});
