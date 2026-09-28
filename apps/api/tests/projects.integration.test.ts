import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaService } from '../src/database/prisma.service.js';
import { ProjectRepository } from '../src/projects/project.repository.js';

const integrationTest = process.env.NODE_ENV === 'test' && process.env.DATABASE_URL ? test : test.skip;

integrationTest('approved creator atomically receives a project, manager membership and one ADD event', async () => {
  const prisma = new PrismaService({ databaseUrl: process.env.DATABASE_URL! });
  const repository = new ProjectRepository(prisma);
  const approvedId = randomUUID();
  const pendingId = randomUUID();
  let projectId: string | undefined;
  try {
    await prisma.user.createMany({ data: [{ id: approvedId, status: 'APPROVED' }, { id: pendingId }] });
    const created = await repository.createProject(approvedId, { name: '  Release room  ', description: 'Team work' });
    projectId = created.id;
    assert.equal(created.name, 'Release room');
    assert.equal(created.role, 'MANAGER');
    assert.equal(await prisma.projectMembership.count({ where: { projectId } }), 1);
    assert.equal(await prisma.projectMemberEvent.count({ where: { projectId, action: 'ADD', targetId: approvedId, actorId: approvedId } }), 1);
    for (const [actorId, name] of [[pendingId, 'Pending'], [approvedId, '  '], [approvedId, 'x'.repeat(121)]] as const) {
      await assert.rejects(repository.createProject(actorId, { name, description: null }));
    }
    assert.equal(await prisma.project.count({ where: { creatorId: { in: [approvedId, pendingId] } } }), 1);
    assert.equal(await prisma.projectMembership.count({ where: { userId: { in: [approvedId, pendingId] } } }), 1);
    assert.equal(await prisma.projectMemberEvent.count({ where: { actorId: { in: [approvedId, pendingId] } } }), 1);
  } finally {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [approvedId, pendingId] } } });
    await prisma.$disconnect();
  }
});
