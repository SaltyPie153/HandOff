import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentKeySettings } from '../src/handoff/AgentKeySettings';
import App from '../src/App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

it('stores a server key without ever redisplaying it and clears the password field', async () => {
  const key = 'upstage-fake-browser-key';
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ configured: false, source: 'none' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ configured: true, source: 'file' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<AgentKeySettings />);
  const input = await screen.findByLabelText('Upstage API 키');
  expect(input).toHaveAttribute('type', 'password');
  fireEvent.change(input, { target: { value: key } });
  fireEvent.click(screen.getByRole('button', { name: '저장·교체' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(input).toHaveValue(''));
  expect(screen.queryByText(key)).not.toBeInTheDocument();
  expect(screen.getByText(/키가 설정됨/)).toBeVisible();
});

it('clears the password field when the server rejects saving', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ configured: false, source: 'none' }), { status: 200 }))
    .mockResolvedValueOnce(new Response('', { status: 503 })));
  render(<AgentKeySettings />);
  const input = await screen.findByLabelText('Upstage API 키');
  fireEvent.change(input, { target: { value: 'upstage-fake-browser-key' } });
  fireEvent.click(screen.getByRole('button', { name: '저장·교체' }));
  await waitFor(() => expect(input).toHaveValue(''));
  expect(screen.getByRole('alert')).toHaveTextContent(/저장하지 못했습니다/);
});

it('does not show the server key section to an ordinary approved member', async () => {
  window.history.replaceState({}, '', '/settings');
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(
    url === '/api/auth/me' ? { id: 'member', status: 'APPROVED', isServiceAdmin: false, linkedProviders: ['GOOGLE'] } : []
  ), { status: 200 }))));
  render(<App />);
  await screen.findByRole('heading', { name: '로그인 수단 관리' });
  expect(screen.queryByRole('heading', { name: 'Upstage Solar Pro 4 API 키' })).not.toBeInTheDocument();
});

it('waits for the initial status before allowing a save', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })));
  render(<AgentKeySettings />);
  expect(screen.getByLabelText('Upstage API 키')).toBeDisabled();
  expect(screen.getByRole('button', { name: '저장·교체' })).toBeDisabled();
  finish(new Response(JSON.stringify({ configured: false, source: 'none' }), { status: 200 }));
  await waitFor(() => expect(screen.getByLabelText('Upstage API 키')).toBeEnabled());
});
