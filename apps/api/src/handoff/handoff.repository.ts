import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import type { HandoffReplySource } from '../generated/prisma/enums.js';
import { lockRequest, requireMember, requireParticipants, requireGrant, text, versionNumber } from './handoff-workflow.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const replySelect = {id:true,actorId:true,body:true,source:true,createdAt:true,version:{select:{version:true}}} as const;

export class HandoffRepository {
  constructor(readonly prisma: PrismaService) {}

  async createRequest(senderId: string, projectId: string, input: {
    recipientId: string; publicTitle: string; privateBody: string; verificationClaim?: string | null;
    idempotencyKey: string; grantId?: string
  }) {
    const publicTitle=text(input.publicTitle,160), privateBody=text(input.privateBody,50000), key=text(input.idempotencyKey,128);
    const verificationClaim=input.verificationClaim==null?null:text(input.verificationClaim,500);
    if (senderId===input.recipientId || (verificationClaim && /[\r\n]/.test(verificationClaim))) throw new BadRequestException('Invalid handoff request');
    const payloadHash=hash({projectId,recipientId:input.recipientId,publicTitle,privateBody,verificationClaim});
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${senderId+':'+key}))::text`;
      await requireParticipants(tx,{senderId,recipientId:input.recipientId,projectId});
      if(input.grantId) await requireGrant(tx,input.grantId,senderId,projectId);
      const existing=await tx.handoffRequest.findUnique({where:{senderId_sendKey:{senderId,sendKey:key}}});
      if(existing){ if(existing.payloadHash!==payloadHash) throw new ConflictException('Idempotency key already used'); return existing; }
      const versionId=randomUUID();
      const request=await tx.handoffRequest.create({data:{id:randomUUID(),projectId,senderId,recipientId:input.recipientId,grantId:input.grantId,publicTitle,sendKey:key,payloadHash,
        versions:{create:{id:versionId,version:1,privateBody,verificationClaim}}}});
      await tx.handoffJob.create({data:{requestId:request.id,versionId}});
      await tx.handoffNotification.create({data:{requestId:request.id,versionId,recipientId:input.recipientId,kind:'REQUEST_RECEIVED'}});
      return request;
    });
  }
  async listFeed(viewerId:string,projectId:string){
    return this.prisma.$transaction(async tx=>{
      await requireMember(tx,viewerId,projectId);
      const rows=await tx.handoffRequest.findMany({where:{projectId},orderBy:{createdAt:'desc'},select:{id:true,projectId:true,publicTitle:true,senderId:true,recipientId:true,createdAt:true,
        replies:{select:replySelect,orderBy:{createdAt:'asc'}}}});
      return rows.map(({senderId,recipientId,...row})=>({...row,canOpen:viewerId===senderId||viewerId===recipientId,replies:row.replies.map(reply=>({...reply,version:reply.version.version}))}));
    });
  }
  async listMine(viewerId:string,projectId:string,direction?:'received'|'sent'){
    return this.prisma.$transaction(async tx=>{
      await requireMember(tx,viewerId,projectId);
      const rows=await tx.handoffRequest.findMany({where:{projectId,...(direction==='received'?{recipientId:viewerId}:direction==='sent'?{senderId:viewerId}:{OR:[{senderId:viewerId},{recipientId:viewerId}]})},
        orderBy:{createdAt:'desc'},select:{id:true,publicTitle:true,senderId:true,recipientId:true,createdAt:true,currentVersion:true,
          versions:{orderBy:{version:'desc'},take:1,select:{status:true,job:{select:{status:true,reviewReason:true}}}}}});
      return rows.map(({versions,...r})=>({...r,status:versions[0].status,job:r.recipientId===viewerId?versions[0].job:versions[0].job&&{status:versions[0].job.status}}));
    });
  }
  async getPrivateRequest(viewerId:string,requestId:string,version?:number){
    return this.prisma.$transaction(async tx=>{
      const request=await tx.handoffRequest.findUnique({where:{id:requestId},include:{versions:{orderBy:{version:'desc'},include:{job:true,responses:{select:{action:true,comment:true,actorId:true,createdAt:true}}}},replies:{select:replySelect,orderBy:{createdAt:'asc'}}}});
      if(!request || ![request.senderId,request.recipientId].includes(viewerId)) throw new NotFoundException();
      await requireMember(tx,viewerId,request.projectId);
      const target=request.versions.find(v=>v.version===(version??request.currentVersion));
      if(!target) throw new NotFoundException();
      const bothMembers=await tx.projectMembership.count({where:{projectId:request.projectId,userId:{in:[request.senderId,request.recipientId]},user:{status:'APPROVED'}}})===2;
      return {id:request.id,projectId:request.projectId,publicTitle:request.publicTitle,senderId:request.senderId,recipientId:request.recipientId,createdAt:request.createdAt,
        currentVersion:request.currentVersion,version:target.version,versionId:target.id,status:target.status,privateBody:target.privateBody,verificationClaim:target.verificationClaim,
        response:target.responses[0]??null,versions:request.versions.map(v=>({version:v.version,status:v.status,createdAt:v.createdAt})),
        canRespond:bothMembers&&viewerId===request.recipientId&&target.version===request.currentVersion&&target.status==='AWAITING_REVIEW',
        replies:request.replies.map(r=>({...r,version:r.version.version})),
        job:viewerId===request.recipientId?target.job&&{status:target.job.status,reviewReason:target.job.reviewReason,reviewDraft:target.job.reviewDraft}:target.job&&{status:target.job.status}};
    });
  }
  async publishReply(actorId:string,requestId:string,input:{body:string;source:HandoffReplySource;idempotencyKey:string;version:number}){
    const body=text(input.body,10000), key=text(input.idempotencyKey,128), version=versionNumber(input.version);
    const payloadHash=hash({body,source:input.source,version});
    return this.prisma.$transaction(async tx=>{
      const request=await lockRequest(tx,requestId);
      if(request.recipientId!==actorId) throw new NotFoundException();
      await requireParticipants(tx,request);
      const existing=await tx.handoffReply.findUnique({where:{requestId_actorId_replyKey:{requestId,actorId,replyKey:key}},include:{version:{select:{version:true}}}});
      if(existing){if(existing.payloadHash!==payloadHash) throw new ConflictException('Idempotency key already used'); return {...existing,version:existing.version.version};}
      if(request.currentVersion!==version) throw new ConflictException('Review the latest version');
      const target=await tx.handoffVersion.findUniqueOrThrow({where:{requestId_version:{requestId,version}}});
      const reply=await tx.handoffReply.create({data:{id:randomUUID(),requestId,versionId:target.id,actorId,body,source:input.source,replyKey:key,payloadHash}});
      if(input.source==='HUMAN') await tx.handoffJob.updateMany({where:{versionId:target.id},data:{status:'COMPLETED',executionId:null,reviewReason:null,reviewDraft:null,leaseUntil:null}});
      return {...reply,version};
    });
  }
}
