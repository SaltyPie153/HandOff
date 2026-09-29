import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ContractProposalPage} from '../src/contracts/ContractProposalPage';
import {ContractDetailPage} from '../src/contracts/ContractDetailPage';
import {ContractNotifications} from '../src/contracts/ContractNotifications';
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.history.replaceState({},'','/');});
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
const initial={contractId:'contract',proposalId:'proposal',publicTitle:'계약 시험',senderId:'A',recipientId:'B',currentVersion:1,versionId:'v1',version:1,proposedBody:'비공개 제안 본문',status:'IN_REVIEW',blocked:false,canRespond:true,canRevise:true,
 participants:[{userId:'A',role:'SENDER',displayName:'Alice'},{userId:'B',role:'RECIPIENT',displayName:'Bob'},{userId:'PM',role:'REQUIRED_PM',displayName:'PM'}],versions:[{version:1,status:'IN_REVIEW',createdAt:'2026-09-29T00:00:00Z'}],responses:[]};
it('sender must agree and sees the exact-body team publication notice',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>json(initial)));render(<ContractProposalPage projectId="project" proposalId="proposal" viewerId="A"/>);
 expect(await screen.findByRole('button',{name:'이 버전에 동의'})).toBeEnabled();
 expect(screen.getByText('전원 동의 시 이 버전의 본문이 프로젝트 팀 전체에 공개됩니다.')).toBeVisible();
});
it('lost response retries preserve both opinion and idempotency key',async()=>{
 const posts:Array<Record<string,unknown>>=[];
 vi.stubGlobal('fetch',vi.fn(async(_url,init?:RequestInit)=>{if(init?.method==='POST'){posts.push(JSON.parse(String(init.body)));if(posts.length===1)throw new Error('network');return json({},201);}return json(posts.length>1?{...initial,canRespond:false,status:'CHANGES_REQUESTED'}:initial);}));
 render(<ContractProposalPage projectId="project" proposalId="proposal" viewerId="A"/>);
 fireEvent.change(await screen.findByRole('textbox',{name:'비공개 수정 의견'}),{target:{value:'수정해 주세요'}});fireEvent.click(screen.getByRole('button',{name:'수정 요청'}));
 await screen.findByText(/처리하지 못했습니다/);expect(screen.getByRole('textbox',{name:'비공개 수정 의견'})).toHaveValue('수정해 주세요');fireEvent.click(screen.getByRole('button',{name:'수정 요청'}));
 await waitFor(()=>expect(posts).toHaveLength(2));expect(posts[0]).toEqual(posts[1]);
});
it('409 and latest-version reload retain draft without automatic submission and use a new key for new version',async()=>{
 const posts:Array<Record<string,unknown>>=[];let reads=0;
 vi.stubGlobal('fetch',vi.fn(async(_url,init?:RequestInit)=>{if(init?.method==='POST'){posts.push(JSON.parse(String(init.body)));return json({},409);}return json(++reads===1?initial:{...initial,version:2,currentVersion:2,versionId:'v2',proposedBody:'수정된 본문'});}));
 render(<ContractProposalPage projectId="project" proposalId="proposal" viewerId="A"/>);
 fireEvent.change(await screen.findByRole('textbox',{name:'비공개 수정 의견'}),{target:{value:'남길 의견'}});fireEvent.click(screen.getByRole('button',{name:'수정 요청'}));
 await screen.findByText(/최신 버전을 다시 확인/);fireEvent.click(screen.getByRole('button',{name:'최신 버전 새로고침'}));
 await screen.findByText('수정된 본문');expect(screen.getByRole('textbox',{name:'비공개 수정 의견'})).toHaveValue('남길 의견');expect(posts).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'수정 요청'}));await waitFor(()=>expect(posts).toHaveLength(2));expect(posts[1].version).toBe(2);expect(posts[1].idempotencyKey).not.toBe(posts[0].idempotencyKey);
});
it.each(['reference','past','complete'])('%s view has no response controls',async kind=>{
 vi.stubGlobal('fetch',vi.fn(async()=>json({...initial,canRespond:false,canRevise:false,...(kind==='past'?{version:1,currentVersion:2,status:'SUPERSEDED'}:{}),...(kind==='complete'?{responses:[{actorId:'A',action:'AGREE',comment:null,createdAt:'2026-09-29T00:00:00Z'}]}:{})})));
 render(<ContractProposalPage projectId="project" proposalId="proposal" viewerId="A"/>);await screen.findByText('비공개 제안 본문');expect(screen.queryByRole('button',{name:'이 버전에 동의'})).not.toBeInTheDocument();
 if(kind==='complete')expect(screen.getByText('내 동의 완료 / 전체 검토 대기')).toBeVisible();
});
it('a late old fetch cannot replace the freshly loaded version',async()=>{
 let resolveOld:(response:Response)=>void=()=>{};let calls=0;
 vi.stubGlobal('fetch',vi.fn(async()=>{if(++calls===1)return new Promise<Response>(resolve=>{resolveOld=resolve;});return json({...initial,version:2,currentVersion:2,proposedBody:'최신 본문'});}));
 render(<ContractProposalPage projectId="project" proposalId="proposal" viewerId="A"/>);fireEvent.click(screen.getByRole('button',{name:'최신 버전 새로고침'}));await screen.findByText('최신 본문');
 await act(async()=>{resolveOld(json(initial));});expect(screen.queryByText('비공개 제안 본문')).not.toBeInTheDocument();
});
it('public contract detail renders only confirmed text and notices are read without consent',async()=>{
 const mutations:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(init?.method==='POST'){mutations.push(url);return json({readAt:'now'});}
  if(url.endsWith('contract-summary'))return json({needsReview:0,needsChanges:0,unreadNotifications:1});
  if(url.endsWith('contract-notifications'))return json([{id:'note',proposalId:'proposal',version:1,publicTitle:'제안',kind:'PROPOSAL_RECEIVED',createdAt:'now',readAt:null}]);
  return json({id:'contract',publicTitle:'공개 계약',status:'ACTIVE',version:2,body:'<script>plain text</script>',confirmedAt:'2026-09-29T00:00:00Z',canOpenProposal:false});
 }));
 render(<><ContractDetailPage projectId="project" contractId="contract"/><ContractNotifications projectId="project"/></>);
 expect(await screen.findByText('<script>plain text</script>')).toBeVisible();expect(screen.queryByText('비공개 수정 의견')).not.toBeInTheDocument();
 fireEvent.click(await screen.findByRole('button',{name:'계약 알림 읽음'}));await waitFor(()=>expect(mutations).toEqual(['/api/projects/project/contract-notifications/note/read']));
});
