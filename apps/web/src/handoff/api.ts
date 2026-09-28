import { csrfToken } from '../auth/api';

export type Reply = { id: string; actorId: string; body: string; source: 'HUMAN' | 'CODEX_AUTO'; createdAt: string };
export type FeedItem = { id: string; projectId: string; publicTitle: string; senderId: string; recipientId: string; createdAt: string; replies: Reply[] };
export type InboxItem = { id: string; publicTitle: string; senderId: string; recipientId: string; createdAt: string;
  job: { status: string; reviewReason: string | null } | null };
export type RequestDetail = FeedItem & { privateBody: string; version: number;
  verificationClaim: string | null;
  job: { status: string; reviewReason?: string | null; reviewDraft?: string | null } | null };
export type McpGrant = { id: string; projectId: string; createdAt: string; expiresAt: string };
export type NewMcpGrant = McpGrant & { token: string };
export type EvidenceSource = { id: string; kind: 'LOCAL' | 'GITHUB'; localPath: string | null;
  githubOwner: string | null; githubRepo: string | null; githubPath: string | null; githubRef: string | null;
  snapshot: { contentHash: string; syncedAt: string; dirtyAt: string | null } | null };
export type NewLocalEvidence = { id: string; localPath: string; syncToken: string };

export class HandoffApiError extends Error {
  constructor(readonly status: number) { super(`Handoff request failed: ${status}`); }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: method === 'GET' ? undefined : { 'X-CSRF-Token': csrfToken(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) throw new HandoffApiError(response.status);
  return response.json() as Promise<T>;
}

const project = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
export const loadFeed = (projectId: string) => request<FeedItem[]>(`${project(projectId)}/feed`);
export const loadInbox = (projectId: string) => request<InboxItem[]>(`${project(projectId)}/inbox`);
export const loadRequest = (projectId: string, requestId: string) => request<RequestDetail>(`${project(projectId)}/requests/${encodeURIComponent(requestId)}`);
export const publishReply = (projectId: string, requestId: string, body: string, idempotencyKey: string) =>
  request<Reply>(`${project(projectId)}/requests/${encodeURIComponent(requestId)}/replies`, 'POST', { body, idempotencyKey });
export const loadMcpGrants = () => request<McpGrant[]>('/api/mcp/grants');
export const issueMcpGrant = (projectId: string) => request<NewMcpGrant>('/api/mcp/grants', 'POST', { projectId });
export const revokeMcpGrant = (grantId: string) => request<{ revoked: boolean }>(`/api/mcp/grants/${encodeURIComponent(grantId)}`, 'DELETE');
export const loadEvidence = (projectId: string) => request<EvidenceSource[]>(`${project(projectId)}/evidence`);
export const registerLocalEvidence = (projectId: string, path: string) =>
  request<NewLocalEvidence>(`${project(projectId)}/evidence/local`, 'POST', { path });
export const registerGithubEvidence = (projectId: string, input: { owner: string; repo: string; path: string; ref: string }) =>
  request<EvidenceSource>(`${project(projectId)}/evidence/github`, 'POST', input);
export const revokeEvidence = (projectId: string, sourceId: string) =>
  request<{ revoked: boolean }>(`${project(projectId)}/evidence/${encodeURIComponent(sourceId)}`, 'DELETE');
