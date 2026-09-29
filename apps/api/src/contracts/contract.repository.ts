import {ConflictException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {PrismaService} from '../database/prisma.service.js';
import type {Prisma,ContractProposalVersion,ContractResponse} from '../generated/prisma/client.js';
import {requireMember,requireGrant} from '../handoff/handoff-workflow.js';
import {normalizeProposal,normalizeRevision,normalizeResponse,normalizeFollowup,normalizeWithdrawal,participants} from './contract-policy.js';
import type {FollowupContractInput,WithdrawContractInput,WithdrawalReceipt,HumanSession} from './contract.types.js';
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
async function lockRequired(tx:Prisma.TransactionClient,projectId:string,rows:{userId:string;role:string}[],actorId:string){
 for(const id of rows.filter(p=>p.role!=='REFERENCE_PM').map(p=>p.userId).sort()){
  try{await requireMember(tx,id,projectId);}catch(e){if(e instanceof NotFoundException&&id!==actorId)throw new ConflictException('A required participant is unavailable');throw e;}
 }
}
async function requireSession(tx:Prisma.TransactionClient,actorId:string,session:HumanSession){
 if(!session)throw new UnauthorizedException();
 await tx.$queryRaw`SELECT token_hash FROM auth_sessions WHERE token_hash=${session.tokenHash} FOR SHARE`;
 const live=await tx.authSession.findFirst({where:{tokenHash:session.tokenHash,csrfHash:session.csrfHash,userId:actorId}});
 if(!live||live.expiresAt<=new Date())throw new UnauthorizedException();
}
function requireBaseline(proposal:{kind:string;baselineVersionId:string|null;contract:{status:string;currentVersionId:string|null}}){
 if(proposal.kind==='INITIAL'?proposal.contract.status!=='UNCONFIRMED':proposal.contract.status!=='ACTIVE'||proposal.baselineVersionId!==proposal.contract.currentVersionId)throw new ConflictException('Review the current confirmed contract');
}
async function notify(tx:Prisma.TransactionClient,versionId:string,ids:string[],kind:'PROPOSAL_RECEIVED'|'REVISION_RECEIVED'|'CHANGES_REQUESTED'|'CONFIRMED'|'WITHDRAWN'){
 await tx.contractNotification.createMany({data:ids.map(recipientId=>({versionId,recipientId,kind})),skipDuplicates:true});
}
export class ContractRepository{
 constructor(readonly prisma:PrismaService){}
 async proposeFollowup(actorId:string,projectId:string,contractId:string,grantId:string,input:FollowupContractInput):Promise<ProposalReceipt>{
  const value=normalizeFollowup(input),{idempotencyKey,...payload}=value,payloadHash=hash({projectId,contractId,...payload});
  return this.prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'contract:'+actorId+':'+idempotencyKey}))::text`;
   await tx.$queryRaw`SELECT id FROM development_contracts WHERE id=${contractId}::uuid AND project_id=${projectId}::uuid FOR UPDATE`;
   const contract=await tx.developmentContract.findFirst({where:{id:contractId,projectId,senderId:actorId}});
   if(!contract)throw new NotFoundException();
   const rows=participants(actorId,contract.recipientId,value.requiredPmIds,value.referencePmIds);
   for(const id of rows.map(p=>p.userId).sort())await requireMember(tx,id,projectId);
   await requireGrant(tx,grantId,actorId,projectId);
   const old=await tx.contractProposal.findUnique({where:{senderId_sendKey:{senderId:actorId,sendKey:idempotencyKey}},include:{versions:{where:{version:1}}}});
   if(old){if(old.payloadHash!==payloadHash)throw new ConflictException('Idempotency key already used');return receipt(old.versions[0]);}
   requireBaseline({kind:value.kind,baselineVersionId:value.baselineVersionId??null,contract});
   if(await tx.contractProposal.count({where:{contractId,lifecycle:'OPEN'}}))throw new ConflictException('A proposal is already open');
   if(value.previousProposalId&&!await tx.contractProposal.count({where:{id:value.previousProposalId,contractId,lifecycle:'WITHDRAWN',kind:value.kind}}))throw new ConflictException('Invalid previous proposal');
   const proposal=await tx.contractProposal.create({data:{contractId,senderId:actorId,recipientId:contract.recipientId,kind:value.kind,baselineVersionId:value.baselineVersionId,previousProposalId:value.previousProposalId,sendKey:idempotencyKey,payloadHash}});
   const version=await tx.contractProposalVersion.create({data:{contractId,proposalId:proposal.id,version:1,proposedBody:value.proposedBody,sendKey:idempotencyKey,payloadHash,participants:{create:rows}}});
   await notify(tx,version.id,rows.map(p=>p.userId),'PROPOSAL_RECEIVED');return receipt(version);
  });
 }
 async withdraw(actorId:string,projectId:string,proposalId:string,input:WithdrawContractInput,session:HumanSession):Promise<WithdrawalReceipt>{
  const value=normalizeWithdrawal(input),{idempotencyKey,...payload}=value,payloadHash=hash(payload);
  return this.prisma.$transaction(async tx=>{
   const proposal=await lockProposal(tx,proposalId,projectId);
   if(proposal.senderId!==actorId||!await tx.projectMembership.count({where:{projectId,userId:actorId,user:{status:'APPROVED'}}}))throw new NotFoundException();
   const latest=proposal.versions[0];await lockRequired(tx,projectId,latest.participants,actorId);await requireSession(tx,actorId,session);
   if(proposal.withdrawalKey===idempotencyKey){
    if(proposal.withdrawalHash!==payloadHash)throw new ConflictException('Idempotency key already used');
    return {proposalId,version:proposal.currentVersion,status:'WITHDRAWN',withdrawnAt:proposal.withdrawnAt!.toISOString()};
   }
   if(proposal.lifecycle!=='OPEN'||proposal.currentVersion!==value.expectedVersion||!['IN_REVIEW','CHANGES_REQUESTED'].includes(latest.status))throw new ConflictException('Review the latest proposal');
   requireBaseline(proposal);const withdrawnAt=new Date();
   await tx.contractProposal.update({where:{id:proposalId},data:{lifecycle:'WITHDRAWN',withdrawnById:actorId,withdrawalReason:value.reason,withdrawnAt,withdrawalKey:idempotencyKey,withdrawalHash:payloadHash}});
   await tx.contractProposalVersion.update({where:{id:latest.id},data:{status:'WITHDRAWN'}});
   await notify(tx,latest.id,latest.participants.map(p=>p.userId),'WITHDRAWN');
   return {proposalId,version:latest.version,status:'WITHDRAWN',withdrawnAt:withdrawnAt.toISOString()};
  });
 }
 async propose(actorId:string,projectId:string,grantId:string,input:ProposeContractInput):Promise<ProposalReceipt>{
  const value=normalizeProposal(actorId,input),{idempotencyKey,...payload}=value,payloadHash=hash({projectId,...payload});
  const rows=participants(actorId,value.recipientId,value.requiredPmIds,value.referencePmIds);
  return this.prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'contract:'+actorId+':'+idempotencyKey}))::text`;
   for(const id of rows.map(p=>p.userId).sort())await requireMember(tx,id,projectId);
   await requireGrant(tx,grantId,actorId,projectId);
   const old=await tx.contractProposal.findUnique({where:{senderId_sendKey:{senderId:actorId,sendKey:idempotencyKey}},include:{versions:{where:{version:1}}}});
   if(old){if(old.payloadHash!==payloadHash)throw new ConflictException('Idempotency key already used');return receipt(old.versions[0]);}
   if(value.previousContractId&&!await tx.developmentContract.count({where:{id:value.previousContractId,projectId,status:'RETIRED'}}))throw new NotFoundException();
   const contract=await tx.developmentContract.create({data:{projectId,publicTitle:value.publicTitle,senderId:actorId,recipientId:value.recipientId,previousContractId:value.previousContractId}});
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
   if(!await tx.projectMembership.count({where:{projectId,userId:actorId,user:{status:'APPROVED'}}}))throw new NotFoundException();
   const latest=proposal.versions[0],rows=participants(actorId,proposal.recipientId,value.requiredPmIds,value.referencePmIds);
   // Lock the union in one order, including old required members before replacing roles.
   const required=latest.participants.filter(p=>p.role!=='REFERENCE_PM').map(p=>p.userId);
   for(const id of [...new Set([...required,...rows.map(p=>p.userId)])].sort()){
    try{await requireMember(tx,id,projectId);}catch(e){if(e instanceof NotFoundException&&id!==actorId&&required.includes(id))throw new ConflictException('A required participant is unavailable');throw e;}
   }
   await requireGrant(tx,grantId,actorId,projectId);
   const old=await tx.contractProposalVersion.findUnique({where:{proposalId_sendKey:{proposalId,sendKey:idempotencyKey}}});
   if(old){if(old.payloadHash!==payloadHash)throw new ConflictException('Idempotency key already used');return receipt(old);}
   if(proposal.lifecycle!=='OPEN'||proposal.currentVersion!==value.expectedVersion||!['IN_REVIEW','CHANGES_REQUESTED'].includes(latest.status))throw new ConflictException('Review the latest proposal');
   requireBaseline(proposal);
   await tx.contractProposalVersion.update({where:{id:latest.id},data:{status:'SUPERSEDED'}});
   const version=await tx.contractProposalVersion.create({data:{proposalId,contractId:proposal.contractId,version:proposal.currentVersion+1,proposedBody:value.proposedBody,sendKey:idempotencyKey,payloadHash,participants:{create:rows}}});
   await tx.contractProposal.update({where:{id:proposalId},data:{currentVersion:version.version}});
   await notify(tx,version.id,rows.map(p=>p.userId),'REVISION_RECEIVED');return receipt(version);
  });
 }
 async respond(actorId:string,projectId:string,proposalId:string,input:ContractResponseInput,session:{tokenHash:string;csrfHash:string}):Promise<ResponseReceipt>{
  const value=normalizeResponse(input),{idempotencyKey,...payload}=value,payloadHash=hash(payload);
  return this.prisma.$transaction(async tx=>{
   const proposal=await lockProposal(tx,proposalId,projectId);
   const target=await tx.contractProposalVersion.findUnique({where:{proposalId_version:{proposalId,version:value.version}},include:{participants:true}});
   if(!target||!target.participants.some(p=>p.userId===actorId&&p.role!=='REFERENCE_PM'))throw new NotFoundException();
   // Keep actor access separate from required-party blockage and use a stable lock order.
   if(!await tx.projectMembership.count({where:{projectId,userId:actorId,user:{status:'APPROVED'}}}))throw new NotFoundException();
   await lockRequired(tx,projectId,target.participants,actorId);
   await requireSession(tx,actorId,session);
   const old=await tx.contractResponse.findUnique({where:{proposalId_actorId_responseKey:{proposalId,actorId,responseKey:idempotencyKey}}});
   if(old){if(old.payloadHash!==payloadHash)throw new ConflictException('Idempotency key already used');return responseReceipt(old,value.version);}
   if(proposal.lifecycle!=='OPEN'||proposal.currentVersion!==value.version||target.status!=='IN_REVIEW')throw new ConflictException('Review the latest proposal');
   requireBaseline(proposal);
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
     await tx.developmentContract.update({where:{id:proposal.contractId},data:proposal.kind==='RETIRE'?{status:'RETIRED',currentVersionId:null,retirementVersionId:target.id,retiredAt:confirmedAt}:{status:'ACTIVE',currentVersionId:target.id,lastConfirmedVersionId:target.id,confirmedAt}});
     await tx.contractProposal.update({where:{id:proposal.id},data:{lifecycle:'CONFIRMED'}});
     await notify(tx,target.id,target.participants.map(p=>p.userId),'CONFIRMED');
    }
   }
   return responseReceipt(response,value.version);
  });
 }
}
