import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,action,status} from './contract-fixture.mjs';
const integration=process.env.NODE_ENV==='test'&&process.env.DATABASE_URL?test:test.skip;
integration('contract human unanimity, immutable revision, atomic retries and membership gates',async()=>{
 const mod=await import('../dist/src/contracts/contract.repository.js').catch(()=>({}));
 assert.equal(typeof mod.ContractRepository,'function');
 const f=await fixture();const {db,a,b,pm,ref,c,p,grant,input}=f;const repo=new mod.ContractRepository(db);
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
integration('last agreement and revision serialize on the contract; a concurrent change cannot coexist with confirmation',async()=>{
 const {ContractRepository}=await import('../dist/src/contracts/contract.repository.js');const f=await fixture();
 const {db,a,b,p,grant,input}=f, repo=new ContractRepository(db);
 try{
  for(const kind of ['revision','changes']){
   const r=await repo.propose(a,p,grant.id,{...input,requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()});
   await repo.respond(a,p,r.proposalId,action(1));
   let release,locked;const acquired=new Promise(r=>locked=r), gate=new Promise(r=>release=r);
   const blocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM development_contracts WHERE id=${r.contractId}::uuid FOR UPDATE`;locked();await gate;});
   await acquired;
   const results=Promise.allSettled([repo.respond(b,p,r.proposalId,action(1)),kind==='revision'?repo.revise(a,p,r.proposalId,grant.id,{expectedVersion:1,proposedBody:'new',requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()}):repo.respond(b,p,r.proposalId,action(1,'REQUEST_CHANGES'))]);
   release();await blocker;const outcomes=await results;
   assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
   assert.equal(outcomes.filter(x=>x.status==='rejected'&&status(409)(x.reason)).length,1);
   const contract=await db.developmentContract.findUnique({where:{id:r.contractId}});
   const confirmed=outcomes[0].status==='fulfilled';assert.equal(contract.status,confirmed?'ACTIVE':'UNCONFIRMED');
   assert.equal(await db.contractNotification.count({where:{versionId:r.versionId,kind:'CONFIRMED'}}),confirmed?2:0);
  }
  const r=await repo.propose(a,p,grant.id,{...input,requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()});await repo.respond(a,p,r.proposalId,action(1));
  let release,locked;const acquired=new Promise(r=>locked=r),gate=new Promise(r=>release=r);
  const removal=db.$transaction(async tx=>{await tx.projectMembership.delete({where:{projectId_userId:{projectId:p,userId:a}}});locked();await gate;});await acquired;
  const pending=repo.respond(b,p,r.proposalId,action(1));release();await removal;await assert.rejects(pending,status(409));
  assert.equal((await db.developmentContract.findUnique({where:{id:r.contractId}})).status,'UNCONFIRMED');
 }finally{await f.close();}
});
