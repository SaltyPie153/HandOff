export type ProposeContractInput = { recipientId:string; publicTitle:string; proposedBody:string; requiredPmIds:string[]; referencePmIds:string[]; idempotencyKey:string };
export type ReviseContractInput = Omit<ProposeContractInput,'recipientId'|'publicTitle'> & {expectedVersion:number};
export type ContractResponseInput = {version:number;action:'AGREE'|'REQUEST_CHANGES';comment?:string;idempotencyKey:string};
export type ProposalReceipt = {contractId:string;proposalId:string;versionId:string;version:number;createdAt:string};
export type ResponseReceipt = {id:string;proposalId:string;version:number;action:'AGREE'|'REQUEST_CHANGES';createdAt:string};
export type ContractSummary = {needsReview:number;needsChanges:number;unreadNotifications:number};
