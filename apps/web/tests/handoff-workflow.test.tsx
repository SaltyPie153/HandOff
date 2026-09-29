import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {HandoffRequestPage} from '../src/handoff/HandoffRequestPage';
import {HandoffInboxPage} from '../src/handoff/HandoffInboxPage';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const initial={id:'request',projectId:'project',publicTitle:'검토 요청',senderId:'A',recipientId:'B',privateBody:'비공개 본문',version:1,currentVersion:1,versionId:'v1',status:'AWAITING_REVIEW',verificationClaim:null,response:null,canRespond:true,
  versions:[{version:1,status:'AWAITING_REVIEW',createdAt:'2026-09-29T00:00:00Z'}],replies:[],job:null};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});

it('B requests changes privately and retries a lost response with the same key',async()=>{
 const sent:Array<Record<string,unknown>>=[];let failed=false;
 vi.stubGlobal('fetch',vi.fn(async (_url:string,init?:RequestInit)=>{
  if(init?.method==='POST') {sent.push(JSON.parse(String(init.body))); if(!failed){failed=true;throw new Error('network');} return json({id:'response'},201);}
  return json(sent.length>1?{...initial,status:'CHANGES_REQUESTED',canRespond:false,response:{action:'REQUEST_CHANGES',comment:'비공개 수정 의견',actorId:'B',createdAt:'2026-09-29T01:00:00Z'}}:initial);
 }));
 render(<HandoffRequestPage projectId="project" requestId="request" viewerId="B"/>);
 const button=await screen.findByRole('button',{name:'수정 요청'});
 expect(button).toBeDisabled();
 fireEvent.change(screen.getByRole('textbox',{name:'비공개 수정 의견'}),{target:{value:'비공개 수정 의견'}});
 fireEvent.click(button);await screen.findByText(/처리하지 못했습니다/);
 expect(screen.getByRole('textbox',{name:'비공개 수정 의견'})).toHaveValue('비공개 수정 의견');
 fireEvent.click(button);await waitFor(()=>expect(sent).toHaveLength(2));
 expect(sent[0]).toEqual(sent[1]);expect(sent[0].action).toBe('REQUEST_CHANGES');expect(sent[0].version).toBe(1);
 await waitFor(()=>expect(screen.queryByRole('button',{name:'내용 확인 완료'})).not.toBeInTheDocument());
});
it('stale version rejection preserves the opinion and asks for current version review',async()=>{
 let reads=0;
 const submissions:Array<{version:number;comment:string}>=[];
 vi.stubGlobal('fetch',vi.fn(async (_url:string,init?:RequestInit)=>{
  if(init?.method==='POST'){submissions.push(JSON.parse(String(init.body)));return json({},409);}
  return json(++reads===1?initial:{...initial,version:2,currentVersion:2,versionId:'v2',versions:[...initial.versions,{version:2,status:'AWAITING_REVIEW',createdAt:'2026-09-29T01:00:00Z'}]});
 }));
 render(<HandoffRequestPage projectId="project" requestId="request" viewerId="B"/>);
 const input=await screen.findByRole('textbox',{name:'비공개 수정 의견'});
 fireEvent.change(input,{target:{value:'수정 근거'}});fireEvent.click(screen.getByRole('button',{name:'수정 요청'}));
 expect(await screen.findByText(/최신 버전을 다시 확인/)).toBeVisible();expect(input).toHaveValue('수정 근거');
 fireEvent.click(screen.getByRole('button',{name:'최신 버전 새로고침'}));
 expect(await screen.findByRole('textbox',{name:'비공개 수정 의견'})).toHaveValue('수정 근거');
 expect(screen.getByText('비공개 요청 · 버전 2')).toBeVisible();
 expect(submissions).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'수정 요청'}));
 await waitFor(()=>expect(submissions).toHaveLength(2));
 expect(submissions[1]).toMatchObject({version:2,comment:'수정 근거'});
});

it('a new public reply after success gets a fresh key even with identical text',async()=>{
 const keys:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async (_url:string,init?:RequestInit)=>{
  if(init?.method==='POST'){
   const input=JSON.parse(String(init.body));keys.push(input.idempotencyKey);
   return json({id:'reply-'+keys.length,body:input.body,version:1,source:'HUMAN'},201);
  }
  return json(initial);
 }));
 render(<HandoffRequestPage projectId="project" requestId="request" viewerId="B"/>);
 for(let i=0;i<2;i++){
  fireEvent.change(await screen.findByRole('textbox',{name:'팀 공개 회신'}),{target:{value:'진행 중'}});
  fireEvent.click(screen.getByRole('button',{name:'공개 내용 미리보기'}));
  fireEvent.click(screen.getByRole('button',{name:'팀에 게시'}));
  await waitFor(()=>expect(screen.getByRole('textbox',{name:'팀 공개 회신'})).toHaveValue(''));
 }
 expect(keys).toHaveLength(2);expect(keys[0]).not.toBe(keys[1]);
});
it('sender and past versions have no human response controls',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>json({...initial,version:1,currentVersion:2,canRespond:false,status:'SUPERSEDED'})));
 render(<HandoffRequestPage projectId="project" requestId="request" viewerId="A"/>);
 await screen.findByText('비공개 본문');expect(screen.queryByRole('button',{name:'내용 확인 완료'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'수정 요청'})).not.toBeInTheDocument();
});
it('inbox shows personal counts, filters direction and marks a notice read without confirming a version',async()=>{
 const mutations:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(init?.method==='POST'){mutations.push(url);return json({id:'note',readAt:'2026-09-29T01:00:00Z'});}
  if(url.endsWith('handoff-summary'))return json({needsReview:1,needsChanges:0,unreadNotifications:1});
  if(url.endsWith('notifications'))return json([{id:'note',requestId:'request',publicTitle:'검토 요청',version:2,kind:'REVISION_RECEIVED',createdAt:'2026-09-29T00:00:00Z',readAt:null}]);
  return json(url.includes('direction=sent')?[]:[{id:'request',publicTitle:'검토 요청',senderId:'A',recipientId:'B',currentVersion:2,status:'AWAITING_REVIEW',job:null}]);
 }));
 render(<HandoffInboxPage projectId="project" viewerId="B"/>);
 expect(await screen.findByText(/확인 필요 1/)).toBeVisible();
 fireEvent.click(await screen.findByRole('button',{name:'알림 읽음'}));
 await waitFor(()=>expect(mutations).toEqual(['/api/projects/project/notifications/note/read']));
 fireEvent.click(screen.getByRole('tab',{name:'보낸함'}));
 expect(await screen.findByText('내 요청이 없습니다.')).toBeVisible();
});
