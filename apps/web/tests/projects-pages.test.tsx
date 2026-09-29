import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ProjectSelectPage } from '../src/projects/ProjectSelectPage';
import { ProjectRoomPage } from '../src/projects/ProjectRoomPage';
import { AdminProjectsPage } from '../src/projects/AdminProjectsPage';
import { ProjectMembersPage } from '../src/projects/ProjectMembersPage';

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
  const roomFetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...room,
    members: [{ userId: 'owner', displayName: '이전 룸 멤버 현황', role: 'MANAGER', joinedAt: room.createdAt }]
  }), { status: 200 })).mockResolvedValueOnce(new Response('', { status: 404 }));
  vi.stubGlobal('fetch', vi.fn((url:string)=>url.endsWith('/handoff-summary')?Promise.resolve(new Response(JSON.stringify({needsReview:0,needsChanges:0,unreadNotifications:0}))):url.endsWith('/notifications')?Promise.resolve(new Response('[]')):roomFetch()));
  render(<ProjectRoomPage id={room.id} />);
  expect(await screen.findByText(/이전 룸 멤버 현황/)).toBeVisible();
  expect(screen.getByRole('link', { name: '팀 인수인계 피드' })).toHaveAttribute('href', `/projects/${room.id}/feed`);
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

it('shows stable member IDs when two approved candidates have the same display name', async () => {
  const first = '4d09a865-b11d-45bd-a0bc-8917cd12be52';
  const second = '8ad49771-43e1-4ee1-ae68-3d38fcf519da';
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(
    url.endsWith('/members') ? [] : [{ id: first, displayName: '동명이인' }, { id: second, displayName: '동명이인' }]
  ), { status: 200 }))));
  render(<ProjectMembersPage id={room.id} isServiceAdmin={false} />);
  expect(await screen.findByText(`회원 ID: ${first}`)).toBeVisible();
  expect(screen.getByText(`회원 ID: ${second}`)).toBeVisible();
  expect(screen.getAllByText('동명이인')).toHaveLength(2);
});

it('keeps the newest candidate search when an older response arrives last', async () => {
  let finishA!: (response: Response) => void;
  let finishB!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.endsWith('/members')) return Promise.resolve(new Response('[]', { status: 200 }));
    if (url.endsWith('query=A')) return new Promise<Response>(resolve => { finishA = resolve; });
    if (url.endsWith('query=B')) return new Promise<Response>(resolve => { finishB = resolve; });
    return Promise.resolve(new Response('[]', { status: 200 }));
  }));
  render(<ProjectMembersPage id={room.id} isServiceAdmin={false} />);
  await screen.findByRole('heading', { name: '현재 멤버' });
  fireEvent.change(screen.getByRole('textbox', { name: '회원 이름 검색' }), { target: { value: 'A' } });
  fireEvent.click(screen.getByRole('button', { name: '검색' }));
  fireEvent.change(screen.getByRole('textbox', { name: '회원 이름 검색' }), { target: { value: 'B' } });
  fireEvent.click(screen.getByRole('button', { name: '검색' }));
  finishB(new Response(JSON.stringify([{ id: '8ad49771-43e1-4ee1-ae68-3d38fcf519da', displayName: '최근 결과' }]), { status: 200 }));
  expect(await screen.findByText('최근 결과')).toBeVisible();
  await act(async () => { finishA(new Response(JSON.stringify([{ id: '4d09a865-b11d-45bd-a0bc-8917cd12be52', displayName: '이전 결과' }]), { status: 200 })); });
  expect(screen.queryByText('이전 결과')).not.toBeInTheDocument();
  expect(screen.getByText('최근 결과')).toBeVisible();
});
