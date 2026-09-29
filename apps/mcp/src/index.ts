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
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const client = new HandoffApiClient(process.env.HANDOFF_API_ORIGIN ?? 'http://127.0.0.1:3000',
    process.env.HANDOFF_MCP_TOKEN ?? '');
  void serveStdio(() => createServer(client));
}
