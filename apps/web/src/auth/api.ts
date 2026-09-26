export type Provider = 'GOOGLE' | 'DISCORD';
export type Viewer = { id: string; status: 'PENDING' | 'APPROVED'; isServiceAdmin: boolean; linkedProviders: Provider[] };

export function csrfToken(): string {
  const entry = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('ho_csrf='));
  return entry?.slice('ho_csrf='.length) ?? '';
}

export async function post(url: string): Promise<Response> {
  return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken() } });
}

export async function startLink(provider: Provider, onNavigate: (url: string) => void): Promise<boolean> {
  const response = await post(`/api/auth/links/${provider.toLowerCase()}/start`);
  if (!response.ok) return false;
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('url' in body) || typeof body.url !== 'string' || !body.url.startsWith('https://')) return false;
  onNavigate(body.url);
  return true;
}
