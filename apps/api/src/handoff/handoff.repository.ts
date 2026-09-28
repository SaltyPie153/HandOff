import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import type { HandoffReplySource } from '../generated/prisma/enums.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class HandoffRepository {
  constructor(readonly prisma: PrismaService) {}

  private async requireMember(actorId: string, projectId: string, db: Pick<PrismaService, 'user' | 'projectMembership'>): Promise<void> {
    const actor = await db.user.findUnique({ where: { id: actorId }, select: { status: true } });
    if (actor?.status !== 'APPROVED') throw new ForbiddenException();
    const membership = await db.projectMembership.findUnique({ where: { projectId_userId: { projectId, userId: actorId } }, select: { userId: true } });
    if (!membership) throw new NotFoundException();
  }

  async createRequest(senderId: string, projectId: string, input: {
    recipientId: string; publicTitle: string; privateBody: string; verificationClaim?: string | null; idempotencyKey: string
  }) {
    const publicTitle = typeof input.publicTitle === 'string' ? input.publicTitle.trim() : '';
    const privateBody = typeof input.privateBody === 'string' ? input.privateBody.trim() : '';
    const verificationClaim = input.verificationClaim == null ? null :
      typeof input.verificationClaim === 'string' ? input.verificationClaim.trim() : '';
    if (!publicTitle || publicTitle.length > 160 || !privateBody || privateBody.length > 50_000 ||
        (verificationClaim !== null && (!verificationClaim || verificationClaim.length > 500)) ||
        !input.idempotencyKey || input.idempotencyKey.length > 128 || senderId === input.recipientId) {
      throw new BadRequestException('Invalid handoff request');
    }
    const payloadHash = hash({ projectId, recipientId: input.recipientId, publicTitle, privateBody, verificationClaim });
    const perform = () => this.prisma.$transaction(async tx => {
      await this.requireMember(senderId, projectId, tx);
      await this.requireMember(input.recipientId, projectId, tx);
      const existing = await tx.handoffRequest.findUnique({ where: { senderId_sendKey: { senderId, sendKey: input.idempotencyKey } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException('Idempotency key already used');
        return existing;
      }
      return tx.handoffRequest.create({ data: {
        id: randomUUID(), projectId, senderId, recipientId: input.recipientId, publicTitle,
        sendKey: input.idempotencyKey, payloadHash,
        versions: { create: { id: randomUUID(), version: 1, privateBody, verificationClaim } },
        job: { create: { updatedAt: new Date() } }
      } });
    });
    try { return await perform(); }
    catch (error) {
      // A concurrent request may have committed the same key after this transaction read it.
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') throw error;
      await this.requireMember(senderId, projectId, this.prisma);
      await this.requireMember(input.recipientId, projectId, this.prisma);
      const existing = await this.prisma.handoffRequest.findUnique({ where: { senderId_sendKey: { senderId, sendKey: input.idempotencyKey } } });
      if (!existing || existing.payloadHash !== payloadHash) throw new ConflictException('Idempotency key already used');
      return existing;
    }
  }

  async listFeed(viewerId: string, projectId: string) {
    await this.requireMember(viewerId, projectId, this.prisma);
    return this.prisma.handoffRequest.findMany({
      where: { projectId },
      select: { id: true, projectId: true, publicTitle: true, senderId: true, recipientId: true, createdAt: true,
        replies: { select: { id: true, actorId: true, body: true, source: true, createdAt: true }, orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' }
    });
  }

  async listMine(viewerId: string, projectId: string) {
    await this.requireMember(viewerId, projectId, this.prisma);
    return this.prisma.handoffRequest.findMany({
      where: { projectId, OR: [{ senderId: viewerId }, { recipientId: viewerId }] },
      select: { id: true, publicTitle: true, senderId: true, recipientId: true, createdAt: true,
        job: { select: { status: true, reviewReason: true } } }, orderBy: { createdAt: 'desc' }
    });
  }

  async getPrivateRequest(viewerId: string, requestId: string) {
    const request = await this.prisma.handoffRequest.findUnique({ where: { id: requestId },
      select: { id: true, projectId: true, senderId: true, recipientId: true, publicTitle: true, createdAt: true,
        versions: { select: { id: true, version: true, privateBody: true, verificationClaim: true, createdAt: true }, orderBy: { version: 'desc' }, take: 1 },
        job: { select: { status: true, reviewReason: true, reviewDraft: true } },
        replies: { select: { id: true, actorId: true, body: true, source: true, createdAt: true }, orderBy: { createdAt: 'asc' } } } });
    if (!request) throw new NotFoundException();
    await this.requireMember(viewerId, request.projectId, this.prisma);
    if (viewerId !== request.senderId && viewerId !== request.recipientId) throw new NotFoundException();
    return {
      id: request.id, projectId: request.projectId, publicTitle: request.publicTitle,
      senderId: request.senderId, recipientId: request.recipientId, createdAt: request.createdAt,
      version: request.versions[0]?.version ?? 0, privateBody: request.versions[0]?.privateBody ?? '',
      verificationClaim: request.versions[0]?.verificationClaim ?? null, replies: request.replies,
      job: viewerId === request.recipientId ? request.job : request.job && { status: request.job.status }
    };
  }

  async publishReply(actorId: string, requestId: string, input: { body: string; source: HandoffReplySource; idempotencyKey: string }) {
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (!body || body.length > 10_000 || !input.idempotencyKey || input.idempotencyKey.length > 128) {
      throw new BadRequestException('Invalid handoff reply');
    }
    const payloadHash = hash({ body, source: input.source });
    const perform = () => this.prisma.$transaction(async tx => {
      const request = await tx.handoffRequest.findUnique({ where: { id: requestId }, select: { projectId: true, recipientId: true } });
      if (!request) throw new NotFoundException();
      await this.requireMember(actorId, request.projectId, tx);
      if (request.recipientId !== actorId) throw new NotFoundException();
      const existing = await tx.handoffReply.findUnique({ where: { requestId_actorId_replyKey: { requestId, actorId, replyKey: input.idempotencyKey } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException('Idempotency key already used');
        return existing;
      }
      return tx.handoffReply.create({ data: { id: randomUUID(), requestId, actorId, body,
        source: input.source, replyKey: input.idempotencyKey, payloadHash } });
    });
    try { return await perform(); }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') throw error;
      const existing = await this.prisma.handoffReply.findUnique({ where: { requestId_actorId_replyKey: { requestId, actorId, replyKey: input.idempotencyKey } } });
      if (!existing || existing.payloadHash !== payloadHash) throw new ConflictException('Idempotency key already used');
      const request = await this.prisma.handoffRequest.findUnique({ where: { id: requestId }, select: { projectId: true, recipientId: true } });
      if (!request || request.recipientId !== actorId) throw new NotFoundException();
      await this.requireMember(actorId, request.projectId, this.prisma);
      return existing;
    }
  }
}
