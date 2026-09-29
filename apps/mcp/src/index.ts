import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HandoffApiClient } from './transport.js';

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const safe = async (action: () => Promise<unknown>) => {
  try { return result(await action()); }
  catch (error) {
    return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'HandOff tool failed' }], isError: true };
  }
};

export function createServer(client: HandoffApiClient) {
  const server = new McpServer({ name: 'handoff', version: '0.1.0' });
  server.registerTool('send_request', {
    description: 'Send a private handoff request to one member. Only the title is shared with the project team. Reuse the same idempotencyKey on retries.',
    inputSchema: z.object({
      projectId: z.uuid(), recipientId: z.uuid(), publicTitle: z.string().min(1).max(160),
      privateBody: z.string().min(1).max(50_000),
      verificationClaim: z.string().min(1).max(500).optional(),
      idempotencyKey: z.string().min(1).max(128)
    })
  }, async input => safe(() => client.sendRequest(input)));
  server.registerTool('resend_request', {
    description: 'Send a new immutable version of your own handoff. Read get_my_request for the current version and private change request first. Reuse the idempotencyKey and identical input on retries. This does not confirm receipt or agree to a contract.',
    inputSchema: z.object({ requestId: z.uuid(), expectedVersion: z.number().int().positive(),
      privateBody: z.string().min(1).max(50_000), verificationClaim: z.string().min(1).max(500).optional(),
      idempotencyKey: z.string().min(1).max(128) })
  }, async input => safe(() => client.resendRequest(input)));
  server.registerTool('list_my_projects', {
    description: 'List the project attached to this MCP grant.', inputSchema: z.object({})
  }, async () => safe(() => client.listMyProjects()));
  server.registerTool('get_my_request', {
    description: 'Read a handoff request only when the grant owner is its sender or recipient.',
    inputSchema: z.object({ requestId: z.uuid() })
  }, async ({ requestId }) => safe(() => client.getMyRequest(requestId)));
  const proposalFields={proposedBody:z.string().min(1).max(50_000),requiredPmIds:z.array(z.uuid()).max(10),referencePmIds:z.array(z.uuid()).max(10),idempotencyKey:z.string().min(1).max(128)};
  server.registerTool('propose_contract',{
    description:'Propose a development contract with private version participants. The title is team public; the exact body becomes team public only after every required HUMAN (including the sender) agrees in the web app. This tool never records consent. Reuse identical input and key on retry.',
    inputSchema:z.object({projectId:z.uuid(),recipientId:z.uuid(),publicTitle:z.string().min(1).max(160),previousContractId:z.uuid().optional(),...proposalFields})
  },async input=>safe(()=>client.proposeContract(input)));
  server.registerTool('revise_contract_proposal',{
    description:'Send a new immutable version of your OPEN initial, change or retirement proposal after reading its current version. All human agreements start over. Confirmed or withdrawn proposals cannot be revised. Reuse identical input and key on retry.',
    inputSchema:z.object({proposalId:z.uuid(),expectedVersion:z.number().int().positive(),...proposalFields})
  },async input=>safe(()=>client.reviseContractProposal(input)));
  server.registerTool('propose_contract_change',{
    description:'Only the original sender may propose CHANGE or RETIRE for an active contract. Read get_contract and use lastConfirmed.versionId as baselineVersionId. proposedBody is the complete replacement body for CHANGE, or retirement reason for RETIRE. Existing terms remain active until every required human agrees. Confirmed content/reason is team public. Reuse identical input and key on retry.',
    inputSchema:z.object({contractId:z.uuid(),kind:z.enum(['CHANGE','RETIRE']),baselineVersionId:z.uuid(),previousProposalId:z.uuid().optional(),...proposalFields})
  },async input=>safe(()=>client.proposeContractChange(input)));
  server.registerTool('restart_contract_proposal',{
    description:'Start a new INITIAL proposal on the same unconfirmed contract after your prior INITIAL proposal was withdrawn. Supply that previousProposalId. Human agreements start over; this does not withdraw or consent.',
    inputSchema:z.object({contractId:z.uuid(),previousProposalId:z.uuid(),...proposalFields})
  },async input=>safe(()=>client.restartContractProposal(input)));
  server.registerTool('get_my_contract_proposal',{
    description:'Read only versions in which the grant owner participated. Body reads are audited and never count as agreement.',
    inputSchema:z.object({proposalId:z.uuid(),version:z.number().int().positive().optional()})
  },async input=>safe(()=>client.getMyContractProposal(input.proposalId,input.version)));
  server.registerTool('list_active_contracts',{description:'List currently confirmed contracts in the granted project without private review data.',inputSchema:z.object({})},async()=>safe(()=>client.listActiveContracts()));
  server.registerTool('get_contract',{description:'Read current terms and confirmed history. RETIRED has no current body: body/version are null and lastConfirmed is historical only. This is an audited read, not human consent.',inputSchema:z.object({contractId:z.uuid()})},async({contractId})=>safe(()=>client.getContract(contractId)));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const client = new HandoffApiClient(process.env.HANDOFF_API_ORIGIN ?? 'http://127.0.0.1:3000',
    process.env.HANDOFF_MCP_TOKEN ?? '');
  void serveStdio(() => createServer(client));
}
