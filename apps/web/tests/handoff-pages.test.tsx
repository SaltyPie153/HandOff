import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HandoffFeedPage } from '../src/handoff/HandoffFeedPage';
import { HandoffRequestPage } from '../src/handoff/HandoffRequestPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const projectId = '7261aba6-8244-4ca1-a3f8-6a16b0a4b78e';
const requestId = '5c2db49e-394f-4d8a-8ad6-b31c2098bd70';
const recipientId = 'c7fded24-686b-4e95-b9d6-205f6eb5cf79';

it('renders public title and published reply without fetching private details for teammates', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
    id: requestId, publicTitle: '일정 확인', senderId: 'sender', recipientId, createdAt: '2026-09-29T00:00:00Z',
    replies: [{ id: 'reply', body: '완료된 사실', source: 'CODEX_AUTO', createdAt: '2026-09-29T00:01:00Z' }]
  }]), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<HandoffFeedPage projectId={projectId} viewerId="teammate" />);
  expect(await screen.findByText('일정 확인')).toBeVisible();
  expect(screen.getByText(/완료된 사실/)).toBeVisible();
  expect(screen.queryByRole('link', { name: '일정 확인' })).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('requires a recipient preview before publishing to the whole team', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
    id: requestId, projectId, publicTitle: '일정 확인', senderId: 'sender', recipientId,
    privateBody: '당사자 전용 세부', version: 1, currentVersion: 1, versionId:'v1',status:'AWAITING_REVIEW',canRespond:true,response:null,
    versions:[{version:1,status:'AWAITING_REVIEW',createdAt:'2026-09-29T00:00:00Z'}], replies: [], job: { status: 'REVIEW_REQUIRED', reviewReason: '근거 부족' }
  }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'reply' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<HandoffRequestPage projectId={projectId} requestId={requestId} viewerId={recipientId} />);
  expect(await screen.findByText('당사자 전용 세부')).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: '팀 공개 회신' }), { target: { value: '공개할 내용' } });
  expect(screen.queryByRole('button', { name: '팀에 게시' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '공개 내용 미리보기' }));
  expect(screen.getByText(/프로젝트 팀원 모두/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '팀에 게시' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).body).toBe('공개할 내용');
});
