import assert from 'node:assert/strict';
import {test} from 'node:test';
import {workerFixture,claim,barrier} from './contract-evidence-fixture.mjs';
const integration=process.env.NODE_ENV==='test'&&process.env.DATABASE_URL?test:test.skip;
integration('contract-only evidence publishes one minimal reply with exact refs and no human approval',async()=>{
 const f=await workerFixture();try{
  const base=await f.contract();const r=await f.request();
  await Promise.all([f.worker.processPendingJobs(1),f.worker.processPendingJobs(1)]);
  assert.equal(await f.replies(r),1);
  assert.deepEqual((await f.job(r)).evidenceRefs,[{kind:'HANDOFF_CONTRACT',sourceId:base.contractId,version:base.versionId}]);
  const feed=JSON.stringify(await f.handoffs.listFeed(f.c,f.p));assert.ok(!feed.includes(claim));assert.ok(!feed.includes('private secret text'));
  assert.equal(await f.db.handoffResponse.count({where:{requestId:r.id}}),0);assert.equal((await f.db.handoffVersion.findFirstOrThrow({where:{requestId:r.id}})).status,'AWAITING_REVIEW');
  const missing=await f.request('natural prose');await f.worker.processPendingJobs(1);assert.equal(await f.replies(missing),0);assert.equal((await f.job(missing)).status,'REVIEW_REQUIRED');
  f.onConfirm(async()=>false);const model=await f.request();await f.worker.processPendingJobs(1);assert.equal(await f.replies(model),0);assert.equal((await f.job(model)).status,'REVIEW_REQUIRED');
 }finally{await f.close();}
});
for(const mode of ['CHANGE','RETIRE','NEW_CONFLICT'])integration(`never publishes an old contract result when ${mode} commits during model confirmation`,async()=>{
 const f=await workerFixture();const entered=barrier(),resume=barrier();let running;
 try{
  const base=await f.contract();const r=await f.request();
  f.onConfirm(async()=>{entered.release();await resume.promise;return true;});running=f.worker.processPendingJobs(1);await Promise.race([entered.promise,running.then(()=>assert.fail('contract evidence must reach model confirmation'))]);
  if(mode==='NEW_CONFLICT')await f.contract('USER_ID_FORMAT: uuid-v7');else {const follow=await f.followup(base,mode,mode==='RETIRE'?'retirement':'USER_ID_FORMAT: uuid-v7');await f.approve(follow);}
  resume.release();await running;assert.equal(await f.replies(r),0);
 }finally{resume.release();await running;await f.close();}
});
for(const mode of ['GRANT','MEMBER','LEASE','KEY','HUMAN_REPLY'])integration(`matching contracts do not bypass ${mode} publication conditions`,async()=>{
 const f=await workerFixture();try{
  await f.contract();const r=await f.request();let calls=0;
  f.onConfirm(async()=>{
   calls++;
   if(mode==='GRANT')await f.db.mcpGrant.update({where:{id:f.grant.id},data:{revokedAt:new Date()}});
   if(mode==='MEMBER')await f.db.projectMembership.delete({where:{projectId_userId:{projectId:f.p,userId:f.b}}});
   if(mode==='LEASE')await f.db.handoffJob.update({where:{versionId:(await f.job(r)).versionId},data:{leaseUntil:new Date(Date.now()-1)}});
   if(mode==='KEY')await f.store.disable();
   if(mode==='HUMAN_REPLY')await f.handoffs.publishReply(f.b,r.id,{body:'Human result',source:'HUMAN',version:1,idempotencyKey:'human-key'});
   return true;
  });
  await f.worker.processPendingJobs(1);
  assert.equal(calls,1);
  assert.equal(await f.db.handoffReply.count({where:{requestId:r.id,source:'CODEX_AUTO'}}),0);
 }finally{await f.close();}
});
