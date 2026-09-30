import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {fixture,action} from './contract-fixture.mjs';
import {ContractRepository} from '../dist/src/contracts/contract.repository.js';
import {EvidenceService} from '../dist/src/evidence/evidence.service.js';
import {decideReply} from '../dist/src/handoff/reply-decision.js';
const integration=process.env.NODE_ENV==='test'&&process.env.DATABASE_URL?test:test.skip;
const claim='USER_ID_FORMAT: uuid-v4';
async function confirm(repo,f,receipt){for(const id of [f.a,f.b,f.pm])await repo.respond(id,f.p,receipt.proposalId,action(receipt.version),f.sessionFor(id));}
integration('contract collection uses only related current confirmed versions in the same project',async()=>{
 const f=await fixture(),other=await fixture();const repo=new ContractRepository(f.db),evidence=new EvidenceService(f.db);
 try{
  const initial=await repo.propose(f.a,f.p,f.grant.id,{...f.input,proposedBody:claim});
  assert.deepEqual((await evidence.collect(f.b,f.p,new Date(),claim)).records,[]);
  await confirm(repo,f,initial);
  const before=await f.db.contractReadAudit.count();
  let result=await evidence.collect(f.b,f.p,new Date(),claim);
  assert.deepEqual(result.records.map(r=>[r.kind,r.sourceId,r.version]),[['HANDOFF_CONTRACT',initial.contractId,initial.versionId]]);
  assert.equal(await f.db.contractReadAudit.count(),before);assert.equal(await f.db.handoffResponse.count(),0);
  const unrelated=await repo.propose(f.a,f.p,f.grant.id,{...f.input,proposedBody:'OTHER: value',idempotencyKey:randomUUID()});await confirm(repo,f,unrelated);
  const foreignRepo=new ContractRepository(other.db);const foreign=await foreignRepo.propose(other.a,other.p,other.grant.id,{...other.input,proposedBody:claim});await confirm(foreignRepo,other,foreign);
  result=await evidence.collect(f.b,f.p,new Date(),claim);assert.equal(result.records.length,1);
  await f.db.contractProposalVersion.update({where:{id:initial.versionId},data:{confirmedAt:new Date(Date.now()-72*3600000)}});
  assert.equal((await evidence.collect(f.b,f.p,new Date(),claim)).records.length,1);
  const pending=await repo.proposeFollowup(f.a,f.p,initial.contractId,f.grant.id,{kind:'CHANGE',baselineVersionId:initial.versionId,proposedBody:'USER_ID_FORMAT: uuid-v7',requiredPmIds:[f.pm],referencePmIds:[],idempotencyKey:randomUUID()});
  assert.equal((await evidence.collect(f.b,f.p,new Date(),claim)).records[0].version,initial.versionId);
  await repo.withdraw(f.a,f.p,pending.proposalId,{expectedVersion:1,reason:'retry later',idempotencyKey:randomUUID()},f.sessionFor(f.a));
  assert.equal((await evidence.collect(f.b,f.p,new Date(),claim)).records[0].version,initial.versionId);
  const change=await repo.proposeFollowup(f.a,f.p,initial.contractId,f.grant.id,{kind:'CHANGE',baselineVersionId:initial.versionId,proposedBody:'USER_ID_FORMAT: uuid-v7',requiredPmIds:[f.pm],referencePmIds:[],idempotencyKey:randomUUID()});await confirm(repo,f,change);
  result=await evidence.collect(f.b,f.p,new Date(),claim);assert.equal(result.records[0].version,change.versionId);assert.equal(decideReply(claim,result.records,result.unavailable).kind,'REVIEW_REQUIRED');
  const retire=await repo.proposeFollowup(f.a,f.p,initial.contractId,f.grant.id,{kind:'RETIRE',baselineVersionId:change.versionId,proposedBody:'retirement',requiredPmIds:[f.pm],referencePmIds:[],idempotencyKey:randomUUID()});await confirm(repo,f,retire);
  assert.deepEqual((await evidence.collect(f.b,f.p,new Date(),claim)).records,[]);
  await f.db.projectMembership.delete({where:{projectId_userId:{projectId:f.p,userId:f.b}}});
  await assert.rejects(evidence.collect(f.b,f.p,new Date(),claim));
 }finally{await f.close();await other.close();}
});
integration('related contract conflicts, malformed lines, and stale registered files prevent automatic confirmation',async()=>{
 const f=await fixture(),repo=new ContractRepository(f.db),evidence=new EvidenceService(f.db);
 const oldKey=process.env.HANDOFF_EVIDENCE_KEY;process.env.HANDOFF_EVIDENCE_KEY='e'.repeat(64);
 try{
  const exact=await repo.propose(f.a,f.p,f.grant.id,{...f.input,proposedBody:claim});await confirm(repo,f,exact);
  let result=await evidence.collect(f.b,f.p,new Date(),claim);assert.equal(decideReply(claim,result.records,result.unavailable).kind,'AUTO_REPLY');
  const conflict=await repo.propose(f.a,f.p,f.grant.id,{...f.input,proposedBody:'USER_ID_FORMAT: uuid-v7',idempotencyKey:randomUUID()});await confirm(repo,f,conflict);
  result=await evidence.collect(f.b,f.p,new Date(),claim);assert.equal(result.records.length,2);assert.equal(decideReply(claim,result.records,result.unavailable).kind,'REVIEW_REQUIRED');
  const retire=await repo.proposeFollowup(f.a,f.p,conflict.contractId,f.grant.id,{kind:'RETIRE',baselineVersionId:conflict.versionId,proposedBody:'retire conflict',requiredPmIds:[f.pm],referencePmIds:[],idempotencyKey:randomUUID()});await confirm(repo,f,retire);
  const malformed=await repo.propose(f.a,f.p,f.grant.id,{...f.input,proposedBody:claim+'\nUSER_ID_FORMAT： uuid-v7',idempotencyKey:randomUUID()});await confirm(repo,f,malformed);
  result=await evidence.collect(f.b,f.p,new Date(),claim);assert.equal(decideReply(claim,result.records,result.unavailable).kind,'REVIEW_REQUIRED');
  const retireBad=await repo.proposeFollowup(f.a,f.p,malformed.contractId,f.grant.id,{kind:'RETIRE',baselineVersionId:malformed.versionId,proposedBody:'retire ambiguous',requiredPmIds:[f.pm],referencePmIds:[],idempotencyKey:randomUUID()});await confirm(repo,f,retireBad);
  const local=await evidence.registerLocal(f.b,f.p,'C:/contracts/format.md');await evidence.syncLocal(local.id,local.syncToken,'C:/contracts/format.md',claim,createHash('sha256').update(claim).digest('hex'));
  await f.db.evidenceSnapshot.update({where:{sourceId:local.id},data:{syncedAt:new Date(Date.now()-25*3600000)}});
  result=await evidence.collect(f.b,f.p,new Date(),claim);assert.equal(decideReply(claim,result.records,result.unavailable).kind,'REVIEW_REQUIRED');
 }finally{await f.close();if(oldKey===undefined)delete process.env.HANDOFF_EVIDENCE_KEY;else process.env.HANDOFF_EVIDENCE_KEY=oldKey;}
});
test('invalid current versions fail closed rather than falling back to historical confirmed bodies',async()=>{
 const {collectContractEvidence}=await import('../dist/src/evidence/contract-evidence.js');
 for(const currentVersion of [null,{id:'v',contractId:'other',status:'CONFIRMED',proposedBody:claim,proposal:{kind:'INITIAL'}},{id:'v',contractId:'c',status:'IN_REVIEW',proposedBody:claim,proposal:{kind:'INITIAL'}}]){
  const db={developmentContract:{findMany:async()=>[{id:'c',currentVersionId:'v',currentVersion}]}};
  const result=await collectContractEvidence(db,'p',claim,new Date());assert.equal(result.records.length,0);assert.deepEqual(result.unavailable,['CONTRACT_UNAVAILABLE']);
 }
});
