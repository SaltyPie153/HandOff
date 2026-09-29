import {NotFoundException} from '@nestjs/common';
import {PrismaService} from '../database/prisma.service.js';
import type {Prisma} from '../generated/prisma/client.js';
import {requireMember,requireGrant,versionNumber} from '../handoff/handoff-workflow.js';
import {requiredAvailable} from './contract.repository.js';

const iso=(date:Date|null)=>date?.toISOString()??null;
const publicSelect={id:true,publicTitle:true,status:true,confirmedAt:true,retiredAt:true} as const;
export class ContractQueryRepository{
 constructor(readonly prisma:PrismaService){}
 private async access(tx:Prisma.TransactionClient,userId:string,projectId:string,grantId?:string){
  await requireMember(tx,userId,projectId);if(grantId)await requireGrant(tx,grantId,userId,projectId);
 }
 async listPublic(viewerId:string,projectId:string,activeOnly=false,grantId?:string){
  return this.prisma.$transaction(async tx=>{
   await this.access(tx,viewerId,projectId,grantId);
   const rows=await tx.developmentContract.findMany({where:{projectId,...(activeOnly?{status:'ACTIVE' as const}:{})},orderBy:{createdAt:'desc'},select:{...publicSelect,proposal:{select:{versions:{where:{participants:{some:{userId:viewerId}}},select:{id:true},take:1}}}}});
   return rows.map(r=>({id:r.id,publicTitle:r.publicTitle,status:r.status,confirmedAt:iso(r.confirmedAt),retiredAt:iso(r.retiredAt),canOpenProposal:r.proposal.some(p=>p.versions.length>0)}));
  });
 }
 async getPublic(viewerId:string,projectId:string,contractId:string,grantId?:string){
  return this.prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM development_contracts WHERE id=${contractId}::uuid AND project_id=${projectId}::uuid FOR SHARE`;
   await this.access(tx,viewerId,projectId,grantId);
   const r=await tx.developmentContract.findFirst({where:{id:contractId,projectId,status:{in:['ACTIVE','RETIRED']}},include:{currentVersion:true,versions:{where:{status:'CONFIRMED'},orderBy:{confirmedAt:'asc'},include:{proposal:{select:{kind:true}}}},proposal:{select:{id:true,lifecycle:true,currentVersion:true,versions:{where:{participants:{some:{userId:viewerId}}},orderBy:{version:'desc'},select:{id:true,version:true},take:1}}}}});
   if(!r)throw new NotFoundException();
   await tx.contractReadAudit.createMany({data:r.versions.map(v=>({userId:viewerId,grantId,versionId:v.id}))});
   const history=r.versions.filter(v=>v.proposal.kind!=='RETIRE').map(v=>({proposalId:v.proposalId,versionId:v.id,version:v.version,body:v.proposedBody,confirmedAt:v.confirmedAt!.toISOString()}));
   const retirement=r.versions.find(v=>v.id===r.retirementVersionId);
   const open=r.proposal.find(p=>p.lifecycle==='OPEN');
   return {id:r.id,publicTitle:r.publicTitle,status:r.status,confirmedAt:iso(r.confirmedAt),retiredAt:iso(r.retiredAt),previousContractId:r.previousContractId,hasOpenProposal:!!open,openProposalId:open?.versions.some(v=>v.version===open.currentVersion)?open.id:null,canOpenProposal:r.proposal.some(p=>p.versions.length>0),version:r.status==='ACTIVE'?r.currentVersion!.version:null,body:r.status==='ACTIVE'?r.currentVersion!.proposedBody:null,history,lastConfirmed:history.find(v=>v.versionId===r.lastConfirmedVersionId)??null,retirement:retirement?{versionId:retirement.id,version:retirement.version,reason:retirement.proposedBody,confirmedAt:retirement.confirmedAt!.toISOString()}:null};
  });
 }
 async listMine(viewerId:string,projectId:string){
  return this.prisma.$transaction(async tx=>{
   await this.access(tx,viewerId,projectId);
   const rows=await tx.contractProposal.findMany({where:{contract:{projectId},versions:{some:{participants:{some:{userId:viewerId}}}}},orderBy:{createdAt:'desc'},select:{id:true,contractId:true,kind:true,lifecycle:true,currentVersion:true,contract:{select:{publicTitle:true}},versions:{where:{participants:{some:{userId:viewerId}}},orderBy:{version:'desc'},take:1,select:{version:true,status:true,createdAt:true}}}});
   return rows.map(r=>({proposalId:r.id,contractId:r.contractId,kind:r.kind,lifecycle:r.lifecycle,publicTitle:r.contract.publicTitle,currentVersion:r.currentVersion,version:r.versions[0].version,status:r.versions[0].status,createdAt:r.versions[0].createdAt.toISOString()}));
  });
 }
 async getProposal(viewerId:string,projectId:string,proposalId:string,version?:number,grantId?:string){
  if(version!==undefined)versionNumber(version);
  return this.prisma.$transaction(async tx=>{
   await this.access(tx,viewerId,projectId,grantId);
   const r=await tx.contractProposal.findFirst({where:{id:proposalId,contract:{projectId}},include:{contract:true,versions:{where:{participants:{some:{userId:viewerId}}},orderBy:{version:'desc'},include:{participants:{include:{user:{select:{identities:{select:{displayName:true},orderBy:{linkedAt:'asc'},take:1}}}}},responses:{orderBy:{createdAt:'asc'}}}}}});
   const target=r?.versions.find(v=>version===undefined||v.version===version);
   if(!r||!target)throw new NotFoundException();
   const blocked=!await requiredAvailable(tx,projectId,target.participants);
   const open=r.lifecycle==='OPEN',latest=target.version===r.currentVersion;
   await tx.contractReadAudit.create({data:{userId:viewerId,grantId,versionId:target.id}});
   return {contractId:r.contractId,proposalId:r.id,kind:r.kind,lifecycle:r.lifecycle,baselineVersionId:r.baselineVersionId,previousProposalId:r.previousProposalId,withdrawal:latest&&r.withdrawnAt?{actorId:r.withdrawnById,reason:r.withdrawalReason,withdrawnAt:r.withdrawnAt.toISOString()}:null,publicTitle:r.contract.publicTitle,senderId:r.senderId,recipientId:r.recipientId,currentVersion:r.currentVersion,
    versionId:target.id,version:target.version,proposedBody:target.proposedBody,status:target.status,blocked,
    canRespond:open&&!blocked&&latest&&target.status==='IN_REVIEW'&&target.participants.some(p=>p.userId===viewerId&&p.role!=='REFERENCE_PM')&&!target.responses.some(p=>p.actorId===viewerId),
    canRevise:open&&!blocked&&viewerId===r.senderId&&latest,
    canWithdraw:open&&!blocked&&viewerId===r.senderId&&latest,
    participants:target.participants.map(p=>({userId:p.userId,role:p.role,displayName:p.user.identities[0]?.displayName??p.userId})),
    versions:r.versions.map(v=>({version:v.version,status:v.status,createdAt:v.createdAt.toISOString()})),
    responses:target.responses.map(p=>({actorId:p.actorId,action:p.action,comment:p.comment,createdAt:p.createdAt.toISOString()}))};
  });
 }
 async summary(viewerId:string,projectId:string){
  return this.prisma.$transaction(async tx=>{
   await this.access(tx,viewerId,projectId);
   const rows=await tx.contractProposal.findMany({where:{contract:{projectId},lifecycle:'OPEN'},include:{versions:{orderBy:{version:'desc'},take:1,include:{participants:true,responses:true}}}});
   let needsReview=0,needsChanges=0;
   for(const r of rows){const v=r.versions[0];if(!v||!v.participants.some(p=>p.userId===viewerId&&p.role!=='REFERENCE_PM')||!await requiredAvailable(tx,projectId,v.participants))continue;
    if(v.status==='IN_REVIEW'&&!v.responses.some(p=>p.actorId===viewerId))needsReview++;
    if(v.status==='CHANGES_REQUESTED'&&r.senderId===viewerId)needsChanges++;
   }
   const unreadNotifications=await tx.contractNotification.count({where:{recipientId:viewerId,readAt:null,version:{proposal:{contract:{projectId}},participants:{some:{userId:viewerId}}}}});
   return {needsReview,needsChanges,unreadNotifications};
  });
 }
 async notifications(viewerId:string,projectId:string){
  return this.prisma.$transaction(async tx=>{
   await this.access(tx,viewerId,projectId);
   const rows=await tx.contractNotification.findMany({where:{recipientId:viewerId,version:{proposal:{contract:{projectId}},participants:{some:{userId:viewerId}}}},orderBy:{createdAt:'desc'},include:{version:{select:{proposalId:true,version:true,proposal:{select:{kind:true}},contract:{select:{publicTitle:true}}}}}});
   return rows.map(n=>({id:n.id,proposalId:n.version.proposalId,proposalKind:n.version.proposal.kind,version:n.version.version,publicTitle:n.version.contract.publicTitle,kind:n.kind,createdAt:n.createdAt.toISOString(),readAt:iso(n.readAt)}));
  });
 }
 async markRead(viewerId:string,projectId:string,notificationId:string){
  return this.prisma.$transaction(async tx=>{
   await this.access(tx,viewerId,projectId);
   const where={id:notificationId,recipientId:viewerId,version:{proposal:{contract:{projectId}},participants:{some:{userId:viewerId}}}};
   if(!await tx.contractNotification.findFirst({where}))throw new NotFoundException();
   await tx.contractNotification.updateMany({where:{...where,readAt:null},data:{readAt:new Date()}});
   const note=await tx.contractNotification.findUniqueOrThrow({where:{id:notificationId}});
   return {id:note.id,readAt:iso(note.readAt)};
  });
 }
}
