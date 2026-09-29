export type SendRequest = {
  projectId: string;
  recipientId: string;
  publicTitle: string;
  privateBody: string;
  verificationClaim?: string;
  idempotencyKey: string;
};

export class HandoffApiClient {
  readonly origin: string;
  constructor(origin: string, private readonly token: string, private readonly http: typeof fetch = fetch) {
    const url = new URL(origin);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
      throw new Error('HANDOFF_API_ORIGIN must be HTTPS or local loopback HTTP');
    }
    if (!token) throw new Error('HANDOFF_MCP_TOKEN is required');
    this.origin = url.origin;
  }

  private async call(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.http(`${this.origin}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch {
      throw new Error('HandOff API is unavailable');
    }
    if (!response.ok) throw new Error(`HandOff API request failed (${response.status})`);
    return response.json();
  }

  sendRequest(input: SendRequest): Promise<unknown> {
    return this.call('/api/mcp/requests', 'POST', input);
  }

  resendRequest(input: { requestId: string; expectedVersion: number; privateBody: string; verificationClaim?: string; idempotencyKey: string }): Promise<unknown> {
    const { requestId, ...body } = input;
    return this.call(`/api/mcp/requests/${encodeURIComponent(requestId)}/versions`, 'POST', body);
  }

  listMyProjects(): Promise<unknown> {
    return this.call('/api/mcp/projects', 'GET');
  }

  getMyRequest(requestId: string): Promise<unknown> {
    return this.call(`/api/mcp/requests/${encodeURIComponent(requestId)}`, 'GET');
  }
  proposeContract(input:{projectId:string;recipientId:string;publicTitle:string;proposedBody:string;requiredPmIds:string[];referencePmIds:string[];idempotencyKey:string;previousContractId?:string}){
    return this.call('/api/mcp/contracts','POST',input);
  }
  reviseContractProposal(input:{proposalId:string;expectedVersion:number;proposedBody:string;requiredPmIds:string[];referencePmIds:string[];idempotencyKey:string}){
    const {proposalId,...body}=input;return this.call(`/api/mcp/contract-proposals/${encodeURIComponent(proposalId)}/versions`,'POST',body);
  }
  getMyContractProposal(proposalId:string,version?:number){return this.call(`/api/mcp/contract-proposals/${encodeURIComponent(proposalId)}${version===undefined?'':`?version=${version}`}`,'GET');}
  listActiveContracts(){return this.call('/api/mcp/contracts','GET');}
  getContract(contractId:string){return this.call(`/api/mcp/contracts/${encodeURIComponent(contractId)}`,'GET');}
  proposeContractChange(input:{contractId:string;kind:'CHANGE'|'RETIRE';baselineVersionId:string;previousProposalId?:string;proposedBody:string;requiredPmIds:string[];referencePmIds:string[];idempotencyKey:string}){
    const {contractId,...body}=input;return this.call(`/api/mcp/contracts/${encodeURIComponent(contractId)}/proposals`,'POST',body);
  }
  restartContractProposal(input:{contractId:string;previousProposalId:string;proposedBody:string;requiredPmIds:string[];referencePmIds:string[];idempotencyKey:string}){
    const {contractId,...body}=input;return this.call(`/api/mcp/contracts/${encodeURIComponent(contractId)}/proposals`,'POST',{...body,kind:'INITIAL'});
  }
}
