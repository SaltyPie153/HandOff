import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,action} from './contract-fixture.mjs';
import {ContractRepository} from '../dist/src/contracts/contract.repository.js';
import {HandoffRepository} from '../dist/src/handoff/handoff.repository.js';
import {HandoffBackgroundWorker} from '../dist/src/handoff/background-worker.js';
import {EvidenceService} from '../dist/src/evidence/evidence.service.js';
import {AgentKeyStore} from '../dist/src/admin/agent-key.store.js';
export const claim='USER_ID_FORMAT: uuid-v4';
export function barrier(){let release;const promise=new Promise(r=>release=r);return {promise,release};}
export async function workerFixture(){
 const f=await fixture(),root=await mkdtemp(join(tmpdir(),'handoff-contract-evidence-'));
 const store=new AgentKeyStore({nodeEnv:'test',secretDir:join(root,'protected')});await store.save('upstage-fake-contract-key');
 const repo=new ContractRepository(f.db),handoffs=new HandoffRepository(f.db),evidence=new EvidenceService(f.db);
 let callback=async()=>true;
 const worker=new HandoffBackgroundWorker(f.db,evidence,{confirmExplicitClaim:async(...args)=>callback(...args)},store);
 async function approve(receipt){for(const id of [f.a,f.b,f.pm])await repo.respond(id,f.p,receipt.proposalId,action(receipt.version),f.sessionFor(id));}
 async function contract(body=claim){const r=await repo.propose(f.a,f.p,f.grant.id,{...f.input,proposedBody:body,idempotencyKey:randomUUID()});await approve(r);return r;}
 async function followup(base,kind='CHANGE',body='USER_ID_FORMAT: uuid-v7'){return repo.proposeFollowup(f.a,f.p,base.contractId,f.grant.id,{kind,baselineVersionId:base.versionId,proposedBody:body,requiredPmIds:[f.pm],referencePmIds:[],idempotencyKey:randomUUID()});}
 async function request(verificationClaim=claim){return handoffs.createRequest(f.a,f.p,{recipientId:f.b,grantId:f.grant.id,publicTitle:'Contract evidence test',privateBody:'private secret text',verificationClaim,idempotencyKey:randomUUID()});}
 const job=r=>f.db.handoffJob.findFirstOrThrow({where:{requestId:r.id}});
 const replies=r=>f.db.handoffReply.count({where:{requestId:r.id}});
 return {...f,repo,handoffs,evidence,store,worker,approve,contract,followup,request,job,replies,onConfirm(fn){callback=fn;},async close(){await f.close();if(!root.startsWith(join(tmpdir(),'handoff-contract-evidence-')))throw new Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});}};
}
