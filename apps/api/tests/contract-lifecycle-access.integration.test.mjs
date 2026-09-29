import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,action,status} from './contract-fixture.mjs';
import {ContractRepository} from '../dist/src/contracts/contract.repository.js';
import {ContractQueryRepository} from '../dist/src/contracts/contract-query.repository.js';
const integration=process.env.NODE_ENV==='test'&&process.env.DATABASE_URL?test:test.skip;
integration('public history excludes private proposals and retirement never returns an active body',async()=>{
 const f=await fixture(),repo=new ContractRepository(f.db),query=new ContractQueryRepository(f.db);
 const send=(kind,baseline,extra={})=>({kind,baselineVersionId:baseline,proposedBody:kind==='RETIRE'?'Retirement resolution':'New confirmed body',requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID(),...extra});
 async function agree(r){for(const id of [f.a,f.b])await repo.respond(id,f.p,r.proposalId,action(r.version),f.sessionFor(id));}
 try{
  const initial=await repo.propose(f.a,f.p,f.grant.id,{...f.input,requiredPmIds:[],referencePmIds:[f.ref]});await agree(initial);
  const changed=await repo.proposeFollowup(f.a,f.p,initial.contractId,f.grant.id,send('CHANGE',initial.versionId,{referencePmIds:[f.pm]}));
  assert.equal((await query.summary(f.b,f.p)).needsReview,1);
  await assert.rejects(query.getProposal(f.pm,f.p,initial.proposalId),status(404));await assert.rejects(query.getProposal(f.ref,f.p,changed.proposalId),status(404));
  assert.equal((await query.getProposal(f.a,f.p,changed.proposalId)).canWithdraw,true);
  const before=await query.getPublic(f.c,f.p,initial.contractId);assert.equal(before.body,f.input.proposedBody);assert.equal(before.history.length,1);
  await repo.respond(f.b,f.p,changed.proposalId,action(1),f.sessionFor(f.b));assert.equal((await query.summary(f.b,f.p)).needsReview,0);await repo.respond(f.a,f.p,changed.proposalId,action(1),f.sessionFor(f.a));
  const privateProposal=await repo.proposeFollowup(f.a,f.p,initial.contractId,f.grant.id,send('CHANGE',changed.versionId,{proposedBody:'PRIVATE_WITHDRAWN_BODY'}));
  await repo.withdraw(f.a,f.p,privateProposal.proposalId,{expectedVersion:1,reason:'PRIVATE_WITHDRAW_REASON',idempotencyKey:randomUUID()},f.sessionFor(f.a));
  assert.equal((await query.summary(f.b,f.p)).needsReview,0);assert.equal((await query.getProposal(f.a,f.p,privateProposal.proposalId)).withdrawal.reason,'PRIVATE_WITHDRAW_REASON');
  const retire=await repo.proposeFollowup(f.a,f.p,initial.contractId,f.grant.id,send('RETIRE',changed.versionId));await agree(retire);
  const detail=await query.getPublic(f.c,f.p,initial.contractId);assert.equal(detail.status,'RETIRED');assert.equal(detail.body,null);assert.equal(detail.version,null);assert.equal(detail.history.length,2);assert.equal(detail.lastConfirmed.body,'New confirmed body');assert.equal(detail.retirement.reason,'Retirement resolution');
  const json=JSON.stringify(detail);for(const forbidden of ['PRIVATE_WITHDRAWN_BODY','PRIVATE_WITHDRAW_REASON','participants','responses','withdrawal'])assert.equal(json.includes(forbidden),false);
  assert.equal((await query.listPublic(f.c,f.p,true)).length,0);
  const auditBefore=await f.db.contractReadAudit.count();await query.listPublic(f.c,f.p);assert.equal(await f.db.contractReadAudit.count(),auditBefore);
  const audits=await f.db.contractReadAudit.findMany({where:{userId:f.c}});assert.ok([initial.versionId,changed.versionId,retire.versionId].every(id=>audits.some(a=>a.versionId===id)));
  await f.db.projectMembership.delete({where:{projectId_userId:{projectId:f.p,userId:f.c}}});await assert.rejects(query.getPublic(f.c,f.p,initial.contractId),status(404));
 }finally{await f.close();}
});
