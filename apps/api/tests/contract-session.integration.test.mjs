import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {setTimeout} from 'node:timers/promises';
import {ContractRepository} from '../dist/src/contracts/contract.repository.js';
import {ContractController} from '../dist/src/contracts/contract.controller.js';
import {fixture,action,status} from './contract-fixture.mjs';
const integration=process.env.NODE_ENV==='test'&&process.env.DATABASE_URL?test:test.skip;
for(const reason of ['revoked','expired'])integration(`human consent rechecks ${reason} session after the contract lock wait`,async()=>{
 const f=await fixture();const {db,a,b,p,grant,input}=f,repo=new ContractRepository(db);
 try{
   const r=await repo.propose(a,p,grant.id,{...input,requiredPmIds:[],referencePmIds:[],idempotencyKey:randomUUID()});
   await repo.respond(a,p,r.proposalId,action(1),f.sessionFor(a));
   const session=await db.authSession.create({data:{userId:b,tokenHash:randomUUID().replaceAll('-','').repeat(2),csrfHash:'b'.repeat(64),expiresAt:new Date(Date.now()+600000)}});
   // Simulate the controller's already authenticated session snapshot, then wait
   // on the real contract row before revoking/expiring the live DB session.
   const controller=new ContractController({requireSession:async()=>session,requireCsrf:()=>{}},repo,{});
   let release,locked;const acquired=new Promise(r=>locked=r),gate=new Promise(r=>release=r);
   const blocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM development_contracts WHERE id=${r.contractId}::uuid FOR UPDATE`;locked();await gate;});await acquired;
   const pending=controller.respond({headers:{}},p,r.proposalId,action(1));void pending.catch(()=>{});
   try{
    let waiting=false;
    for(let i=0;i<100;i++){
     const rows=await db.$queryRaw`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=${f.applicationName} AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE OF c%'`;
     if(rows[0].n>0){waiting=true;break;}await setTimeout(10);
    }
    assert.equal(waiting,true,'response reached the contract row lock');
    if(reason==='revoked')await db.authSession.delete({where:{tokenHash:session.tokenHash}});
    else await db.authSession.update({where:{tokenHash:session.tokenHash},data:{expiresAt:new Date(Date.now()-1000)}});
   }finally{release();await blocker;}
   await assert.rejects(pending,status(401));
   assert.equal(await db.contractResponse.count({where:{versionId:r.versionId,actorId:b}}),0);
   assert.equal((await db.developmentContract.findUnique({where:{id:r.contractId}})).status,'UNCONFIRMED');
   assert.equal(await db.contractNotification.count({where:{versionId:r.versionId,kind:'CONFIRMED'}}),0);
 }finally{await f.close();}
});
