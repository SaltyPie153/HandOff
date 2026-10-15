import {cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {afterEach, expect, it} from 'vitest';
import {AppShell} from '../src/ui/AppShell';

afterEach(()=>{cleanup();window.history.replaceState({},'','/');});
const id='7261aba6-8244-4ca1-a3f8-6a16b0a4b78e';

it('keeps project destinations together and selects the parent of a detail route', () => {
  render(<AppShell path={`/projects/${id}/requests/274db4e2-db0b-4446-aa0d-aada5ac6fefa`} isServiceAdmin={false}><h1>시험 요청</h1></AppShell>);
  const nav=screen.getByRole('navigation', {name:'주 메뉴'});
  expect(within(nav).getByRole('link', {name:'내 요청'})).toHaveAttribute('aria-current','page');
  expect(within(nav).getByRole('link', {name:'팀 피드'})).toHaveAttribute('href',`/projects/${id}/feed`);
  expect(within(nav).getByRole('link', {name:'계약 검토'})).toHaveAttribute('href',`/projects/${id}/contract-inbox`);
  expect(within(nav).getByRole('link', {name:'멤버'})).toHaveAttribute('href',`/projects/${id}#members`);
  expect(within(nav).queryByRole('link', {name:'가입 승인'})).not.toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveTextContent('시험 요청');
});

it('shows service administration only to a service administrator', () => {
  render(<AppShell path='/admin/pending' isServiceAdmin><h1>승인</h1></AppShell>);
  const nav=screen.getByRole('navigation',{name:'주 메뉴'});
  expect(within(nav).getByRole('link',{name:'가입 승인'})).toHaveAttribute('aria-current','page');
  expect(within(nav).getByRole('link',{name:'전체 프로젝트 관리'})).toHaveAttribute('href','/admin/projects');
  expect(within(nav).queryByRole('link',{name:'팀 피드'})).not.toBeInTheDocument();
});

it('updates the active destination when an in-page member link is followed', () => {
  window.history.replaceState({},'',`/projects/${id}`);
  render(<AppShell path={`/projects/${id}`} isServiceAdmin={false}><h1>프로젝트</h1></AppShell>);
  window.history.replaceState({},'',`/projects/${id}#members`);
  fireEvent(window,new HashChangeEvent('hashchange'));
  const nav=screen.getByRole('navigation',{name:'주 메뉴'});
  expect(within(nav).getByRole('link',{name:'멤버'})).toHaveAttribute('aria-current','page');
  expect(within(nav).getByRole('link',{name:'프로젝트 개요'})).not.toHaveAttribute('aria-current');
  window.history.replaceState({},'',`/projects/${id}`);
  fireEvent(window,new HashChangeEvent('hashchange'));
  expect(within(nav).getByRole('link',{name:'프로젝트 개요'})).toHaveAttribute('aria-current','page');
});

it('opens a mobile menu and lets the user close it without navigating', async () => {
  render(<AppShell path={`/projects/${id}/contracts`} isServiceAdmin={false}><h1>계약 목록</h1></AppShell>);
  fireEvent.click(screen.getByRole('button',{name:'메뉴 열기'}));
  const mobile=await screen.findByRole('dialog',{name:'탐색 메뉴'});
  expect(within(mobile).getByRole('link',{name:'확정 계약'})).toHaveAttribute('aria-current','page');
  fireEvent.click(within(mobile).getByRole('button',{name:'메뉴 닫기'}));
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'탐색 메뉴'})).not.toBeInTheDocument());
  expect(await screen.findByRole('main')).toHaveTextContent('계약 목록');
});
