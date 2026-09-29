import {BadRequestException} from '@nestjs/common';
import {text,versionNumber} from '../handoff/handoff-workflow.js';
import type {ProposeContractInput,ReviseContractInput,ContractResponseInput} from './contract.types.js';
import type {FollowupContractInput,WithdrawContractInput} from './contract.types.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function memberId(value:unknown):string {
 if(typeof value!=='string'||!uuid.test(value))throw new BadRequestException('Invalid member');
 return value.toLowerCase();
}
function ids(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>10)throw new BadRequestException('Invalid participants');
 const result=value.map(memberId).sort();
 if(new Set(result).size!==result.length)throw new BadRequestException('Duplicate participants');
 return result;
}
export function participants(senderId:string,recipientId:string,required:string[],reference:string[]) {
 const rows=[{userId:memberId(senderId),role:'SENDER' as const},{userId:memberId(recipientId),role:'RECIPIENT' as const},
 ...required.map(userId=>({userId,role:'REQUIRED_PM' as const})),...reference.map(userId=>({userId,role:'REFERENCE_PM' as const}))];
 if(new Set(rows.map(r=>r.userId)).size!==rows.length)throw new BadRequestException('Overlapping participant roles');
 return rows;
}
export function normalizeRevision(input:ReviseContractInput):ReviseContractInput {
 if(!input||typeof input!=='object')throw new BadRequestException();
 const requiredPmIds=ids(input.requiredPmIds??[]),referencePmIds=ids(input.referencePmIds??[]);
 if(requiredPmIds.some(id=>referencePmIds.includes(id)))throw new BadRequestException('Overlapping participant roles');
 return {expectedVersion:versionNumber(input.expectedVersion),proposedBody:text(input.proposedBody,50000),requiredPmIds,referencePmIds,idempotencyKey:text(input.idempotencyKey,128)};
}
export function normalizeProposal(senderId:string,input:ProposeContractInput):ProposeContractInput {
 if(!input||typeof input!=='object')throw new BadRequestException();
 const {expectedVersion,...base}=normalizeRevision({...input,expectedVersion:1});
 const recipientId=memberId(input.recipientId);
 participants(senderId,recipientId,base.requiredPmIds,base.referencePmIds);
 return {...base,recipientId,publicTitle:text(input.publicTitle,160),...(input.previousContractId!==undefined?{previousContractId:memberId(input.previousContractId)}:{})};
}
export function normalizeFollowup(input:FollowupContractInput):FollowupContractInput{
 if(!input||!['INITIAL','CHANGE','RETIRE'].includes(input.kind))throw new BadRequestException('Invalid proposal kind');
 const {expectedVersion,...base}=normalizeRevision({...input,expectedVersion:1});
 if(input.kind==='INITIAL'&&(input.baselineVersionId!==undefined||input.previousProposalId===undefined))throw new BadRequestException('Initial continuation requires a withdrawn proposal');
 if(input.kind!=='INITIAL'&&input.baselineVersionId===undefined)throw new BadRequestException('Baseline required');
 return {...base,kind:input.kind,...(input.baselineVersionId!==undefined?{baselineVersionId:memberId(input.baselineVersionId)}:{}),...(input.previousProposalId!==undefined?{previousProposalId:memberId(input.previousProposalId)}:{})};
}
export function normalizeWithdrawal(input:WithdrawContractInput):WithdrawContractInput{
 if(!input||typeof input!=='object')throw new BadRequestException();
 return {expectedVersion:versionNumber(input.expectedVersion),reason:text(input.reason,10000),idempotencyKey:text(input.idempotencyKey,128)};
}
export function normalizeResponse(input:ContractResponseInput):ContractResponseInput {
 if(!input||!['AGREE','REQUEST_CHANGES'].includes(input.action))throw new BadRequestException('Invalid action');
 if(input.action==='AGREE'&&input.comment!=null&&input.comment!=='')throw new BadRequestException('Agreement has no comment');
 return {version:versionNumber(input.version),action:input.action,idempotencyKey:text(input.idempotencyKey,128),
 ...(input.action==='REQUEST_CHANGES'?{comment:text(input.comment,10000)}:{})};
}
