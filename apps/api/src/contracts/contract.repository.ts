import {ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {PrismaService} from '../database/prisma.service.js';
import type {Prisma,ContractProposalVersion,ContractResponse} from '../generated/prisma/client.js';
import {requireMember,requireGrant} from '../handoff/handoff-workflow.js';
import {normalizeProposal,normalizeRevision,normalizeResponse,participants} from './contract-policy.js';
import type {ProposeContractInput,ReviseContractInput,ContractResponseInput,ProposalReceipt,ResponseReceipt} from './contract.types.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const receipt=(v:ContractProposalVersion):ProposalReceipt=>({contractId:v.contractId,proposalId:v.proposalId,versionId:v.id,version:v.version,createdAt:v.createdAt.toISOString()});
const responseReceipt=(r:ContractResponse,version:number):ResponseReceipt=>({id:r.id,proposalId:r.proposalId,version,action:r.action,createdAt:r.createdAt.toISOString()});

export async function lockProposal(tx:Prisma.TransactionClient,proposalId:string,projectId:string){
 await tx.$queryRaw`SELECT c.id FROM development_contracts c JOIN contract_proposals p ON p.contract_id=c.id WHERE p.id=${proposalId}::uuid AND c.project_id=${projectId}::uuid FOR UPDATE OF c`;
 const proposal=await tx.contractProposal.findFirst({where:{id:proposalId,contract:{projectId}},include:{contract:true,versions:{orderBy:{version:'desc'},take:1,include:{participants:true}}}});
 if(!proposal)throw new NotFoundException();return proposal;
}
export async function requiredAvailable(tx:Prisma.TransactionClient,projectId:string,rows:{userId:string;role:string}[]){
 const ids=rows.filter(p=>p.role!=='REFERENCE_PM').map(p=>p.userId);
 return await tx.projectMembership.count({where:{projectId,userId:{in:ids},user:{status:'APPROVED'}}})===ids.length;
}
async function lockRequired(tx:Prisma.TransactionClient,projectId:string,rows:{userId:string;role:string}[]){
 for(const id of rows.filter(p=>p.role!=='REFERENCE_PM').map(p=>p.userId).sort()){
  try{await requireMember(tx,id,projectId);}catch(e){if(e instanceof NotFoundException)throw new ConflictException('A required participant is unavailable');throw e;}
 }
}
async function notify(tx:Prisma.TransactionClient,versionId:string,ids:string[],kind:'PROPOSAL_RECEIVED'|'REVISION_RECEIVED'|'CHANGES_REQUESTED'|'CONFIRMED'){
 await tx.contractNotification.createMany({data:ids.map(recipientId=>({versionId,recipientId,kind})),skipDuplicates:true});
}
export class ContractRepository{
 constructor(readonly prisma:PrismaService){}
 async propose(actorId:string,projectId:string,grantId:string,input:ProposeContractInput):Promise<ProposalReceipt>{
  const value=normalizeProposal(actorId,input),{idempotencyKey,...payload}=value,payloadHash=hash({projectId,...payload});
  const rows=participants(actorId,value.recipientId,value.requiredPmIds,value.referencePmIds);
  return this.prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'contract:'+actorId+':'+idempotencyKey}))::text`;
   for(const id of rows.map(p=>p.userId).sort())await requireMember(tx,id,projectId);
   await requireGrant(tx,grantId,actorId,projectId);
   const old=await tx.contractProposal.findUnique({where:{senderId_sendKey:{senderId:actorId,sendKey:idempotencyKey}},include:{versions:{where:{version:1}}}});
   if(old){if(old.payloadHash!==payloadHash)throw new ConflictException('Idempotency key already used');return receipt(old.versions[0]);}
   const contract=await tx.developmentContract.create({data:{projectId,publicTitle:value.publicTitle}});
   const proposal=await tx.contractProposal.create({data:{contractId:contract.id,senderId:actorId,recipientId:value.recipientId,sendKey:idempotencyKey,payloadHash}});
   const version=await tx.contractProposalVersion.create({data:{contractId:contract.id,proposalId:proposal.id,version:1,proposedBody:value.proposedBody,sendKey:idempotencyKey,payloadHash,participants:{create:rows}}});
   await notify(tx,version.id,rows.map(p=>p.userId),'PROPOSAL_RECEIVED');return receipt(version);
  });
 }
 async revise(actorId:string,projectId:string,proposalId:string,grantId:string,input:ReviseContractInput):Promise<ProposalReceipt>{
  const value=normalizeRevision(input),{idempotencyKey,...payload}=value,payloadHash=hash(payload);
  return this.prisma.$transaction(async tx=>{
   const proposal=await lockProposal(tx,proposalId,projectId);
   if(proposal.senderId!==actorId)throw new NotFoundException();
   const latest=proposal.versions[0],rows=participants(actorId,proposal.recipientId,value.requiredPmIds,value.referencePmIds);
   // Lock the union in one order, including old required members before replacing roles.
   const required=latest.participants.filter(p=>p.role!=='REFERENCE_PM').map(p=>p.userId);
   for(const id of [...new Set([...required,...rows.map(p=>p.userId)])].sort()){
    try{await requireMember(tx,id,projectId);}catch(e){if(e instanceof NotFoundException&&required.includes(id))throw new ConflictException('A required participant is unavailable');throw e;}
   }
   await requireGrant(tx,grantId,actorId,projectId);
   const old=await tx.contractProposalVersion.findUnique({where:{proposalId_sendKey:{proposalId,sendKey:idempotencyKey}}});
   if(old){if(old.payloadHash!==payloadHash)throw new ConflictException('Idempotency key already used');return receipt(old);}
   if(proposal.contract.status==='ACTIVE'||proposal.currentVersion!==value.expectedVersion)throw new ConflictException('Review the latest proposal');
   await tx.contractProposalVersion.update({where:{id:latest.id},data:{status:'SUPERSEDED'}});
   const version=await tx.contractProposalVersion.create({data:{proposalId,contractId:proposal.contractId,version:proposal.currentVersion+1,proposedBody:value.proposedBody,sendKey:idempotencyKey,payloadHash,participants:{create:rows}}});
   await tx.contractProposal.update({where:{id:proposalId},data:{currentVersion:version.version}});
   await notify(tx,version.id,rows.map(p=>p.userId),'REVISION_RECEIVED');return receipt(version);
  });
 }
 async respond(actorId:string,projectId:string,proposalId:string,input:ContractResponseInput):Promise<ResponseReceipt>{
  const value=normalizeResponse(input),{idempotencyKey,...payload}=value,payloadHash=hash(payload);
  return this.prisma.$transaction(async tx=>{
   const proposal=await lockProposal(tx,proposalId,projectId);
   const target=await tx.contractProposalVersion.findUnique({where:{proposalId_version:{proposalId,version:value.version}},include:{participants:true}});
   if(!target||!target.participants.some(p=>p.userId===actorId&&p.role!=='REFERENCE_PM'))throw new NotFoundException();
   // Keep actor access separate from required-party blockage and use a stable lock order.
   await lockRequired(tx,projectId,target.participants);
   const old=await tx.contractResponse.findUnique({where:{proposalId_actorId_responseKey:{proposalId,actorId,responseKey:idempotencyKey}}});
   if(old){if(old.payloadHash!==payloadHash)throw new ConflictException('Idempotency key already used');return responseReceipt(old,value.version);}
   if(proposal.currentVersion!==value.version||target.status!=='IN_REVIEW')throw new ConflictException('Review the latest proposal');
   if(await tx.contractResponse.findUnique({where:{versionId_actorId:{versionId:target.id,actorId}}}))throw new ConflictException('Already responded to this version');
   const response=await tx.contractResponse.create({data:{proposalId,versionId:target.id,actorId,action:value.action,comment:value.comment??null,responseKey:idempotencyKey,payloadHash}});
   if(value.action==='REQUEST_CHANGES'){
    await tx.contractProposalVersion.update({where:{id:target.id},data:{status:'CHANGES_REQUESTED'}});
    await notify(tx,target.id,[proposal.senderId],'CHANGES_REQUESTED');
   }else{
    const required=target.participants.filter(p=>p.role!=='REFERENCE_PM');
    if(await tx.contractResponse.count({where:{versionId:target.id,action:'AGREE',actorId:{in:required.map(p=>p.userId)}}})===required.length){
     const confirmedAt=new Date();
     await tx.contractProposalVersion.update({where:{id:target.id},data:{status:'CONFIRMED',confirmedAt}});
     await tx.developmentContract.update({where:{id:proposal.contractId},data:{status:'ACTIVE',currentVersionId:target.id,confirmedAt}});
     await notify(tx,target.id,target.participants.map(p=>p.userId),'CONFIRMED');
    }
   }
   return responseReceipt(response,value.version);
  });
 }
}
