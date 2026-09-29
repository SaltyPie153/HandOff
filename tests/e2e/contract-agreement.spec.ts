import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {expect,test,type BrowserContext} from '@playwright/test';
import pg from 'pg';
const origin='http://127.0.0.1:5174';
const token=()=>randomBytes(32).toString('base64url');const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
test('contract proposal, private changes, new unanimous agreement and exact team-public body',async({browser})=>{
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const users=Array.from({length:4},()=>randomUUID()),projectId=randomUUID(),credentials=users.map(()=>({session:token(),csrf:token()})),contexts:BrowserContext[]=[];
 try{
  for(let i=0;i<users.length;i++){
   await db.query(`INSERT INTO users(id,status) VALUES($1,'APPROVED')`,[users[i]]);
   await db.query(`INSERT INTO provider_identities(id,user_id,provider,provider_subject,display_name) VALUES($1,$2,'GOOGLE',$3,$4)`,[randomUUID(),users[i],randomUUID(),['A','B','PM','C'][i]]);
   await db.query(`INSERT INTO auth_sessions(token_hash,csrf_hash,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')`,[hash(credentials[i].session),hash(credentials[i].csrf),users[i]]);
   const ctx=await browser.newContext();contexts.push(ctx);await ctx.addCookies([{name:'ho_session',value:credentials[i].session,url:origin,httpOnly:true},{name:'ho_csrf',value:credentials[i].csrf,url:origin}]);
  }
  await db.query('INSERT INTO projects(id,name,creator_id) VALUES($1,$2,$3)',[projectId,'계약 합의 시험',users[0]]);
  for(const user of users)await db.query(`INSERT INTO project_memberships(project_id,user_id,role) VALUES($1,$2,'MEMBER')`,[projectId,user]);
  const [a,b,pm,c]=await Promise.all(contexts.map(ctx=>ctx.newPage()));
  await a.goto('/settings');await a.getByRole('button',{name:'MCP 연결 발급'}).click();const grantToken=await a.getByRole('textbox',{name:'새 MCP 토큰'}).inputValue();
  const mcp=(path:string,body:unknown)=>fetch(origin+'/api/mcp/'+path,{method:'POST',headers:{Authorization:`Bearer ${grantToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const sent=await mcp('contracts',{projectId,recipientId:users[1],publicTitle:'API 응답 규칙',proposedBody:'최초 비공개 제안',requiredPmIds:[users[2]],referencePmIds:[],idempotencyKey:randomUUID()});expect(sent.status).toBe(201);
  const r=await sent.json() as {proposalId:string;contractId:string},path=`/projects/${projectId}/contract-proposals/${r.proposalId}`;
  expect((await db.query('SELECT count(*)::int n FROM contract_responses WHERE proposal_id=$1',[r.proposalId])).rows[0].n).toBe(0);
  await c.goto(`/projects/${projectId}/contracts`);await expect(c.getByText('API 응답 규칙 · 미확정')).toBeVisible();await expect(c.getByText('최초 비공개 제안')).not.toBeVisible();expect((await contexts[3].request.get(origin+'/api'+path)).status()).toBe(404);
  await b.goto(path);await expect(b.getByText('전원 동의 시 이 버전의 본문이 프로젝트 팀 전체에 공개됩니다.')).toBeVisible();await b.getByRole('textbox',{name:'비공개 수정 의견'}).fill('비공개 의견: 오류 응답도 명시');await b.getByRole('button',{name:'수정 요청',exact:true}).click();await expect(b.getByText('비공개 계약 제안 · 버전 1 · 수정 요청됨')).toBeVisible();
  await a.goto(`/projects/${projectId}/contract-inbox`);await expect(a.getByText(/수정 필요 1/)).toBeVisible();await expect(a.getByRole('link',{name:'API 응답 규칙 · 버전 1 · 수정 요청',exact:true})).toBeVisible();
  const revision={expectedVersion:1,proposedBody:'확정 대상: 성공 200, 오류 400',requiredPmIds:[users[2]],referencePmIds:[],idempotencyKey:randomUUID()};expect((await mcp(`contract-proposals/${r.proposalId}/versions`,revision)).status).toBe(201);
  await a.goto(path);await b.reload();await pm.goto(path);
  for(const page of [a,b]){await expect(page.getByText('확정 대상: 성공 200, 오류 400')).toBeVisible();await page.getByRole('button',{name:'이 버전에 동의'}).click();await expect(page.getByText('내 동의 완료 / 전체 검토 대기')).toBeVisible();}
  await b.reload();await expect(b.getByText('내 동의 완료 / 전체 검토 대기')).toBeVisible();await c.reload();await expect(c.getByText('API 응답 규칙 · 미확정')).toBeVisible();
  await pm.getByRole('button',{name:'이 버전에 동의'}).click();await expect(pm.getByText('비공개 계약 제안 · 버전 2 · 확정')).toBeVisible();
  await c.reload();await c.getByRole('link',{name:'확정 본문 보기'}).click();await expect(c.getByText('확정 대상: 성공 200, 오류 400')).toBeVisible();await expect(c.getByText(/비공개 의견/)).not.toBeVisible();await expect(c.getByText('최초 비공개 제안')).not.toBeVisible();
  await c.reload();await expect(c.getByText('팀 공개 확정 계약 · 버전 2')).toBeVisible();
  const stale=await contexts[1].request.post(origin+'/api'+path+'/responses',{headers:{'X-CSRF-Token':credentials[1].csrf},data:{version:1,action:'AGREE',idempotencyKey:randomUUID()}});expect(stale.status()).toBe(409);
  expect((await mcp(`contract-proposals/${r.proposalId}/versions`,{...revision,expectedVersion:2,idempotencyKey:randomUUID()})).status).toBe(409);
  await a.goto(`/projects/${projectId}/contract-inbox`);await expect(a.getByRole('link',{name:'API 응답 규칙 · 버전 2 · 계약 확정',exact:true})).toBeVisible();
  expect((await db.query(`SELECT count(*)::int n FROM contract_notifications n JOIN contract_proposal_versions v ON v.id=n.version_id WHERE v.proposal_id=$1 AND n.kind='CONFIRMED'`,[r.proposalId])).rows[0].n).toBe(3);
 }finally{
  await Promise.allSettled(contexts.map(ctx=>ctx.close()));
  await db.query(`UPDATE development_contracts SET status='UNCONFIRMED',current_version_id=NULL,confirmed_at=NULL WHERE project_id=$1`,[projectId]);
  await db.query('DELETE FROM projects WHERE id=$1',[projectId]);await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await db.end();
 }
});
