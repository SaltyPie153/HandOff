import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaService } from '../src/database/prisma.service.js';
import { ProjectRepository } from '../src/projects/project.repository.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';

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

integrationTest('project HTTP reads current approval and assignment on every request', async () => {
  const databaseUrl = process.env.DATABASE_URL!;
  const prisma = new PrismaService({ databaseUrl });
  const projects = new ProjectRepository(prisma);
  const auth = new AuthRepository(prisma);
  const owner = randomUUID();
  const other = randomUUID();
  const admin = randomUUID();
  const pending = randomUUID();
  const ids = [owner, other, admin, pending];
  let firstId: string | undefined;
  let otherId: string | undefined;
  let app: INestApplication | undefined;
  try {
    await prisma.user.createMany({ data: [
      { id: owner, status: 'APPROVED' }, { id: other, status: 'APPROVED' },
      { id: admin, status: 'APPROVED', isServiceAdmin: true }, { id: pending }
    ] });
    firstId = (await projects.createProject(owner, { name: 'Own room', description: null })).id;
    otherId = (await projects.createProject(other, { name: 'Other room', description: null })).id;
    const ownerSession = await auth.issueSession(owner);
    const adminSession = await auth.issueSession(admin);
    const pendingSession = await auth.issueSession(pending);
    const module = await Test.createTestingModule({ imports: [AppModule.register({
      nodeEnv: 'test', apiPort: 0, webPort: 0, dbPort: 5433, databaseName: 'handoff_test', databaseHost: '127.0.0.1',
      postgresUser: 'handoff', postgresPassword: 'not-used', databaseUrl
    })] }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const request = (path: string, token?: string, method = 'GET', csrf?: string, body?: unknown) => fetch(base + path, {
      method, headers: { ...(token ? { Cookie: `ho_session=${token}` } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    assert.equal((await request('/api/projects')).status, 401);
    assert.equal((await request('/api/projects', pendingSession.token)).status, 403);
    assert.equal((await request('/api/projects', pendingSession.token, 'POST', pendingSession.csrf, { name: 'No' })).status, 403);
    assert.equal((await request(`/api/projects/${firstId}`, pendingSession.token)).status, 403);
    assert.equal((await request('/api/projects', ownerSession.token, 'POST', undefined, { name: 'No CSRF' })).status, 403);
    const createdResponse = await request('/api/projects', ownerSession.token, 'POST', ownerSession.csrf, { name: '  Third room  ' });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { id: string; name: string; role: string };
    assert.equal(created.name, 'Third room');
    assert.equal(created.role, 'MANAGER');
    const mine = await request('/api/projects', ownerSession.token);
    assert.equal(mine.status, 200);
    assert.equal(mine.headers.get('cache-control'), 'no-store');
    const list = await mine.json() as Array<{ id: string }>;
    assert.deepEqual(list.map(project => project.id).sort(), [firstId, created.id].sort());
    const ownRoom = await request(`/api/projects/${firstId}`, ownerSession.token);
    assert.equal(ownRoom.status, 200);
    assert.equal(ownRoom.headers.get('cache-control'), 'no-store');
    assert.equal(((await ownRoom.json()) as { members: unknown[] }).members.length, 1);
    const unknown = await request(`/api/projects/${randomUUID()}`, ownerSession.token);
    const unauthorized = await request(`/api/projects/${otherId}`, ownerSession.token);
    assert.equal(unauthorized.status, 404);
    assert.deepEqual(await unauthorized.json(), await unknown.json());
    assert.equal((await request(`/api/projects/${otherId}`, adminSession.token)).status, 404);
    await prisma.project.delete({ where: { id: created.id } });
  } finally {
    await app?.close();
    await prisma.project.deleteMany({ where: { id: { in: [firstId, otherId].filter((id): id is string => !!id) } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});

integrationTest('project managers and service admins manage only approved members with one event per change', async () => {
  const databaseUrl = process.env.DATABASE_URL!;
  const prisma = new PrismaService({ databaseUrl });
  const projects = new ProjectRepository(prisma);
  const auth = new AuthRepository(prisma);
  const owner = randomUUID(), otherManager = randomUUID(), admin = randomUUID(), member = randomUUID(), pending = randomUUID();
  const ids = [owner, otherManager, admin, member, pending];
  let projectId: string | undefined, otherProjectId: string | undefined;
  let app: INestApplication | undefined;
  try {
    await prisma.user.createMany({ data: [
      { id: owner, status: 'APPROVED' }, { id: otherManager, status: 'APPROVED' },
      { id: admin, status: 'APPROVED', isServiceAdmin: true }, { id: member, status: 'APPROVED' }, { id: pending }
    ] });
    await prisma.providerIdentity.createMany({ data: [
      { id: randomUUID(), userId: member, provider: 'GOOGLE', providerSubject: randomUUID(), displayName: 'Team member' },
      { id: randomUUID(), userId: member, provider: 'DISCORD', providerSubject: randomUUID(), displayName: 'Team member' }
    ] });
    projectId = (await projects.createProject(owner, { name: 'Shared room', description: null })).id;
    otherProjectId = (await projects.createProject(otherManager, { name: 'Other room', description: null })).id;
    const ownerSession = await auth.issueSession(owner), adminSession = await auth.issueSession(admin);
    const otherSession = await auth.issueSession(otherManager);
    const firstMemberSession = await auth.issueSession(member), secondMemberSession = await auth.issueSession(member);
    const module = await Test.createTestingModule({ imports: [AppModule.register({
      nodeEnv: 'test', apiPort: 0, webPort: 0, dbPort: 5433, databaseName: 'handoff_test', databaseHost: '127.0.0.1',
      postgresUser: 'handoff', postgresPassword: 'not-used', databaseUrl
    })] }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const request = (path: string, token?: string, method = 'GET', csrf?: string, body?: unknown) => fetch(base + path, {
      method, headers: { ...(token ? { Cookie: `ho_session=${token}` } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const membersUrl = `/api/projects/${projectId}/members`;
    assert.equal((await request(membersUrl, otherSession.token)).status, 404);
    assert.equal((await request(`/api/projects/${otherProjectId}/members`, ownerSession.token)).status, 404);
    assert.equal((await request(membersUrl, ownerSession.token)).status, 200);
    const candidates = await request(`/api/projects/${projectId}/eligible-users`, ownerSession.token);
    assert.equal(candidates.status, 200);
    assert.ok((await candidates.json() as Array<{ id: string }>).some(candidate => candidate.id === member));
    assert.equal((await request(membersUrl, adminSession.token)).status, 200);
    assert.equal((await request(membersUrl, ownerSession.token, 'POST', undefined, { userId: member })).status, 403);
    assert.equal((await request(membersUrl, ownerSession.token, 'POST', ownerSession.csrf, { userId: pending })).status, 409);
    const adminList = await request('/api/admin/projects', adminSession.token);
    assert.equal(adminList.status, 200);
    const adminProjects = await adminList.json() as Array<Record<string, unknown>>;
    assert.ok(adminProjects.some(project => project.id === projectId && project.memberCount === 1));
    assert.ok(adminProjects.every(project => !('members' in project)));
    assert.equal((await request('/api/admin/projects', ownerSession.token)).status, 403);
    const added = await Promise.all([
      request(membersUrl, ownerSession.token, 'POST', ownerSession.csrf, { userId: member }),
      request(membersUrl, ownerSession.token, 'POST', ownerSession.csrf, { userId: member })
    ]);
    assert.deepEqual(added.map(response => response.status).sort(), [201, 201]);
    assert.equal(await prisma.projectMembership.count({ where: { projectId, userId: member } }), 1);
    assert.equal(await prisma.projectMemberEvent.count({ where: { projectId, targetId: member, action: 'ADD' } }), 1);
    for (const session of [firstMemberSession, secondMemberSession]) {
      const list = await request('/api/projects', session.token).then(response => response.json()) as Array<{ id: string }>;
      assert.deepEqual(list.map(project => project.id), [projectId]);
    }
    assert.equal((await request(membersUrl, firstMemberSession.token)).status, 403);
    assert.equal((await request(membersUrl, otherSession.token, 'POST', otherSession.csrf, { userId: pending })).status, 404);
    assert.equal((await request(`${membersUrl}/${owner}`, adminSession.token, 'DELETE', adminSession.csrf)).status, 409);
    assert.equal((await request(`${membersUrl}/${member}`, ownerSession.token, 'DELETE')).status, 403);
    assert.equal((await request(`${membersUrl}/${member}`, adminSession.token, 'DELETE', adminSession.csrf)).status, 200);
    assert.equal((await request(`${membersUrl}/${member}`, adminSession.token, 'DELETE', adminSession.csrf)).status, 200);
    assert.equal(await prisma.projectMemberEvent.count({ where: { projectId, targetId: member, action: 'REMOVE' } }), 1);
    assert.equal((await request(`/api/projects/${projectId}`, firstMemberSession.token)).status, 404);
    assert.deepEqual(await request('/api/projects', secondMemberSession.token).then(response => response.json()), []);
    assert.equal((await request(membersUrl, adminSession.token, 'POST', adminSession.csrf, { userId: member })).status, 201);
    assert.equal((await request(`${membersUrl}/${member}`, ownerSession.token, 'DELETE', ownerSession.csrf)).status, 200);
    assert.equal(await prisma.projectMemberEvent.count({ where: { projectId, targetId: member, action: 'ADD' } }), 2);
    assert.equal(await prisma.projectMemberEvent.count({ where: { projectId, targetId: member, action: 'REMOVE' } }), 2);
    await prisma.projectMembership.update({ where: { projectId_userId: { projectId, userId: owner } }, data: { role: 'MEMBER' } });
    assert.equal((await request(membersUrl, ownerSession.token, 'POST', ownerSession.csrf, { userId: member })).status, 403);
    await prisma.user.update({ where: { id: admin }, data: { status: 'PENDING' } });
    assert.equal((await request(membersUrl, adminSession.token, 'POST', adminSession.csrf, { userId: member })).status, 403);
  } finally {
    await app?.close();
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId].filter((id): id is string => !!id) } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
