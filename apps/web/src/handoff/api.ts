import { csrfToken } from '../auth/api';

export type Reply = { id: string; actorId: string; body: string; source: 'HUMAN' | 'CODEX_AUTO'; createdAt: string; version: number };
export type FeedItem = { id: string; projectId: string; publicTitle: string; canOpen: boolean; createdAt: string; replies: Reply[] };
export type VersionStatus = 'AWAITING_REVIEW' | 'ACKNOWLEDGED' | 'CHANGES_REQUESTED' | 'SUPERSEDED';
export const statusLabel: Record<VersionStatus,string> = { AWAITING_REVIEW:'확인 대기', ACKNOWLEDGED:'확인 완료', CHANGES_REQUESTED:'수정 요청됨', SUPERSEDED:'대체된 버전' };
export type InboxItem = { id: string; publicTitle: string; senderId: string; recipientId: string; createdAt: string; currentVersion: number; status: VersionStatus;
  job: { status: string; reviewReason: string | null } | null };
export type RequestDetail = Omit<FeedItem,'canOpen'> & { privateBody: string; version: number; currentVersion: number; versionId: string; status: VersionStatus; senderId: string; recipientId: string; canRespond: boolean;
  response: { action:'ACKNOWLEDGE'|'REQUEST_CHANGES'; comment:string|null; actorId:string; createdAt:string } | null;
  versions: Array<{version:number;status:VersionStatus;createdAt:string}>;
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
export const loadInbox = (projectId: string,direction?:'received'|'sent') => request<InboxItem[]>(`${project(projectId)}/inbox${direction?'?direction='+direction:''}`);
export const loadRequest = (projectId: string, requestId: string) => request<RequestDetail>(`${project(projectId)}/requests/${encodeURIComponent(requestId)}`);
export const publishReply = (projectId: string, requestId: string, body: string, idempotencyKey: string, version: number) =>
  request<Reply>(`${project(projectId)}/requests/${encodeURIComponent(requestId)}/replies`, 'POST', { body, idempotencyKey, version });
export const loadRequestVersion = (projectId:string,requestId:string,version:number) => request<RequestDetail>(`${project(projectId)}/requests/${encodeURIComponent(requestId)}/versions/${version}`);
export const respondToRequest = (projectId:string,requestId:string,input:{version:number;action:'ACKNOWLEDGE'|'REQUEST_CHANGES';comment?:string;idempotencyKey:string}) =>
  request(`${project(projectId)}/requests/${encodeURIComponent(requestId)}/responses`,'POST',input);
export type HandoffSummary={needsReview:number;needsChanges:number;unreadNotifications:number};
export type HandoffNotification={id:string;requestId:string;publicTitle:string;version:number;kind:'REQUEST_RECEIVED'|'REVISION_RECEIVED'|'ACKNOWLEDGED'|'CHANGES_REQUESTED';createdAt:string;readAt:string|null};
export const loadHandoffSummary=(projectId:string)=>request<HandoffSummary>(`${project(projectId)}/handoff-summary`);
export const loadNotifications=(projectId:string)=>request<HandoffNotification[]>(`${project(projectId)}/notifications`);
export const markNotificationRead=(projectId:string,id:string)=>request<{id:string;readAt:string}>(`${project(projectId)}/notifications/${encodeURIComponent(id)}/read`,'POST',{});
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
