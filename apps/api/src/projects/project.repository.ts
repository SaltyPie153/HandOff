import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import type { MemberView, ProjectView } from './project.types.js';

export class ProjectRepository {
  constructor(readonly prisma: PrismaService) {}

  async createProject(actorId: string, input: { name: string; description: string | null }): Promise<ProjectView> {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const description = input.description === null ? null : typeof input.description === 'string' ? input.description.trim() : undefined;
    if (!name || name.length > 120 || description === undefined || (description !== null && description.length > 500)) {
      throw new BadRequestException('Invalid project name or description');
    }
    return this.prisma.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { status: true } });
      if (actor?.status !== 'APPROVED') throw new ForbiddenException();
      const project = await tx.project.create({ data: { id: randomUUID(), name, description, creatorId: actorId } });
      await tx.projectMembership.create({ data: { projectId: project.id, userId: actorId, role: 'MANAGER' } });
      await tx.projectMemberEvent.create({ data: { id: randomUUID(), projectId: project.id, targetId: actorId, actorId, action: 'ADD' } });
      return { id: project.id, name: project.name, description: project.description, role: 'MANAGER', createdAt: project.createdAt };
    });
  }

  async listMine(actorId: string): Promise<ProjectView[]> {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { status: true } });
    if (actor?.status !== 'APPROVED') throw new ForbiddenException();
    const memberships = await this.prisma.projectMembership.findMany({
      where: { userId: actorId }, include: { project: true }, orderBy: { project: { createdAt: 'desc' } }
    });
    return memberships.map(({ project, role }) => ({
      id: project.id, name: project.name, description: project.description, role, createdAt: project.createdAt
    }));
  }

  async room(actorId: string, projectId: string): Promise<ProjectView & { members: MemberView[] }> {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { status: true } });
    if (actor?.status !== 'APPROVED') throw new ForbiddenException();
    const membership = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId: actorId } }, include: { project: true }
    });
    if (!membership) throw new NotFoundException();
    return {
      id: membership.project.id, name: membership.project.name,
      description: membership.project.description, role: membership.role, createdAt: membership.project.createdAt,
      members: await this.memberViews(projectId)
    };
  }

  private async memberViews(projectId: string): Promise<MemberView[]> {
    const members = await this.prisma.projectMembership.findMany({
      where: { projectId }, orderBy: { joinedAt: 'asc' },
      include: { user: { select: { identities: { select: { displayName: true }, orderBy: { linkedAt: 'asc' }, take: 1 } } } }
    });
    return members.map(member => ({ userId: member.userId, displayName: member.user.identities[0]?.displayName ?? null,
      role: member.role, joinedAt: member.joinedAt }));
  }

  private async requireManager(actorId: string, projectId: string, db: Pick<PrismaService, 'user' | 'project' | 'projectMembership'>): Promise<void> {
    const actor = await db.user.findUnique({ where: { id: actorId }, select: { status: true, isServiceAdmin: true } });
    if (actor?.status !== 'APPROVED') throw new ForbiddenException();
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException();
    if (actor.isServiceAdmin) return;
    const membership = await db.projectMembership.findUnique({ where: { projectId_userId: { projectId, userId: actorId } } });
    if (!membership) throw new NotFoundException();
    if (membership.role !== 'MANAGER') throw new ForbiddenException();
  }

  async members(actorId: string, projectId: string): Promise<MemberView[]> {
    await this.requireManager(actorId, projectId, this.prisma);
    return this.memberViews(projectId);
  }

  async eligibleUsers(actorId: string, projectId: string, query: string): Promise<Array<{ id: string; displayName: string | null }>> {
    await this.requireManager(actorId, projectId, this.prisma);
    const term = query.trim();
    if (term.length > 100) throw new BadRequestException('Query is too long');
    const users = await this.prisma.user.findMany({
      where: { status: 'APPROVED', projectMemberships: { none: { projectId } },
        ...(term ? { identities: { some: { displayName: { contains: term, mode: 'insensitive' } } } } : {}) },
      select: { id: true, identities: { select: { displayName: true }, orderBy: { linkedAt: 'asc' }, take: 1 } },
      orderBy: { createdAt: 'asc' }, take: 30
    });
    return users.map(user => ({ id: user.id, displayName: user.identities[0]?.displayName ?? null }));
  }

  async addMember(actorId: string, projectId: string, targetId: string): Promise<'ADDED' | 'ALREADY_MEMBER'> {
    return this.prisma.$transaction(async tx => {
      await this.requireManager(actorId, projectId, tx);
      const target = await tx.user.findUnique({ where: { id: targetId }, select: { status: true } });
      if (target?.status !== 'APPROVED') throw new ConflictException('Target is not approved');
      const added = await tx.projectMembership.createMany({
        data: [{ projectId, userId: targetId, role: 'MEMBER' }], skipDuplicates: true
      });
      if (!added.count) return 'ALREADY_MEMBER';
      await tx.projectMemberEvent.create({ data: { id: randomUUID(), projectId, targetId, actorId, action: 'ADD' } });
      return 'ADDED';
    });
  }

  async removeMember(actorId: string, projectId: string, targetId: string): Promise<'REMOVED' | 'NOT_MEMBER'> {
    return this.prisma.$transaction(async tx => {
      await this.requireManager(actorId, projectId, tx);
      const existing = await tx.projectMembership.findUnique({ where: { projectId_userId: { projectId, userId: targetId } } });
      if (!existing) return 'NOT_MEMBER';
      if (existing.role === 'MANAGER') throw new ConflictException('Project manager cannot be removed');
      const removed = await tx.projectMembership.deleteMany({ where: { projectId, userId: targetId, role: 'MEMBER' } });
      if (!removed.count) return 'NOT_MEMBER';
      await tx.projectMemberEvent.create({ data: { id: randomUUID(), projectId, targetId, actorId, action: 'REMOVE' } });
      return 'REMOVED';
    });
  }

  async adminProjects(actorId: string): Promise<Array<{ id: string; name: string; description: string | null; memberCount: number }>> {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { status: true, isServiceAdmin: true } });
    if (actor?.status !== 'APPROVED' || !actor.isServiceAdmin) throw new ForbiddenException();
    const projects = await this.prisma.project.findMany({
      select: { id: true, name: true, description: true, _count: { select: { memberships: true } } },
      orderBy: { createdAt: 'desc' }
    });
    return projects.map(project => ({ id: project.id, name: project.name, description: project.description,
      memberCount: project._count.memberships }));
  }
}
