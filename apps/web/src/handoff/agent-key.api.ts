import { csrfToken } from '../auth/api';

export type AgentKeyStatus = { configured: boolean; source: 'file' | 'environment' | 'disabled' | 'none' };

async function request(method: 'GET' | 'PUT' | 'DELETE', body?: { key: string }): Promise<AgentKeyStatus> {
  const response = await fetch('/api/admin/agent-key', {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(method === 'GET' ? {} : { headers: {
      'X-CSRF-Token': csrfToken(), ...(body ? { 'Content-Type': 'application/json' } : {})
    } }),
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw new Error('Agent key request failed');
  return response.json() as Promise<AgentKeyStatus>;
}

export const loadAgentKeyStatus = () => request('GET');
export const saveAgentKey = (key: string) => request('PUT', { key });
export const disableAgentKey = () => request('DELETE');
