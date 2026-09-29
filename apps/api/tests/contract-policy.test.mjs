import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
test('contract input rejects invalid roles and bounds and canonicalizes participant order',async()=>{
 const policy=await import('../dist/src/contracts/contract-policy.js').catch(()=>({}));
 assert.equal(typeof policy.normalizeProposal,'function');
 const [a,b,c,d]=Array.from({length:4},()=>randomUUID());
 const input={recipientId:b,publicTitle:' title ',proposedBody:' body ',requiredPmIds:[d,c],referencePmIds:[],idempotencyKey:'key'};
 assert.deepEqual(policy.normalizeProposal(a,input),policy.normalizeProposal(a,{...input,requiredPmIds:[c,d]}));
 for(const patch of [{recipientId:a},{publicTitle:' '},{proposedBody:'x'.repeat(50001)},{requiredPmIds:[c,c]},{referencePmIds:[c]},{requiredPmIds:Array.from({length:11},randomUUID)},{recipientId:'invalid'}])
  assert.throws(()=>policy.normalizeProposal(a,{...input,...patch}),e=>e.getStatus()===400);
 for(const version of [0,1.5,-1,NaN]) assert.throws(()=>policy.normalizeResponse({version,action:'AGREE',idempotencyKey:'k'}));
 assert.throws(()=>policy.normalizeResponse({version:1,action:'REQUEST_CHANGES',comment:' ',idempotencyKey:'k'}));
 assert.throws(()=>policy.normalizeResponse({version:1,action:'AGREE',comment:'secret',idempotencyKey:'k'}));
 assert.equal(policy.normalizeResponse({version:1,action:'AGREE',idempotencyKey:'k'}).action,'AGREE');
});
