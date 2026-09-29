import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ContractProposalPage} from '../src/contracts/ContractProposalPage';
import {ContractDetailPage} from '../src/contracts/ContractDetailPage';
import {ContractInboxPage} from '../src/contracts/ContractInboxPage';
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.history.replaceState({},'','/');});
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
const initial={contractId:'contract',proposalId:'proposal',kind:'RETIRE',lifecycle:'OPEN',baselineVersionId:'base',previousProposalId:null,withdrawal:null,publicTitle:'폐기 검토',senderId:'A',recipientId:'B',currentVersion:1,versionId:'v1',version:1,proposedBody:'폐기할 이유',status:'IN_REVIEW',blocked:false,canRespond:true,canRevise:true,canWithdraw:true,participants:[],versions:[{version:1,status:'IN_REVIEW',createdAt:'2026-09-30T00:00:00Z'}],responses:[]};
const publicDetail={id:'contract',publicTitle:'계약',status:'ACTIVE',version:1,body:'기존 본문',confirmedAt:'2026-09-30T00:00:00Z',canOpenProposal:true,history:[{proposalId:'old',versionId:'base',version:1,body:'기존 본문',confirmedAt:'2026-09-30T00:00:00Z'}]};
it('retirement review distinguishes existing terms and human withdrawal retries preserve reason and key',async()=>{
 const posts:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{if(init?.method==='POST'){posts.push({url,body:JSON.parse(String(init.body))});if(posts.length===1)throw new Error('lost');return json({});}return json(url.includes('/contracts/')?publicDetail:posts.length>1?{...initial,canWithdraw:false,canRespond:false,status:'WITHDRAWN',withdrawal:{reason:'보류',withdrawnAt:'2026-09-30T00:00:00Z'}}:initial);}));
 render(<ContractProposalPage projectId="p" proposalId="proposal" viewerId="A"/>);
 expect(await screen.findByRole('button',{name:'이 계약의 폐기에 동의'})).toBeEnabled();expect(await screen.findByText('기존 본문')).toBeVisible();
 fireEvent.change(screen.getByRole('textbox',{name:'철회 사유'}),{target:{value:'보류'}});fireEvent.click(screen.getByRole('button',{name:'사유를 확인하고 제안 철회'}));
 await screen.findByText(/철회하지 못했습니다/);fireEvent.click(screen.getByRole('button',{name:'사유를 확인하고 제안 철회'}));await waitFor(()=>expect(posts).toHaveLength(2));expect(posts[0]).toEqual(posts[1]);expect(posts[0].url).toMatch(/\/withdraw$/);
});
it('409 requires refresh, preserves reason and changes retry key for a new version',async()=>{
 const posts:any[]=[];let reads=0;
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{if(init?.method==='POST'){posts.push(JSON.parse(String(init.body)));return json({},409);}if(url.includes('/contracts/'))return json(publicDetail);return json(++reads===1?initial:{...initial,version:2,currentVersion:2,versions:[{version:2,status:'IN_REVIEW'}]});}));
 render(<ContractProposalPage projectId="p" proposalId="proposal" viewerId="A"/>);
 fireEvent.change(await screen.findByRole('textbox',{name:'철회 사유'}),{target:{value:'내 이유'}});fireEvent.click(screen.getByRole('button',{name:'사유를 확인하고 제안 철회'}));
 await screen.findByText(/최신 버전을 다시 확인/);expect(screen.getByRole('button',{name:'사유를 확인하고 제안 철회'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'최신 버전 새로고침'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'사유를 확인하고 제안 철회'})).toBeEnabled());expect(screen.getByRole('textbox',{name:'철회 사유'})).toHaveValue('내 이유');expect(posts).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'사유를 확인하고 제안 철회'}));await waitFor(()=>expect(posts).toHaveLength(2));expect(posts[1].expectedVersion).toBe(2);expect(posts[1].idempotencyKey).not.toBe(posts[0].idempotencyKey);
});
it('switching proposal identity never carries an old withdrawal draft',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>json(url.includes('/contracts/')?publicDetail:initial)));
 const view=render(<ContractProposalPage projectId="p" proposalId="proposal" viewerId="A"/>);fireEvent.change(await screen.findByRole('textbox',{name:'철회 사유'}),{target:{value:'old'}});
 view.rerender(<ContractProposalPage projectId="p" proposalId="different" viewerId="A"/>);expect(await screen.findByRole('textbox',{name:'철회 사유'})).toHaveValue('');
});
it.each(['reference','past','closed'])('%s has no human withdrawal control',async kind=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>json(url.includes('/contracts/')?publicDetail:{...initial,canWithdraw:false,canRespond:false,canRevise:false,...(kind==='past'?{version:1,currentVersion:2}:{}),...(kind==='closed'?{status:'WITHDRAWN'}:{})})));
 render(<ContractProposalPage projectId="p" proposalId="proposal" viewerId="B"/>);await screen.findByText('폐기할 이유');expect(screen.queryByRole('textbox',{name:'철회 사유'})).not.toBeInTheDocument();
});
it('retired public detail labels last body as history with no active terms',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>json({...publicDetail,status:'RETIRED',version:null,body:null,retiredAt:'2026-09-30T00:00:00Z',lastConfirmed:publicDetail.history[0],retirement:{reason:'종료 합의',confirmedAt:'2026-09-30T00:00:00Z'}})));
 render(<ContractDetailPage projectId="p" contractId="contract"/>);expect(await screen.findByText('현재 유효 계약 없음')).toBeVisible();expect(screen.getByText('종료 합의')).toBeVisible();expect(screen.getByText('기존 본문')).toBeVisible();expect(screen.queryByText(/팀 공개 확정 계약 · 버전/)).not.toBeInTheDocument();
});
it.each([null,'open-proposal'])('public detail shows pending work with an authorized link only: %s',async openProposalId=>{
 vi.stubGlobal('fetch',vi.fn(async()=>json({...publicDetail,lastConfirmed:publicDetail.history[0],hasOpenProposal:true,openProposalId})));
 render(<ContractDetailPage projectId="p" contractId="contract"/>);expect(await screen.findByText('검토 중인 제안이 있습니다. 합의 전까지 현재 계약이 유지됩니다.')).toBeVisible();
 if(openProposalId)expect(screen.getByRole('link',{name:'진행 중인 제안 검토'})).toHaveAttribute('href','/projects/p/contract-proposals/open-proposal');else expect(screen.queryByRole('link',{name:'진행 중인 제안 검토'})).not.toBeInTheDocument();
});
it('inbox distinguishes initial, change and retirement sharing the same version number',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>json(url.endsWith('contract-summary')?{needsReview:0,needsChanges:0,unreadNotifications:0}:url.endsWith('contract-notifications')?[]:['INITIAL','CHANGE','RETIRE'].map((kind,i)=>({proposalId:'p'+i,contractId:'c',kind,publicTitle:'동일 제목',version:1,status:'CONFIRMED',createdAt:'2026-09-30T00:00:00Z'})))));
 render(<ContractInboxPage projectId="p"/>);
 for(const kind of ['신규','변경','폐기'])expect(await screen.findByRole('link',{name:`동일 제목 · ${kind} · 버전 1 · 확정`})).toBeVisible();
});
