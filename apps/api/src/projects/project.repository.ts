import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import type { ProjectView } from './project.types.js';

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
}
