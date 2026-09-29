import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {expect,test,type BrowserContext} from '@playwright/test';
import pg from 'pg';
const origin='http://127.0.0.1:5174';
const token=()=>randomBytes(32).toString('base64url');
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');

test('three members complete private changes, MCP revision and human confirmation with personal notices',async({browser})=>{
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const users=[randomUUID(),randomUUID(),randomUUID()],projectId=randomUUID(),credentials=users.map(()=>({session:token(),csrf:token()})),contexts:BrowserContext[]=[];
 try{
  for(let i=0;i<3;i++){
   await db.query(`INSERT INTO users(id,status) VALUES ($1,'APPROVED')`,[users[i]]);
   await db.query(`INSERT INTO provider_identities(id,user_id,provider,provider_subject,display_name) VALUES ($1,$2,'GOOGLE',$3,$4)`,[randomUUID(),users[i],randomUUID(),['A','B','C'][i]]);
   await db.query(`INSERT INTO auth_sessions(token_hash,csrf_hash,user_id,expires_at) VALUES ($1,$2,$3,now()+interval '1 day')`,[hash(credentials[i].session),hash(credentials[i].csrf),users[i]]);
   const ctx=await browser.newContext();contexts.push(ctx);
   await ctx.addCookies([{name:'ho_session',value:credentials[i].session,url:origin,httpOnly:true},{name:'ho_csrf',value:credentials[i].csrf,url:origin}]);
  }
  await db.query('INSERT INTO projects(id,name,creator_id) VALUES ($1,$2,$3)',[projectId,'사람 처리 시험',users[0]]);
  for(const user of users)await db.query(`INSERT INTO project_memberships(project_id,user_id,role) VALUES ($1,$2,'MEMBER')`,[projectId,user]);
  const a=await contexts[0].newPage(),b=await contexts[1].newPage(),c=await contexts[2].newPage();
  await a.goto('/settings');await a.getByRole('button',{name:'MCP 연결 발급'}).click();
  const grantToken=await a.getByRole('textbox',{name:'새 MCP 토큰'}).inputValue();
  const mcp=(path:string,body:unknown)=>fetch(origin+'/api/mcp/'+path,{method:'POST',headers:{Authorization:`Bearer ${grantToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const sent=await mcp('requests',{projectId,recipientId:users[1],publicTitle:'공개 검토 제목',privateBody:'v1 비공개 본문',idempotencyKey:randomUUID()});
  expect(sent.status).toBe(201);const requestId=(await sent.json() as {id:string}).id;
  const path=`/projects/${projectId}/requests/${requestId}`;
  await b.goto(path);await expect(b.getByRole('button',{name:'내용 확인 완료'})).toBeVisible();
  await b.getByRole('textbox',{name:'비공개 수정 의견'}).fill('B만 작성한 비공개 수정 사항');
  await b.getByRole('button',{name:'수정 요청',exact:true}).click();
  await expect(b.getByText('처리 상태: 수정 요청됨')).toBeVisible();
  await a.goto(`/projects/${projectId}/inbox`);await a.getByRole('tab',{name:'보낸함'}).click();
  await expect(a.getByText(/수정 필요 1/)).toBeVisible();
  await expect(a.getByRole('link',{name:'공개 검토 제목 · 버전 1 · 수정 요청'})).toBeVisible();
  await a.getByRole('button',{name:'알림 읽음'}).click();
  await expect(a.getByText(/읽지 않은 알림 0/)).toBeVisible();
  await c.goto(`/projects/${projectId}/feed`);await expect(c.getByText('공개 검토 제목')).toBeVisible();
  await expect(c.getByText(/B만 작성/)).not.toBeVisible();
  expect((await contexts[2].request.get(origin+'/api'+path)).status()).toBe(404);
  const revision={expectedVersion:1,privateBody:'v2 수정한 비공개 본문',idempotencyKey:randomUUID()};
  expect((await mcp(`requests/${requestId}/versions`,revision)).status).toBe(201);
  expect((await mcp(`requests/${requestId}/versions`,revision)).status).toBe(201);
  await b.reload();await expect(b.getByText('v2 수정한 비공개 본문')).toBeVisible();
  await b.getByRole('button',{name:'내용 확인 완료'}).click();
  await expect(b.getByText('처리 상태: 확인 완료')).toBeVisible();
  await b.reload();await expect(b.getByText('처리 상태: 확인 완료')).toBeVisible();
  await b.getByRole('combobox',{name:'요청 버전'}).selectOption('1');
  await expect(b.getByText('v1 비공개 본문')).toBeVisible();
  await expect(b.getByRole('button',{name:'내용 확인 완료'})).not.toBeVisible();
  await expect(b.getByText(/비공개 수정 의견: B만 작성/)).toBeVisible();
  const stale=await contexts[1].request.post(origin+'/api'+path+'/responses',{headers:{'X-CSRF-Token':credentials[1].csrf},data:{version:1,action:'ACKNOWLEDGE',idempotencyKey:randomUUID()}});
  expect(stale.status()).toBe(409);
  await a.reload();await expect(a.getByRole('link',{name:'공개 검토 제목 · 버전 2 · 내용 확인 완료'})).toBeVisible();
  await expect(a.getByText(/수정 필요 0/)).toBeVisible();
  expect((await db.query('SELECT count(*)::int AS n FROM handoff_versions WHERE request_id=$1',[requestId])).rows[0].n).toBe(2);
  expect((await db.query('SELECT count(*)::int AS n FROM handoff_responses WHERE request_id=$1',[requestId])).rows[0].n).toBe(2);
 }finally{await Promise.allSettled(contexts.map(c=>c.close()));await db.query('DELETE FROM projects WHERE id=$1',[projectId]);await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await db.end();}
});
