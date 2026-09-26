import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LoginPage } from '../src/auth/LoginPage';
import { PendingPage } from '../src/auth/PendingPage';
import { PendingUsersPage } from '../src/auth/PendingUsersPage';
import App from '../src/App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

it('offers both providers and explains a failed login without exposing callback data', () => {
  render(<LoginPage error="failed" />);
  expect(screen.getByRole('link', { name: /Google/ })).toHaveAttribute('href', '/api/auth/google/start');
  expect(screen.getByRole('link', { name: /Discord/ })).toHaveAttribute('href', '/api/auth/discord/start');
  expect(screen.getByRole('alert')).toHaveTextContent(/로그인.*실패/);
});

it('distinguishes a cancelled login from an authentication failure', () => {
  render(<LoginPage error="cancelled" />);
  expect(screen.getByRole('alert')).toHaveTextContent(/취소/);
  expect(screen.getByRole('alert')).not.toHaveTextContent(/실패/);
});

it('pending member sees status and can request another provider link', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: 'https://discord.com/oauth2/authorize' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<PendingPage linkedProviders={['GOOGLE']} onNavigate={vi.fn()} />);
  expect(screen.getByRole('heading', { name: /승인 대기/ })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Discord.*연결/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/links/discord/start', expect.objectContaining({ method: 'POST' })));
});

it('pending member sees the cancelled link result on the return route', async () => {
  window.history.replaceState({}, '', '/settings?error=cancelled');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: 'member', status: 'PENDING', isServiceAdmin: false, linkedProviders: ['GOOGLE']
  }), { status: 200 })));
  render(<App />);
  await screen.findByRole('heading', { name: /가입 승인 대기/ });
  expect(screen.getByText(/계정 연결이 취소되었습니다/)).toBeVisible();
});

it('admin lists pending members and sends one approval request', async () => {
  const pending = [{ id: '9d1925fd-0cfc-4d2c-8d4d-b4ba41b43818', createdAt: '2026-09-26T00:00:00.000Z', identities: [{ provider: 'GOOGLE', displayName: '민지', email: null }] }];
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(pending), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'APPROVED' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<PendingUsersPage />);
  await screen.findByText('민지');
  fireEvent.click(screen.getByRole('button', { name: /승인/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/admin/users/${pending[0].id}/approve`, expect.objectContaining({ method: 'POST' })));
});
