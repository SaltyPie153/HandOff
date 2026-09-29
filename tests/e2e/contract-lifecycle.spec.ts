import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {expect,test,type BrowserContext} from '@playwright/test';
import pg from 'pg';
const origin='http://127.0.0.1:5174',token=()=>randomBytes(32).toString('base64url'),hash=(v:string)=>createHash('sha256').update(v).digest('hex');
test('contract change withdrawal, replacement and retirement preserve private and public history',async({browser})=>{
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const users=Array.from({length:4},()=>randomUUID()),projectId=randomUUID(),creds=users.map(()=>({session:token(),csrf:token()})),contexts:BrowserContext[]=[];
 try{
  for(let i=0;i<4;i++){
   await db.query(`INSERT INTO users(id,status) VALUES($1,'APPROVED')`,[users[i]]);
   await db.query(`INSERT INTO provider_identities(id,user_id,provider,provider_subject,display_name) VALUES($1,$2,'GOOGLE',$3,$4)`,[randomUUID(),users[i],randomUUID(),['A','B','PM','C'][i]]);
   await db.query(`INSERT INTO auth_sessions(token_hash,csrf_hash,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')`,[hash(creds[i].session),hash(creds[i].csrf),users[i]]);
   const ctx=await browser.newContext();contexts.push(ctx);await ctx.addCookies([{name:'ho_session',value:creds[i].session,url:origin,httpOnly:true},{name:'ho_csrf',value:creds[i].csrf,url:origin}]);
  }
  await db.query(`INSERT INTO projects(id,name,creator_id) VALUES($1,'수명주기 시험',$2)`,[projectId,users[0]]);
  for(const id of users)await db.query(`INSERT INTO project_memberships(project_id,user_id,role) VALUES($1,$2,'MEMBER')`,[projectId,id]);
  const [a,b,pm,c]=await Promise.all(contexts.map(ctx=>ctx.newPage()));
  const issued=await contexts[0].request.post(origin+'/api/mcp/grants',{headers:{'X-CSRF-Token':creds[0].csrf},data:{projectId}});expect(issued.status()).toBe(201);const grant=await issued.json();
  const mcp=async(path:string,body:unknown)=>{const response=await contexts[0].request.post(origin+'/api/mcp/'+path,{headers:{Authorization:`Bearer ${grant.token}`},data:body});expect(response.status()).toBe(201);return response.json();};
  const base={proposedBody:'기존 유효 본문',requiredPmIds:[users[2]],referencePmIds:[],idempotencyKey:randomUUID()};
  const initial=await mcp('contracts',{...base,projectId,recipientId:users[1],publicTitle:'계약 변경 실험'});
  const path=(id:string)=>`/projects/${projectId}/contract-proposals/${id}`;
  const agree=async(id:string,retire=false)=>{for(const page of [a,b,pm]){await page.goto(path(id));await page.getByRole('button',{name:retire?'이 계약의 폐기에 동의':'이 버전에 동의',exact:true}).click();await expect(page.getByText('응답을 저장했습니다.')).toBeVisible();}};
  await agree(initial.proposalId);
  const change=await mcp(`contracts/${initial.contractId}/proposals`,{...base,kind:'CHANGE',baselineVersionId:initial.versionId,proposedBody:'비공개 변경 초안',idempotencyKey:randomUUID()});
  await b.goto(path(change.proposalId));await b.getByRole('textbox',{name:'비공개 수정 의견'}).fill('팀에 공개하지 않을 의견');await b.getByRole('button',{name:'수정 요청',exact:true}).click();await expect(b.getByText(/비공개 계약 제안 · 버전 1 · 수정 요청됨/)).toBeVisible();
  await a.goto(path(change.proposalId));await expect(a.getByText('기존 유효 본문')).toBeVisible();await a.getByRole('textbox',{name:'철회 사유'}).fill('비공개 철회 사유');await a.getByRole('button',{name:'사유를 확인하고 제안 철회'}).click();await expect(a.getByText('제안을 철회했습니다.')).toBeVisible();
  await c.goto(`/projects/${projectId}/contracts/${initial.contractId}`);await expect(c.getByText('기존 유효 본문')).toBeVisible();await expect(c.getByText('비공개 변경 초안')).not.toBeVisible();
  expect((await contexts[3].request.get(origin+'/api'+path(change.proposalId))).status()).toBe(404);
  const next=await mcp(`contracts/${initial.contractId}/proposals`,{...base,kind:'CHANGE',baselineVersionId:initial.versionId,previousProposalId:change.proposalId,proposedBody:'새 유효 본문',idempotencyKey:randomUUID()});await agree(next.proposalId);
  await c.reload();await expect(c.getByText('새 유효 본문')).toBeVisible();await expect(c.getByText('기존 유효 본문')).toBeVisible();await expect(c.getByText(/비공개 철회 사유/)).not.toBeVisible();
  const retire=await mcp(`contracts/${initial.contractId}/proposals`,{...base,kind:'RETIRE',baselineVersionId:next.versionId,proposedBody:'프로젝트 종료에 따른 폐기',idempotencyKey:randomUUID()});await agree(retire.proposalId,true);
  await c.reload();await expect(c.getByText('현재 유효 계약 없음')).toBeVisible();await expect(c.getByText('프로젝트 종료에 따른 폐기')).toBeVisible();await expect(c.getByText('새 유효 본문')).toBeVisible();await expect(c.getByText(/팀 공개 확정 계약 · 버전/)).not.toBeVisible();
  const active=await contexts[0].request.get(origin+'/api/mcp/contracts',{headers:{Authorization:`Bearer ${grant.token}`}});expect(await active.json()).toEqual([]);
  await a.goto(path(retire.proposalId));await expect(a.getByRole('button',{name:'이 계약의 폐기에 동의'})).not.toBeVisible();await expect(a.getByRole('textbox',{name:'철회 사유'})).not.toBeVisible();
 }finally{
  await Promise.allSettled(contexts.map(ctx=>ctx.close()));
  await db.query(`UPDATE development_contracts SET status='UNCONFIRMED',current_version_id=NULL,last_confirmed_version_id=NULL,retirement_version_id=NULL,retired_at=NULL,confirmed_at=NULL,previous_contract_id=NULL WHERE project_id=$1`,[projectId]);
  await db.query(`UPDATE contract_proposals SET baseline_version_id=NULL,kind='INITIAL',previous_proposal_id=NULL WHERE contract_id IN(SELECT id FROM development_contracts WHERE project_id=$1)`,[projectId]);
  await db.query('DELETE FROM projects WHERE id=$1',[projectId]);await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await db.end();
 }
});
