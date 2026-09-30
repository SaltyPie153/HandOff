import assert from 'node:assert/strict';
import {test} from 'node:test';
import {workerFixture,barrier} from './contract-evidence-fixture.mjs';
const integration=process.env.NODE_ENV==='test'&&process.env.DATABASE_URL?test:test.skip;
async function waitLock(f){const end=Date.now()+6000;while(Date.now()<end){const rows=await f.db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE application_name=${f.applicationName} AND wait_event_type='Lock'`;if(rows.length)return;await new Promise(r=>setTimeout(r,20));}assert.fail('expected actual PostgreSQL lock wait');}
for(const mode of ['CHANGE','RETIRE','NEW_CONFLICT'])integration(`final publication detects ${mode} after second collection`,async()=>{
 const f=await workerFixture(),entered=barrier(),resume=barrier();let running;
 try{
  const base=await f.contract(),r=await f.request();const publish=f.worker.publish.bind(f.worker);
  f.worker.publish=async(...args)=>{entered.release();await resume.promise;return publish(...args);};
  running=f.worker.processPendingJobs(1);await Promise.race([entered.promise,running.then(()=>assert.fail('must reach final publication'))]);
  if(mode==='NEW_CONFLICT')await f.contract('USER_ID_FORMAT: uuid-v7');else {const next=await f.followup(base,mode,mode==='RETIRE'?'retirement':'USER_ID_FORMAT: uuid-v7');await f.approve(next);}
  resume.release();await running;assert.equal(await f.replies(r),0);
 }finally{resume.release();await running;await f.close();}
});
integration('publication holding shared project lock commits before a waiting contract retirement',async()=>{
 const f=await workerFixture(),entered=barrier(),resume=barrier();let running,retiring;const transaction=f.db.$transaction.bind(f.db);
 try{
  const base=await f.contract(),retire=await f.followup(base,'RETIRE','retire after reply');
  for(const id of [f.a,f.b])await f.repo.respond(id,f.p,retire.proposalId,{version:1,action:'AGREE',idempotencyKey:crypto.randomUUID()},f.sessionFor(id));
  const r=await f.request();let pause=true;
  f.db.$transaction=fn=>transaction(tx=>fn(new Proxy(tx,{get(target,property){if(property==='developmentContract')return new Proxy(target.developmentContract,{get(model,name){if(name==='findMany')return async(...args)=>{const result=await model.findMany(...args);if(pause){pause=false;entered.release();await resume.promise;}return result;};return model[name];}});return target[property];}})));
  running=f.worker.processPendingJobs(1);await Promise.race([entered.promise,running.then(()=>assert.fail('must validate contracts inside transaction'))]);
  retiring=f.repo.respond(f.pm,f.p,retire.proposalId,{version:1,action:'AGREE',idempotencyKey:crypto.randomUUID()},f.sessionFor(f.pm));
  await waitLock(f);resume.release();await running;await retiring;
  assert.equal(await f.replies(r),1);assert.equal((await f.job(r)).status,'COMPLETED');assert.equal((await f.db.developmentContract.findUniqueOrThrow({where:{id:base.contractId}})).status,'RETIRED');
 }finally{resume.release();await running;await retiring;f.db.$transaction=transaction;await f.close();}
});
integration('retirement holding exclusive project lock commits before a waiting publication',async()=>{
 const f=await workerFixture(),atPublish=barrier(),publishResume=barrier(),atRetire=barrier(),retireResume=barrier();
 let running,retiring;const transaction=f.db.$transaction.bind(f.db);
 try{
  const base=await f.contract(),retire=await f.followup(base,'RETIRE','retire before reply');
  for(const id of [f.a,f.b])await f.repo.respond(id,f.p,retire.proposalId,{version:1,action:'AGREE',idempotencyKey:crypto.randomUUID()},f.sessionFor(id));
  const r=await f.request(),publish=f.worker.publish.bind(f.worker);
  f.worker.publish=async(...args)=>{atPublish.release();await publishResume.promise;return publish(...args);};
  running=f.worker.processPendingJobs(1);await Promise.race([atPublish.promise,running.then(()=>assert.fail('must reach publication'))]);
  f.db.$transaction=fn=>transaction(tx=>fn(new Proxy(tx,{get(target,property){if(property==='developmentContract')return new Proxy(target.developmentContract,{get(model,name){if(name==='update')return async(...args)=>{const result=await model.update(...args);atRetire.release();await retireResume.promise;return result;};return model[name];}});return target[property];}})));
  retiring=f.repo.respond(f.pm,f.p,retire.proposalId,{version:1,action:'AGREE',idempotencyKey:crypto.randomUUID()},f.sessionFor(f.pm));
  await Promise.race([atRetire.promise,retiring.then(()=>assert.fail('must hold retirement transaction'))]);
  publishResume.release();await waitLock(f);retireResume.release();await retiring;await running;
  assert.equal(await f.replies(r),0);
 }finally{publishResume.release();retireResume.release();await running;await retiring;f.db.$transaction=transaction;await f.close();}
});
