import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ProjectSelectPage } from '../src/projects/ProjectSelectPage';
import { ProjectRoomPage } from '../src/projects/ProjectRoomPage';
import { AdminProjectsPage } from '../src/projects/AdminProjectsPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

const room = { id: '7261aba6-8244-4ca1-a3f8-6a16b0a4b78e', name: '공유 룸', description: null,
  role: 'MANAGER', createdAt: '2026-09-28T00:00:00.000Z' };

it('shows an empty project list with creation guidance', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
  render(<ProjectSelectPage isServiceAdmin={false} />);
  expect(await screen.findByRole('heading', { name: '프로젝트 선택' })).toBeVisible();
  expect(await screen.findByText(/배정된 프로젝트가 없습니다/)).toBeVisible();
  expect(screen.getByRole('button', { name: '프로젝트 만들기' })).toBeDisabled();
});

it('submits one project and disables repeat submission while the request is pending', async () => {
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response('[]', { status: 200 }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  render(<ProjectSelectPage isServiceAdmin={false} />);
  await screen.findByText(/배정된 프로젝트가 없습니다/);
  fireEvent.change(screen.getByRole('textbox', { name: '프로젝트 이름' }), { target: { value: '공유 룸' } });
  fireEvent.click(screen.getByRole('button', { name: '프로젝트 만들기' }));
  expect(screen.getByRole('button', { name: '프로젝트 만들기' })).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  finish(new Response(JSON.stringify(room), { status: 201 }));
  expect(await screen.findByRole('link', { name: '공유 룸' })).toHaveAttribute('href', `/projects/${room.id}`);
});

it('lets a manager see the empty room and clears stale roster after access loss', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...room,
    members: [{ userId: 'owner', displayName: '이전 룸 멤버 현황', role: 'MANAGER', joinedAt: room.createdAt }]
  }), { status: 200 })).mockResolvedValueOnce(new Response('', { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<ProjectRoomPage id={room.id} />);
  expect(await screen.findByText(/이전 룸 멤버 현황/)).toBeVisible();
  expect(screen.getByText(/아직 공유된 요청이 없습니다/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('접근 권한이 없습니다');
  expect(screen.queryByText(/이전 룸 멤버 현황/)).not.toBeInTheDocument();
});

it('shows service admin assignment controls without a room entry link', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
    { id: room.id, name: room.name, description: null, memberCount: 1 }
  ]), { status: 200 })));
  render(<AdminProjectsPage />);
  expect(await screen.findByText(/공유 룸 · 멤버 1명/)).toBeVisible();
  expect(screen.getByRole('link', { name: '멤버 관리' })).toHaveAttribute('href', `/projects/${room.id}/members`);
  expect(screen.queryByRole('link', { name: '공유 룸' })).not.toBeInTheDocument();
});

it('keeps pending members away from project routes', async () => {
  window.history.replaceState({}, '', '/projects');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: 'pending', status: 'PENDING', isServiceAdmin: false, linkedProviders: ['GOOGLE']
  }), { status: 200 })));
  render(<App />);
  await waitFor(() => expect(screen.getByRole('heading', { name: /가입 승인 대기/ })).toBeVisible());
  expect(screen.queryByRole('heading', { name: '프로젝트 선택' })).not.toBeInTheDocument();
});
