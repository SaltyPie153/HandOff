import {csrfToken} from '../auth/api';
export type VersionStatus='IN_REVIEW'|'CHANGES_REQUESTED'|'SUPERSEDED'|'CONFIRMED'|'WITHDRAWN';
export const statusLabel:Record<VersionStatus,string>={IN_REVIEW:'검토 중',CHANGES_REQUESTED:'수정 요청됨',SUPERSEDED:'대체된 버전',CONFIRMED:'확정',WITHDRAWN:'철회됨'};
export type ProposalKind='INITIAL'|'CHANGE'|'RETIRE';
export const kindLabel:Record<ProposalKind,string>={INITIAL:'신규',CHANGE:'변경',RETIRE:'폐기'};
export type ContractCard={id:string;publicTitle:string;status:'UNCONFIRMED'|'ACTIVE'|'RETIRED';confirmedAt:string|null;retiredAt:string|null;canOpenProposal:boolean};
export type ConfirmedSnapshot={proposalId:string;versionId:string;version:number;body:string;confirmedAt:string};
export type ContractDetail=ContractCard&{version:number|null;body:string|null;history:ConfirmedSnapshot[];lastConfirmed:ConfirmedSnapshot|null;retirement:{versionId:string;version:number;reason:string;confirmedAt:string}|null;previousContractId:string|null};
export type ProposalItem={proposalId:string;contractId:string;kind:ProposalKind;lifecycle:'OPEN'|'CONFIRMED'|'WITHDRAWN';publicTitle:string;currentVersion:number;version:number;status:VersionStatus;createdAt:string};
export type ProposalDetail=Omit<ProposalItem,'createdAt'>&{senderId:string;recipientId:string;versionId:string;proposedBody:string;blocked:boolean;canRespond:boolean;canRevise:boolean;canWithdraw:boolean;baselineVersionId:string|null;previousProposalId:string|null;withdrawal:{actorId:string;reason:string;withdrawnAt:string}|null;
 participants:Array<{userId:string;role:'SENDER'|'RECIPIENT'|'REQUIRED_PM'|'REFERENCE_PM';displayName:string}>;
 versions:Array<{version:number;status:VersionStatus;createdAt:string}>;
 responses:Array<{actorId:string;action:'AGREE'|'REQUEST_CHANGES';comment:string|null;createdAt:string}>};
export type ContractSummary={needsReview:number;needsChanges:number;unreadNotifications:number};
export type ContractNotification={id:string;proposalId:string;proposalKind:ProposalKind;version:number;publicTitle:string;kind:'PROPOSAL_RECEIVED'|'REVISION_RECEIVED'|'CHANGES_REQUESTED'|'CONFIRMED'|'WITHDRAWN';createdAt:string;readAt:string|null};
export type WithdrawContractInput={expectedVersion:number;reason:string;idempotencyKey:string};
export const withdrawProposal=(p:string,id:string,input:WithdrawContractInput)=>request(`${project(p)}/contract-proposals/${encodeURIComponent(id)}/withdraw`,input);
export class ContractApiError extends Error{constructor(readonly status:number){super(`Contract request failed: ${status}`);}}
async function request<T>(path:string,body?:unknown):Promise<T>{
 const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken()},body:JSON.stringify(body)})});
 if(!r.ok)throw new ContractApiError(r.status);return r.json() as Promise<T>;
}
const project=(id:string)=>`/api/projects/${encodeURIComponent(id)}`;
export const loadContracts=(p:string)=>request<ContractCard[]>(`${project(p)}/contracts`);
export const loadContract=(p:string,id:string)=>request<ContractDetail>(`${project(p)}/contracts/${encodeURIComponent(id)}`);
export const loadProposals=(p:string)=>request<ProposalItem[]>(`${project(p)}/contract-proposals`);
export const loadProposal=(p:string,id:string,version?:number)=>request<ProposalDetail>(`${project(p)}/contract-proposals/${encodeURIComponent(id)}${version===undefined?'':`?version=${version}`}`);
export const respond=(p:string,id:string,input:{version:number;action:'AGREE'|'REQUEST_CHANGES';comment?:string;idempotencyKey:string})=>request(`${project(p)}/contract-proposals/${encodeURIComponent(id)}/responses`,input);
export const loadSummary=(p:string)=>request<ContractSummary>(`${project(p)}/contract-summary`);
export const loadNotifications=(p:string)=>request<ContractNotification[]>(`${project(p)}/contract-notifications`);
export const markRead=(p:string,id:string)=>request(`${project(p)}/contract-notifications/${encodeURIComponent(id)}/read`,{});
export const errorLabel=(error:unknown)=>error instanceof ContractApiError&&[401,403,404].includes(error.status)?'접근 권한이 없습니다.':'불러오지 못했습니다. 다시 시도해 주세요.';
