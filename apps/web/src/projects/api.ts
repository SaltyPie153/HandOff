import { csrfToken } from '../auth/api';

export type ProjectRole = 'MANAGER' | 'MEMBER';
export type MemberView = { userId: string; displayName: string | null; role: ProjectRole; joinedAt: string };
export type ProjectView = { id: string; name: string; description: string | null; role: ProjectRole; createdAt: string };
export type RoomView = ProjectView & { members: MemberView[] };
export type AdminProjectView = { id: string; name: string; description: string | null; memberCount: number };
export type CandidateView = { id: string; displayName: string | null };

export class ProjectApiError extends Error {
  constructor(readonly status: number) { super(`Project request failed: ${status}`); }
}

async function request<T>(url: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(url, { method, credentials: 'same-origin',
    headers: method === 'GET' ? undefined : { 'X-CSRF-Token': csrfToken(), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  if (!response.ok) throw new ProjectApiError(response.status);
  return response.json() as Promise<T>;
}

export const loadMine = () => request<ProjectView[]>('/api/projects');
export const createProject = (name: string, description: string) => request<ProjectView>('/api/projects', 'POST', { name, description });
export const loadRoom = (id: string) => request<RoomView>(`/api/projects/${encodeURIComponent(id)}`);
export const loadMembers = (id: string) => request<MemberView[]>(`/api/projects/${encodeURIComponent(id)}/members`);
export const loadCandidates = (id: string, query: string) => request<CandidateView[]>(`/api/projects/${encodeURIComponent(id)}/eligible-users?query=${encodeURIComponent(query)}`);
export const addMember = (id: string, userId: string) => request<{ status: 'ADDED' | 'ALREADY_MEMBER' }>(`/api/projects/${encodeURIComponent(id)}/members`, 'POST', { userId });
export const removeMember = (id: string, userId: string) => request<{ status: 'REMOVED' | 'NOT_MEMBER' }>(`/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, 'DELETE');
export const loadAdminProjects = () => request<AdminProjectView[]>('/api/admin/projects');
