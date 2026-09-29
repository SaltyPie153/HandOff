import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {fixture,action,status,sessionFlow} from './contract-fixture.mjs';
const integration=process.env.NODE_ENV==='test'&&process.env.DATABASE_URL?test:test.skip;
integration('contract human unanimity, immutable revision, atomic retries and membership gates',async()=>{
 const mod=await import('../dist/src/contracts/contract.repository.js').catch(()=>({}));
 assert.equal(typeof mod.ContractRepository,'function');
 const f=await fixture();const {db,a,b,pm,ref,c,p,grant,input}=f;const repo=sessionFlow(mod.ContractRepository,f);
 try{
  const r=await repo.propose(a,p,grant.id,input);
  assert.equal(await db.contractResponse.count({where:{proposalId:r.proposalId}}),0);
  assert.deepEqual(await repo.propose(a,p,grant.id,input),r);
  await assert.rejects(repo.propose(a,p,grant.id,{...input,proposedBody:'other'}),status(409));
  await assert.rejects(repo.respond(ref,p,r.proposalId,action(1)),status(404));
  await assert.rejects(repo.respond(c,p,r.proposalId,action(1)),status(404));
  const agree=action(1);const receipt=await repo.respond(a,p,r.proposalId,agree);
  assert.deepEqual(await repo.respond(a,p,r.proposalId,agree),receipt);
  await assert.rejects(repo.respond(a,p,r.proposalId,{...agree,action:'REQUEST_CHANGES',comment:'different'}),status(409));
  await repo.respond(b,p,r.proposalId,action(1));
  assert.equal((await db.developmentContract.findUnique({where:{id:r.contractId}})).status,'UNCONFIRMED');
  await db.projectMembership.delete({where:{projectId_userId:{projectId:p,userId:ref}}});
  await repo.respond(pm,p,r.proposalId,action(1));
  const active=await db.developmentContract.findUnique({where:{id:r.contractId}});
  assert.equal(active.status,'ACTIVE');assert.equal(active.currentVersionId,r.versionId);
  assert.equal(await db.contractNotification.count({where:{versionId:r.versionId,kind:'CONFIRMED'}}),4);
  await assert.rejects(repo.revise(a,p,r.proposalId,grant.id,{expectedVersion:1,proposedBody:'new',requiredPmIds:[pm],referencePmIds:[],idempotencyKey:randomUUID()}),status(409));
  await db.projectMembership.create({data:{projectId:p,userId:ref,role:'MEMBER'}});
  const r2=await repo.propose(a,p,grant.id,{...input,idempotencyKey:randomUUID()});
  await repo.respond(b,p,r2.proposalId,action(1,'REQUEST_CHANGES'));
  await assert.rejects(repo.respond(a,p,r2.proposalId,action(1)),status(409));
  const revision={expectedVersion:1,proposedBody:'body v2',requiredPmIds:[pm,c],referencePmIds:[ref],idempotencyKey:randomUUID()};
  const [v2,retry]=await Promise.all([repo.revise(a,p,r2.proposalId,grant.id,revision),repo.revise(a,p,r2.proposalId,grant.id,{...revision,requiredPmIds:[c,pm]})]);
  assert.deepEqual(retry,v2);assert.equal(v2.version,2);
  assert.equal(await db.contractResponse.count({where:{versionId:v2.versionId}}),0);
  assert.equal((await db.contractProposalVersion.findUnique({where:{id:r2.versionId}})).status,'SUPERSEDED');
  assert.equal((await db.contractResponse.findFirst({where:{versionId:r2.versionId}})).comment,'Private revision comment');
  await assert.rejects(repo.respond(b,p,r2.proposalId,action(1)),status(409));
  await db.projectMembership.delete({where:{projectId_userId:{projectId:p,userId:pm}}});
  await assert.rejects(repo.respond(b,p,r2.proposalId,action(2)),status(409));
  await assert.rejects(repo.revise(a,p,r2.proposalId,grant.id,{...revision,expectedVersion:2,idempotencyKey:randomUUID(),requiredPmIds:[]}),status(409));
  await db.projectMembership.create({data:{projectId:p,userId:pm,role:'MEMBER'}});
  await db.mcpGrant.update({where:{id:grant.id},data:{revokedAt:new Date()}});
  await assert.rejects(repo.revise(a,p,r2.proposalId,grant.id,{...revision,expectedVersion:2,idempotencyKey:randomUUID()}),status(403));
 }finally{await f.close();}
});
async function waitForLocks(f,fragment,count){
 for(let i=0;i<100;i++){
  const rows=await f.db.$queryRaw`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=${f.applicationName} AND wait_event_type='Lock' AND position(${fragment} in query)>0`;
  if(rows[0].n>=count)return;await setTimeout(10);
 }
 assert.fail(`Expected ${count} database lock waiters for ${fragment}`);
}
integration('contract races prove lock waits and both winner orders for agreement, revision, changes and member removal',async()=>{
 const {ContractRepository}=await import('../dist/src/contracts/contract.repository.js');const f=await fixture();
 const {db,a,b,p,grant,input}=f, repo=sessionFlow(ContractRepository,f);
 try{
  for(const kind of ['revision','changes'])for(const first of ['agree','other']){
   const r=await repo.propose(a,p,grant.id,{...input,requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()});
   await repo.respond(a,p,r.proposalId,action(1));
   let release,locked;const acquired=new Promise(r=>locked=r), gate=new Promise(r=>release=r);
   const blocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM development_contracts WHERE id=${r.contractId}::uuid FOR UPDATE`;locked();await gate;});
   await acquired;
   const commands={agree:()=>repo.respond(b,p,r.proposalId,action(1)),other:()=>kind==='revision'?repo.revise(a,p,r.proposalId,grant.id,{expectedVersion:1,proposedBody:'new',requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()}):repo.respond(b,p,r.proposalId,action(1,'REQUEST_CHANGES'))};
   const pending=[];
   try{
    pending.push(commands[first]());void pending[0].catch(()=>{});
    await waitForLocks(f,'FOR UPDATE OF c',1);
    pending.push(commands[first==='agree'?'other':'agree']());void pending[1].catch(()=>{});
    await waitForLocks(f,'FOR UPDATE OF c',2);
   }finally{release();await blocker;await Promise.allSettled(pending);}
   const outcomes=await Promise.allSettled(pending);
   assert.equal(outcomes[0].status,'fulfilled',`${kind}/${first} queued first must win`);
   assert.equal(outcomes[1].status,'rejected');assert.ok(status(409)(outcomes[1].reason));
   const contract=await db.developmentContract.findUnique({where:{id:r.contractId}});
   const confirmed=first==='agree';assert.equal(contract.status,confirmed?'ACTIVE':'UNCONFIRMED');
   assert.equal(await db.contractResponse.count({where:{versionId:r.versionId}}),kind==='revision'&&!confirmed?1:2);
   assert.equal(await db.contractNotification.count({where:{versionId:r.versionId,kind:'CONFIRMED'}}),confirmed?2:0);
   assert.equal(await db.contractProposalVersion.count({where:{proposalId:r.proposalId}}),kind==='revision'&&!confirmed?2:1);
  }
  const r=await repo.propose(a,p,grant.id,{...input,requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()});await repo.respond(a,p,r.proposalId,action(1));
  let release,locked;const acquired=new Promise(r=>locked=r),gate=new Promise(r=>release=r);
  const removal=db.$transaction(async tx=>{await tx.projectMembership.delete({where:{projectId_userId:{projectId:p,userId:a}}});locked();await gate;});await acquired;
  const pending=repo.respond(b,p,r.proposalId,action(1));void pending.catch(()=>{});
  try{await waitForLocks(f,'FOR SHARE OF u,m',1);}finally{release();await removal;await Promise.allSettled([pending]);}
  await assert.rejects(pending,status(409));
  assert.equal((await db.developmentContract.findUnique({where:{id:r.contractId}})).status,'UNCONFIRMED');
  assert.equal(await db.contractNotification.count({where:{versionId:r.versionId,kind:'CONFIRMED'}}),0);
  await db.projectMembership.create({data:{projectId:p,userId:a,role:'MEMBER'}});
  const next=await repo.propose(a,p,grant.id,{...input,requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()});await repo.respond(a,p,next.proposalId,action(1));
  let releaseSession,sessionLocked;const sessionAcquired=new Promise(r=>sessionLocked=r),sessionGate=new Promise(r=>releaseSession=r);
  const sessionBlocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT token_hash FROM auth_sessions WHERE token_hash=${f.sessionFor(b).tokenHash} FOR UPDATE`;sessionLocked();await sessionGate;});await sessionAcquired;
  const agreement=repo.respond(b,p,next.proposalId,action(1));void agreement.catch(()=>{});let removeAfter;
  try{
   // The response now holds all required memberships and waits only on its session.
   await waitForLocks(f,'SELECT token_hash FROM auth_sessions',1);
   removeAfter=db.projectMembership.delete({where:{projectId_userId:{projectId:p,userId:a}}}).then(v=>v);void removeAfter.catch(()=>{});
   await waitForLocks(f,'DELETE FROM',1);
  }finally{releaseSession();await sessionBlocker;await Promise.allSettled([agreement,...(removeAfter?[removeAfter]:[])]);}
  await agreement;await removeAfter;
  assert.equal((await db.developmentContract.findUnique({where:{id:next.contractId}})).status,'ACTIVE');
  assert.equal(await db.contractNotification.count({where:{versionId:next.versionId,kind:'CONFIRMED'}}),2);
  assert.equal(await db.projectMembership.count({where:{projectId:p,userId:a}}),0);
 }finally{await f.close();}
});
