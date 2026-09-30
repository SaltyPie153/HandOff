import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {workerFixture,barrier,claim} from './contract-evidence-fixture.mjs';
import {HandoffWorkflowRepository} from '../dist/src/handoff/handoff-workflow.repository.js';
import {EVIDENCE_REVIEW_REASONS} from '../dist/src/evidence/evidence-review.js';
const integration=process.env.NODE_ENV==='test'&&process.env.DATABASE_URL?test:test.skip;
const agree=()=>({version:1,action:'AGREE',idempotencyKey:randomUUID()});
async function waitLock(f){const end=Date.now()+6000;while(Date.now()<end){if((await f.db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE application_name=${f.applicationName} AND wait_event_type='Lock'`).length)return;await new Promise(r=>setTimeout(r,20));}assert.fail('expected actual lock wait');}
integration('only final confirmation wakes missing-evidence requests and retry never wakes them twice',async()=>{
 const f=await workerFixture();try{
  const r=await f.request();await f.worker.processPendingJobs(1);assert.equal((await f.job(r)).reviewReason,'최신 근거가 부족합니다');
  const c=await f.repo.propose(f.a,f.p,f.grant.id,{...f.input,proposedBody:claim,idempotencyKey:randomUUID()});
  for(const id of [f.a,f.b]){await f.repo.respond(id,f.p,c.proposalId,agree(),f.sessionFor(id));assert.equal((await f.job(r)).status,'REVIEW_REQUIRED');}
  const input=agree();await f.repo.respond(f.pm,f.p,c.proposalId,input,f.sessionFor(f.pm));
  assert.equal((await f.job(r)).status,'PENDING');assert.equal((await f.job(r)).reviewDraft,null);
  await f.worker.processPendingJobs(1);assert.equal(await f.replies(r),1);assert.equal((await f.job(r)).status,'COMPLETED');
  await f.repo.respond(f.pm,f.p,c.proposalId,input,f.sessionFor(f.pm));assert.equal((await f.job(r)).status,'COMPLETED');
 }finally{await f.close();}
});
integration('requeue includes evidence reasons but preserves human outcomes, old versions and model or permission failures',async()=>{
 const f=await workerFixture(),other=await workerFixture(),flow=new HandoffWorkflowRepository(f.db);try{
  const eligible=[];
  for(const reason of EVIDENCE_REVIEW_REASONS){const r=await f.request();await f.db.handoffJob.update({where:{versionId:(await f.job(r)).versionId},data:{status:'REVIEW_REQUIRED',reviewReason:reason,reviewDraft:'old draft'}});eligible.push(r);}
  const excluded=[];
  for(const reason of ['Upstage 확인 불가','Upstage가 명시적 근거를 확인하지 못했습니다','현재 요청 권한을 확인할 수 없습니다','게시 전 권한 또는 버전이 변경되었습니다']){
   const r=await f.request();await f.db.handoffJob.update({where:{versionId:(await f.job(r)).versionId},data:{status:'REVIEW_REQUIRED',reviewReason:reason}});excluded.push({r,status:'REVIEW_REQUIRED'});
  }
  for(const content of [null,'natural prose']){const r=await f.request(content);await f.db.handoffJob.update({where:{versionId:(await f.job(r)).versionId},data:{status:'REVIEW_REQUIRED',reviewReason:EVIDENCE_REVIEW_REASONS[0]}});excluded.push({r,status:'REVIEW_REQUIRED'});}
  const human=await f.request();await flow.respond(f.b,f.p,human.id,{version:1,action:'ACKNOWLEDGE',idempotencyKey:randomUUID()});excluded.push({r:human,status:'COMPLETED'});
  const reply=await f.request();await f.handoffs.publishReply(f.b,reply.id,{version:1,source:'HUMAN',body:'human opinion',idempotencyKey:randomUUID()});excluded.push({r:reply,status:'COMPLETED'});
  const done=await f.request();await f.db.handoffJob.update({where:{versionId:(await f.job(done)).versionId},data:{status:'COMPLETED',reviewReason:EVIDENCE_REVIEW_REASONS[0]}});excluded.push({r:done,status:'COMPLETED'});
  const old=await f.request();await flow.resend(f.a,f.p,old.id,f.grant.id,{expectedVersion:1,privateBody:'new private',verificationClaim:claim,idempotencyKey:randomUUID()});
  const foreign=await other.request();await other.db.handoffJob.update({where:{versionId:(await other.job(foreign)).versionId},data:{status:'REVIEW_REQUIRED',reviewReason:EVIDENCE_REVIEW_REASONS[0]}});
  await f.contract();for(const r of eligible)assert.equal((await f.job(r)).status,'PENDING');for(const {r,status} of excluded)assert.equal((await f.job(r)).status,status);
  assert.equal((await f.db.handoffJob.findFirstOrThrow({where:{requestId:old.id,version:{version:1}}})).status,'COMPLETED');assert.equal((await other.job(foreign)).status,'REVIEW_REQUIRED');
 }finally{await other.close();await f.close();}
});
for(const kind of ['CHANGE','RETIRE'])integration(`${kind} confirmation invalidates a running execution and its delayed review cannot overwrite pending work`,async()=>{
 const f=await workerFixture(),entered=barrier(),resume=barrier();let running;try{
  const base=await f.contract(),r=await f.request();f.onConfirm(async()=>{entered.release();await resume.promise;return false;});
  running=f.worker.processPendingJobs(1);await Promise.race([entered.promise,running.then(()=>assert.fail('must reach model'))]);
  const old=(await f.job(r)).executionId;assert.ok(old);
  const next=await f.followup(base,kind,kind==='CHANGE'?claim:'retirement');await f.approve(next);
  const pending=await f.job(r);assert.equal(pending.status,'PENDING');assert.equal(pending.executionId,null);assert.equal(pending.leaseUntil,null);
  resume.release();await running;assert.equal((await f.job(r)).status,'PENDING');assert.equal(await f.replies(r),0);
  f.onConfirm(async()=>true);await f.worker.processPendingJobs(1);
  assert.equal((await f.job(r)).status,kind==='CHANGE'?'COMPLETED':'REVIEW_REQUIRED');assert.equal(await f.replies(r),kind==='CHANGE'?1:0);
 }finally{resume.release();await running;await f.close();}
});
integration('evidence review committed before contract confirmation is also requeued',async()=>{
 const f=await workerFixture(),entered=barrier(),resume=barrier();let running;try{
  const base=await f.contract(),r=await f.request(),collect=f.evidence.collect.bind(f.evidence);let calls=0;
  f.evidence.collect=async(...args)=>++calls===2?{records:[],unavailable:['TEST_CHANGED']}:collect(...args);
  const review=f.worker.review.bind(f.worker);f.worker.review=async(...args)=>{await review(...args);entered.release();await resume.promise;};
  running=f.worker.processPendingJobs(1);await Promise.race([entered.promise,running.then(()=>assert.fail('must store evidence review'))]);
  assert.equal((await f.job(r)).status,'REVIEW_REQUIRED');const next=await f.followup(base,'CHANGE',claim);await f.approve(next);
  resume.release();await running;assert.equal((await f.job(r)).status,'PENDING');
 }finally{resume.release();await running;await f.close();}
});
integration('proposal, revision and withdrawal do not wake evidence review',async()=>{
 const f=await workerFixture();try{
  const r=await f.request();await f.worker.processPendingJobs(1);
  const c=await f.repo.propose(f.a,f.p,f.grant.id,{...f.input,proposedBody:claim,idempotencyKey:randomUUID()});
  await f.repo.respond(f.b,f.p,c.proposalId,{version:1,action:'REQUEST_CHANGES',comment:'adjust',idempotencyKey:randomUUID()},f.sessionFor(f.b));
  await f.repo.revise(f.a,f.p,c.proposalId,f.grant.id,{expectedVersion:1,proposedBody:claim,requiredPmIds:[f.pm],referencePmIds:[],idempotencyKey:randomUUID()});
  await f.repo.withdraw(f.a,f.p,c.proposalId,{expectedVersion:2,reason:'cancel',idempotencyKey:randomUUID()},f.sessionFor(f.a));
  assert.equal((await f.job(r)).status,'REVIEW_REQUIRED');
 }finally{await f.close();}
});
for(const first of ['human','requeue'])integration(`human completion is preserved when ${first} locks the job first`,async()=>{
 const f=await workerFixture(),entered=barrier(),resume=barrier(),flow=new HandoffWorkflowRepository(f.db);
 let human,confirm;const transaction=f.db.$transaction.bind(f.db);try{
  const r=await f.request();await f.worker.processPendingJobs(1);
  const c=await f.repo.propose(f.a,f.p,f.grant.id,{...f.input,proposedBody:claim,idempotencyKey:randomUUID()});
  for(const id of [f.a,f.b])await f.repo.respond(id,f.p,c.proposalId,agree(),f.sessionFor(id));
  let pause=true;
  f.db.$transaction=fn=>transaction(tx=>fn(new Proxy(tx,{get(target,property){if(property==='handoffJob')return new Proxy(target.handoffJob,{get(model,name){if(name==='updateMany')return async(...args)=>{const result=await model.updateMany(...args);if(pause){pause=false;entered.release();await resume.promise;}return result;};return model[name];}});return target[property];}})));
  const commands={human:()=>flow.respond(f.b,f.p,r.id,{version:1,action:'ACKNOWLEDGE',idempotencyKey:randomUUID()}),requeue:()=>f.repo.respond(f.pm,f.p,c.proposalId,agree(),f.sessionFor(f.pm))};
  const one=commands[first]();if(first==='human')human=one;else confirm=one;
  await Promise.race([entered.promise,one.then(()=>assert.fail('must hold job update transaction'))]);
  const two=commands[first==='human'?'requeue':'human']();if(first==='human')confirm=two;else human=two;
  await waitLock(f);resume.release();await human;await confirm;
  assert.equal((await f.job(r)).status,'COMPLETED');assert.equal((await f.db.handoffVersion.findFirstOrThrow({where:{requestId:r.id}})).status,'ACKNOWLEDGED');assert.equal(await f.replies(r),0);
 }finally{resume.release();await Promise.allSettled([human,confirm].filter(Boolean));f.db.$transaction=transaction;await f.close();}
});
for(const mode of ['EXISTING_PENDING','NEW_REQUEST','NEW_VERSION'])integration(`${mode} claim waits for confirmation after its requeue snapshot`,async()=>{
 const f=await workerFixture(),entered=barrier(),resume=barrier(),flow=new HandoffWorkflowRepository(f.db);
 let running,confirm,finished=false;const transaction=f.db.$transaction.bind(f.db);try{
  let r=mode==='NEW_REQUEST'?null:await f.request();
  const c=await f.repo.propose(f.a,f.p,f.grant.id,{...f.input,proposedBody:claim,idempotencyKey:randomUUID()});
  for(const id of [f.a,f.b])await f.repo.respond(id,f.p,c.proposalId,agree(),f.sessionFor(id));
  f.db.$transaction=fn=>transaction(tx=>fn(new Proxy(tx,{get(target,property){
   if(property==='$queryRaw')return async(strings,...values)=>{const result=await target.$queryRaw(strings,...values);if(strings.join('').includes('FROM handoff_jobs')){entered.release();await resume.promise;}return result;};
   return target[property];
  }})));
  confirm=f.repo.respond(f.pm,f.p,c.proposalId,agree(),f.sessionFor(f.pm));
  await Promise.race([entered.promise,confirm.then(()=>assert.fail('must pause after the requeue snapshot'))]);
  if(mode==='NEW_REQUEST')r=await f.request();
  if(mode==='NEW_VERSION')await flow.resend(f.a,f.p,r.id,f.grant.id,{expectedVersion:1,privateBody:'new version',verificationClaim:claim,idempotencyKey:randomUUID()});
  running=f.worker.processPendingJobs(1).finally(()=>{finished=true;});
  let locked=false;
  for(let i=0;i<100;i++){
   if(finished)assert.fail('claim must wait for the uncommitted project confirmation');
   const rows=await f.db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE application_name=${f.applicationName} AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock_shared%'`;
   if(rows.length){locked=true;break;}await new Promise(r=>setTimeout(r,10));
  }
  assert.ok(locked,'must observe the claim waiting on the project lock');
  resume.release();await confirm;await running;
  const job=await f.db.handoffJob.findFirstOrThrow({where:{requestId:r.id,version:{version:mode==='NEW_VERSION'?2:1}}});
  assert.equal(job.status,'COMPLETED');assert.equal(await f.replies(r),1);
 }finally{resume.release();await Promise.allSettled([confirm,running].filter(Boolean));f.db.$transaction=transaction;await f.close();}
});
