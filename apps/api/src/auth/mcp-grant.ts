import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export class McpGrantService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireMember(userId: string, projectId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (user?.status !== 'APPROVED') throw new ForbiddenException();
    const membership = await this.prisma.projectMembership.findUnique({ where: { projectId_userId: { projectId, userId } } });
    if (!membership) throw new NotFoundException();
  }

  async issue(userId: string, projectId: string) {
    await this.requireMember(userId, projectId);
    const token = randomBytes(32).toString('base64url');
    const grant = await this.prisma.mcpGrant.create({ data: {
      id: randomUUID(), userId, projectId, tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }, select: { id: true, projectId: true, createdAt: true, expiresAt: true } });
    return { ...grant, token };
  }

  async list(userId: string) {
    return this.prisma.mcpGrant.findMany({ where: { userId, revokedAt: null },
      select: { id: true, projectId: true, createdAt: true, expiresAt: true }, orderBy: { createdAt: 'desc' } });
  }

  async revoke(userId: string, grantId: string) {
    await this.prisma.mcpGrant.updateMany({ where: { id: grantId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { revoked: true };
  }

  async requireToken(token: string | undefined, projectId?: string) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException();
    const grant = await this.prisma.mcpGrant.findUnique({ where: { tokenHash: tokenHash(token) },
      select: { userId: true, projectId: true, expiresAt: true, revokedAt: true } });
    if (!grant || grant.revokedAt || grant.expiresAt <= new Date()) throw new UnauthorizedException();
    if (projectId && grant.projectId !== projectId) throw new NotFoundException();
    await this.requireMember(grant.userId, grant.projectId);
    return { userId: grant.userId, projectId: grant.projectId };
  }
}
