import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {fixture,action,status} from './contract-fixture.mjs';
import {ContractRepository} from '../dist/src/contracts/contract.repository.js';
const integration=process.env.NODE_ENV==='test'&&process.env.DATABASE_URL?test:test.skip;
export const follow=(kind,baselineVersionId,extra={})=>({kind,baselineVersionId,proposedBody:kind==='RETIRE'?'No longer needed':'replacement',requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID(),...extra});
export async function confirmed(f,repo){const r=await repo.propose(f.a,f.p,f.grant.id,{...f.input,requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()});await consent(f,repo,r);return r;}
export async function consent(f,repo,r){for(const id of [f.a,f.b])await repo.respond(id,f.p,r.proposalId,action(r.version),f.sessionFor(id));}
integration('change preserves current contract and withdrawal is sender-only, immutable and retry safe',async()=>{
 const f=await fixture(),repo=new ContractRepository(f.db);try{
  assert.equal(typeof repo.proposeFollowup,'function');const r=await confirmed(f,repo),input=follow('CHANGE',r.versionId);
  await assert.rejects(repo.proposeFollowup(f.b,f.p,r.contractId,f.grant.id,input),status(404));
  await assert.rejects(repo.proposeFollowup(f.a,f.p,r.contractId,f.grant.id,{...input,baselineVersionId:randomUUID()}),status(409));
  const change=await repo.proposeFollowup(f.a,f.p,r.contractId,f.grant.id,input);
  assert.deepEqual(await repo.proposeFollowup(f.a,f.p,r.contractId,f.grant.id,input),change);
  await assert.rejects(repo.proposeFollowup(f.a,f.p,r.contractId,f.grant.id,follow('RETIRE',r.versionId)),status(409));
  await repo.respond(f.b,f.p,change.proposalId,action(1,'REQUEST_CHANGES'),f.sessionFor(f.b));
  const revision=await repo.revise(f.a,f.p,change.proposalId,f.grant.id,{expectedVersion:1,proposedBody:'improved',requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()});
  assert.equal((await f.db.developmentContract.findUnique({where:{id:r.contractId}})).currentVersionId,r.versionId);
  const w={expectedVersion:2,reason:'reconsider',idempotencyKey:randomUUID()};
  await assert.rejects(repo.withdraw(f.b,f.p,change.proposalId,w,f.sessionFor(f.b)),status(404));
  await assert.rejects(repo.withdraw(f.a,f.p,change.proposalId,w,undefined),status(401));
  await assert.rejects(repo.withdraw(f.a,f.p,r.proposalId,{...w,expectedVersion:1},f.sessionFor(f.a)),status(409));
  const receipt=await repo.withdraw(f.a,f.p,change.proposalId,w,f.sessionFor(f.a));assert.equal(receipt.status,'WITHDRAWN');
  assert.deepEqual(await repo.withdraw(f.a,f.p,change.proposalId,w,f.sessionFor(f.a)),receipt);
  await assert.rejects(repo.withdraw(f.a,f.p,change.proposalId,{...w,reason:'different'},f.sessionFor(f.a)),status(409));
  await assert.rejects(repo.respond(f.b,f.p,change.proposalId,action(2),f.sessionFor(f.b)),status(409));
  await assert.rejects(repo.revise(f.a,f.p,change.proposalId,f.grant.id,{expectedVersion:2,proposedBody:'new',requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()}),status(409));
  assert.equal(await f.db.contractNotification.count({where:{versionId:revision.versionId,kind:'WITHDRAWN'}}),2);
  const next=await repo.proposeFollowup(f.a,f.p,r.contractId,f.grant.id,follow('CHANGE',r.versionId,{previousProposalId:change.proposalId}));
  assert.equal(await f.db.contractResponse.count({where:{proposalId:next.proposalId}}),0);await consent(f,repo,next);
  assert.equal((await f.db.developmentContract.findUnique({where:{id:r.contractId}})).currentVersionId,next.versionId);
  assert.equal((await f.db.contractProposalVersion.findUnique({where:{id:r.versionId}})).proposedBody,f.input.proposedBody);
 }finally{await f.close();}
});
integration('retirement preserves last confirmed body and initial withdrawal can continue same contract',async()=>{
 const f=await fixture(),repo=new ContractRepository(f.db);try{
  assert.equal(typeof repo.withdraw,'function');const initial=await repo.propose(f.a,f.p,f.grant.id,{...f.input,requiredPmIds:[],referencePmIds:[]});
  await repo.withdraw(f.a,f.p,initial.proposalId,{expectedVersion:1,reason:'restart',idempotencyKey:randomUUID()},f.sessionFor(f.a));
  const r=await repo.proposeFollowup(f.a,f.p,initial.contractId,f.grant.id,follow('INITIAL',undefined,{previousProposalId:initial.proposalId}));await consent(f,repo,r);
  const retire=await repo.proposeFollowup(f.a,f.p,r.contractId,f.grant.id,follow('RETIRE',r.versionId));
  assert.equal((await f.db.developmentContract.findUnique({where:{id:r.contractId}})).status,'ACTIVE');await consent(f,repo,retire);
  const c=await f.db.developmentContract.findUnique({where:{id:r.contractId}});assert.equal(c.status,'RETIRED');assert.equal(c.currentVersionId,null);assert.equal(c.lastConfirmedVersionId,r.versionId);assert.equal(c.retirementVersionId,retire.versionId);assert.ok(c.retiredAt);
  await assert.rejects(repo.proposeFollowup(f.a,f.p,r.contractId,f.grant.id,follow('CHANGE',r.versionId)),status(409));
  const linked=await repo.propose(f.a,f.p,f.grant.id,{...f.input,previousContractId:r.contractId,idempotencyKey:randomUUID()});assert.equal((await f.db.developmentContract.findUnique({where:{id:linked.contractId}})).previousContractId,r.contractId);
  await assert.rejects(repo.propose(f.a,f.p,f.grant.id,{...f.input,previousContractId:linked.contractId,idempotencyKey:randomUUID()}),status(404));
 }finally{await f.close();}
});
async function waiting(f,fragment){for(let i=0;i<100;i++){const r=await f.db.$queryRaw`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=${f.applicationName} AND wait_event_type='Lock' AND position(${fragment} in query)>0`;if(r[0].n>=1)return;await setTimeout(10);}assert.fail('Expected database lock wait for '+fragment);}
integration('withdrawal versus consent or revision and competing proposals serialize in both orders',async()=>{
 const f=await fixture(),repo=new ContractRepository(f.db);try{
  assert.equal(typeof repo.withdraw,'function');
  for(const kind of ['consent','revision','proposal'])for(const first of [0,1]){
   const r=kind==='proposal'?await confirmed(f,repo):await repo.propose(f.a,f.p,f.grant.id,{...f.input,requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()});
   if(kind==='consent')await repo.respond(f.a,f.p,r.proposalId,action(1),f.sessionFor(f.a));
   const w=()=>repo.withdraw(f.a,f.p,r.proposalId,{expectedVersion:1,reason:'cancel',idempotencyKey:randomUUID()},f.sessionFor(f.a));
   const commands=kind==='proposal'?[()=>repo.proposeFollowup(f.a,f.p,r.contractId,f.grant.id,follow('CHANGE',r.versionId)),()=>repo.proposeFollowup(f.a,f.p,r.contractId,f.grant.id,follow('RETIRE',r.versionId))]:[w,kind==='consent'?()=>repo.respond(f.b,f.p,r.proposalId,action(1),f.sessionFor(f.b)):()=>repo.revise(f.a,f.p,r.proposalId,f.grant.id,{expectedVersion:1,proposedBody:'new',requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()})];
   let release,ready;const gate=new Promise(r=>release=r),acquired=new Promise(r=>ready=r),pending=[];
   const blocker=f.db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM development_contracts WHERE id=${r.contractId}::uuid FOR UPDATE`;ready();await gate;});await acquired;
   try{pending.push(commands[first]());void pending[0].catch(()=>{});await waiting(f,'FOR UPDATE');pending.push(commands[1-first]());void pending[1].catch(()=>{});await waiting(f,'pg_advisory_xact_lock');}finally{release();await blocker;await Promise.allSettled(pending);}
   const result=await Promise.allSettled(pending);assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');assert.ok(status(409)(result[1].reason));
   const q=await f.db.contractProposal.findUnique({where:{id:r.proposalId}});if(kind!=='proposal')assert.equal(q.lifecycle,first===0?'WITHDRAWN':kind==='consent'?'CONFIRMED':'OPEN');
   assert.equal(await f.db.contractProposal.count({where:{contractId:r.contractId,lifecycle:'OPEN'}}),kind==='proposal'||kind==='revision'&&first===1?1:0);
  }
 }finally{await f.close();}
});
