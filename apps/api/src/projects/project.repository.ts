import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
    const members = await this.prisma.projectMembership.findMany({
      where: { projectId }, orderBy: { joinedAt: 'asc' },
      include: { user: { select: { identities: { select: { displayName: true }, orderBy: { linkedAt: 'asc' }, take: 1 } } } }
    });
    return {
      id: membership.project.id, name: membership.project.name,
      description: membership.project.description, role: membership.role, createdAt: membership.project.createdAt,
      members: members.map(member => ({ userId: member.userId, displayName: member.user.identities[0]?.displayName ?? null,
        role: member.role, joinedAt: member.joinedAt }))
    };
  }
}
