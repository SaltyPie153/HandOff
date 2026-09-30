import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {expect,test,type BrowserContext} from '@playwright/test';
import pg from 'pg';
const origin='http://127.0.0.1:5174',claim='USER_ID_FORMAT: uuid-v4';
const token=()=>randomBytes(32).toString('base64url'),hash=(v:string)=>createHash('sha256').update(v).digest('hex');
test('confirmed contract supports a minimal automatic reply; retirement leaves a new request in private review',async({browser})=>{
 const controlUrl=process.env.HANDOFF_TEST_API_CONTROL_URL,controlToken=process.env.HANDOFF_TEST_API_CONTROL_TOKEN;
 if(!controlUrl||new URL(controlUrl).hostname!=='127.0.0.1'||!controlToken)throw new Error('TEST_CONTROL_REQUIRED');
 const control=async(path:string)=>{const r=await fetch(controlUrl+path,{method:'POST',headers:{'x-test-control-token':controlToken}});expect(r.status).toBe(204);};
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const users=Array.from({length:3},()=>randomUUID()),projectId=randomUUID(),creds=users.map(()=>({session:token(),csrf:token()})),contexts:BrowserContext[]=[];let stopped=false;
 const worker=async()=>{
  await control('/stop');stopped=true;
  try{return JSON.parse(execFileSync(process.execPath,[resolve('tests/e2e/fixtures/contract-evidence-worker.mjs')],{env:process.env,encoding:'utf8',windowsHide:true}));}
  finally{await control('/start');stopped=false;}
 };
 try{
  for(let i=0;i<3;i++){
   await db.query(`INSERT INTO users(id,status) VALUES($1,'APPROVED')`,[users[i]]);
   await db.query(`INSERT INTO provider_identities(id,user_id,provider,provider_subject,display_name) VALUES($1,$2,'GOOGLE',$3,$4)`,[randomUUID(),users[i],randomUUID(),['A','B','C'][i]]);
   await db.query(`INSERT INTO auth_sessions(token_hash,csrf_hash,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')`,[hash(creds[i].session),hash(creds[i].csrf),users[i]]);
   const ctx=await browser.newContext();contexts.push(ctx);await ctx.addCookies([{name:'ho_session',value:creds[i].session,url:origin,httpOnly:true},{name:'ho_csrf',value:creds[i].csrf,url:origin}]);
  }
  await db.query(`INSERT INTO projects(id,name,creator_id) VALUES($1,'계약 근거 시험',$2)`,[projectId,users[0]]);
  for(const id of users)await db.query(`INSERT INTO project_memberships(project_id,user_id,role) VALUES($1,$2,'MEMBER')`,[projectId,id]);
  const [a,b,c]=await Promise.all(contexts.map(ctx=>ctx.newPage()));
  const issued=await contexts[0].request.post(origin+'/api/mcp/grants',{headers:{'X-CSRF-Token':creds[0].csrf},data:{projectId}});expect(issued.status()).toBe(201);const grant=await issued.json();
  const mcp=async(path:string,body:unknown)=>{const r=await contexts[0].request.post(origin+'/api/mcp/'+path,{headers:{Authorization:`Bearer ${grant.token}`},data:body});expect(r.status()).toBe(201);return r.json();};
  const initial=await mcp('contracts',{projectId,recipientId:users[1],publicTitle:'식별자 계약',proposedBody:claim,requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()});
  const agree=async(proposalId:string,retire=false)=>{for(const page of [a,b]){await page.goto(`/projects/${projectId}/contract-proposals/${proposalId}`);await page.getByRole('button',{name:retire?'이 계약의 폐기에 동의':'이 버전에 동의',exact:true}).click();await expect(page.getByText('응답을 저장했습니다.')).toBeVisible();}};
  await agree(initial.proposalId);
  const requestInput={projectId,recipientId:users[1],publicTitle:'계약 근거 요청',privateBody:'B-only contract evidence secret',verificationClaim:claim,idempotencyKey:randomUUID()};
  const r=await mcp('requests',requestInput);expect((await worker()).modelCalls).toBe(1);
  const jobs=await db.query('SELECT status,evidence_refs FROM handoff_jobs WHERE request_id=$1',[r.id]);
  expect(jobs.rows[0]).toEqual({status:'COMPLETED',evidence_refs:[{kind:'HANDOFF_CONTRACT',sourceId:initial.contractId,version:initial.versionId}]});
  await c.goto(`/projects/${projectId}/feed`);await expect(c.getByText('요청한 항목이 등록된 최신 근거에서 일치함을 확인했습니다.')).toBeVisible();
  await expect(c.getByText(claim)).not.toBeVisible();await expect(c.getByText(requestInput.privateBody)).not.toBeVisible();
  const feed=await contexts[2].request.get(origin+`/api/projects/${projectId}/feed`);const feedText=await feed.text();expect(feedText).not.toContain(claim);expect(feedText).not.toContain(requestInput.privateBody);
  expect((await db.query('SELECT count(*)::int n FROM handoff_responses WHERE request_id=$1',[r.id])).rows[0].n).toBe(0);
  expect((await db.query('SELECT status FROM handoff_versions WHERE request_id=$1',[r.id])).rows[0].status).toBe('AWAITING_REVIEW');
  const retire=await mcp(`contracts/${initial.contractId}/proposals`,{kind:'RETIRE',baselineVersionId:initial.versionId,proposedBody:'시험 종료',requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()});await agree(retire.proposalId,true);
  const after=await mcp('requests',{...requestInput,publicTitle:'폐기 뒤 요청',idempotencyKey:randomUUID()});expect((await worker()).modelCalls).toBe(0);
  expect((await db.query('SELECT status,review_reason FROM handoff_jobs WHERE request_id=$1',[after.id])).rows[0]).toEqual({status:'REVIEW_REQUIRED',review_reason:'최신 근거가 부족합니다'});
  expect((await db.query('SELECT count(*)::int n FROM handoff_replies WHERE request_id=$1',[after.id])).rows[0].n).toBe(0);
  await b.goto(`/projects/${projectId}/requests/${after.id}`);await expect(b.getByText(/최신 근거가 부족합니다/)).toBeVisible();
  await c.reload();await expect(c.getByText('최신 근거가 부족합니다')).not.toBeVisible();
 }finally{
  if(stopped)await control('/start');await Promise.allSettled(contexts.map(ctx=>ctx.close()));
  await db.query(`UPDATE development_contracts SET status='UNCONFIRMED',current_version_id=NULL,last_confirmed_version_id=NULL,retirement_version_id=NULL,retired_at=NULL,confirmed_at=NULL WHERE project_id=$1`,[projectId]);
  await db.query(`UPDATE contract_proposals SET baseline_version_id=NULL,kind='INITIAL' WHERE contract_id IN(SELECT id FROM development_contracts WHERE project_id=$1)`,[projectId]);
  await db.query('DELETE FROM projects WHERE id=$1',[projectId]);await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await db.end();
 }
});
