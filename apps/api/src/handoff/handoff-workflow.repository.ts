import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { lockRequest, requireMember, requireParticipants, requireGrant, text, versionNumber, type ResponseInput, type RevisionInput } from './handoff-workflow.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class HandoffWorkflowRepository {
  constructor(private readonly prisma: PrismaService) {}

  async respond(actorId: string, projectId: string, requestId: string, input: ResponseInput) {
    const version = versionNumber(input.version), key = text(input.idempotencyKey,128);
    if (!['ACKNOWLEDGE','REQUEST_CHANGES'].includes(input.action)) throw new BadRequestException('Invalid action');
    const comment = input.action === 'REQUEST_CHANGES' ? text(input.comment,10000) : null;
    if (input.action === 'ACKNOWLEDGE' && input.comment != null && input.comment !== '') throw new BadRequestException('Confirmation has no comment');
    const payloadHash = hash({version,action:input.action,comment});
    return this.prisma.$transaction(async tx => {
      const request = await lockRequest(tx,requestId,projectId);
      if (actorId !== request.recipientId) throw new NotFoundException();
      await requireParticipants(tx,request);
      const existing = await tx.handoffResponse.findUnique({where:{requestId_actorId_responseKey:{requestId,actorId,responseKey:key}}});
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException('Idempotency key already used');
        return existing;
      }
      if (request.currentVersion !== version) throw new ConflictException('Review the latest version');
      const target = await tx.handoffVersion.findUniqueOrThrow({where:{requestId_version:{requestId,version}}});
      if (target.status !== 'AWAITING_REVIEW') throw new ConflictException('Review the latest version');
      const response = await tx.handoffResponse.create({data:{id:randomUUID(),requestId,versionId:target.id,actorId,action:input.action,comment,responseKey:key,payloadHash}});
      const status = input.action === 'ACKNOWLEDGE' ? 'ACKNOWLEDGED' : 'CHANGES_REQUESTED';
      await tx.handoffVersion.update({where:{id:target.id},data:{status}});
      await tx.handoffJob.updateMany({where:{versionId:target.id},data:{status:'COMPLETED',executionId:null,leaseUntil:null,reviewReason:null,reviewDraft:null}});
      await tx.handoffNotification.create({data:{requestId,versionId:target.id,recipientId:request.senderId,kind:status}});
      return response;
    });
  }

  async resend(senderId: string, projectId: string, requestId: string, grantId: string, input: RevisionInput) {
    const expectedVersion = versionNumber(input.expectedVersion), privateBody = text(input.privateBody,50000), key = text(input.idempotencyKey,128);
    const verificationClaim = input.verificationClaim == null ? null : text(input.verificationClaim,500);
    if (verificationClaim && /[\r\n]/.test(verificationClaim)) throw new BadRequestException('Invalid claim');
    const payloadHash = hash({expectedVersion,privateBody,verificationClaim});
    return this.prisma.$transaction(async tx => {
      const request = await lockRequest(tx,requestId,projectId);
      if (request.senderId !== senderId) throw new NotFoundException();
      await requireParticipants(tx,request);
      await requireGrant(tx,grantId,senderId,projectId);
      const existing = await tx.handoffVersion.findUnique({where:{requestId_sendKey:{requestId,sendKey:key}}});
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException('Idempotency key already used');
        return {id:requestId,version:existing.version,versionId:existing.id,createdAt:existing.createdAt};
      }
      if (request.currentVersion !== expectedVersion) throw new ConflictException('Review the latest version');
      const previous = await tx.handoffVersion.findUniqueOrThrow({where:{requestId_version:{requestId,version:expectedVersion}}});
      if (!['AWAITING_REVIEW','CHANGES_REQUESTED','ACKNOWLEDGED'].includes(previous.status)) throw new ConflictException('Request is closed');
      if (previous.status !== 'ACKNOWLEDGED') await tx.handoffVersion.update({where:{id:previous.id},data:{status:'SUPERSEDED'}});
      await tx.handoffJob.updateMany({where:{versionId:previous.id},data:{status:'COMPLETED',executionId:null,leaseUntil:null,reviewReason:null,reviewDraft:null}});
      const next = await tx.handoffVersion.create({data:{requestId,version:expectedVersion+1,privateBody,verificationClaim,sendKey:key,payloadHash}});
      await tx.handoffRequest.update({where:{id:requestId},data:{currentVersion:next.version,grantId}});
      await tx.handoffJob.create({data:{requestId,versionId:next.id}});
      await tx.handoffNotification.create({data:{requestId,versionId:next.id,recipientId:request.recipientId,kind:'REVISION_RECEIVED'}});
      return {id:requestId,version:next.version,versionId:next.id,createdAt:next.createdAt};
    });
  }

  async summary(viewerId: string, projectId: string) {
    return this.prisma.$transaction(async tx => {
      await requireMember(tx,viewerId,projectId);
      const rows = await tx.handoffRequest.findMany({where:{projectId,OR:[{senderId:viewerId},{recipientId:viewerId}],
        sender:{status:'APPROVED',projectMemberships:{some:{projectId}}},
        recipient:{status:'APPROVED',projectMemberships:{some:{projectId}}}},
        select:{senderId:true,recipientId:true,versions:{orderBy:{version:'desc'},take:1,select:{status:true}}}});
      return {needsReview:rows.filter(r=>r.recipientId===viewerId && r.versions[0]?.status==='AWAITING_REVIEW').length,
        needsChanges:rows.filter(r=>r.senderId===viewerId && r.versions[0]?.status==='CHANGES_REQUESTED').length,
        unreadNotifications:await tx.handoffNotification.count({where:{recipientId:viewerId,request:{projectId},readAt:null}})};
    });
  }
  async notifications(viewerId: string, projectId: string) {
    return this.prisma.$transaction(async tx => {
      await requireMember(tx,viewerId,projectId);
      const notes=await tx.handoffNotification.findMany({where:{recipientId:viewerId,request:{projectId}},orderBy:{createdAt:'desc'},
        select:{id:true,requestId:true,kind:true,createdAt:true,readAt:true,version:{select:{version:true}},request:{select:{publicTitle:true}}}});
      return notes.map(n=>({id:n.id,requestId:n.requestId,kind:n.kind,createdAt:n.createdAt,readAt:n.readAt,version:n.version.version,publicTitle:n.request.publicTitle}));
    });
  }
  async markRead(viewerId: string, projectId: string, notificationId: string) {
    return this.prisma.$transaction(async tx => {
      await requireMember(tx,viewerId,projectId);
      const where={id:notificationId,recipientId:viewerId,request:{projectId}};
      await tx.handoffNotification.updateMany({where:{...where,readAt:null},data:{readAt:new Date()}});
      const note=await tx.handoffNotification.findFirst({where,select:{id:true,readAt:true}});
      if (!note) throw new NotFoundException();
      return note;
    });
  }
}
