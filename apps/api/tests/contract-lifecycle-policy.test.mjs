import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as policy from '../dist/src/contracts/contract-policy.js';
test('lifecycle inputs reject invalid kind, baseline, reasons and versions',()=>{
 assert.equal(typeof policy.normalizeFollowup,'function');
 const id=randomUUID(),input={kind:'CHANGE',baselineVersionId:id,proposedBody:'new',requiredPmIds:[],referencePmIds:[],idempotencyKey:'key'};
 assert.deepEqual(policy.normalizeFollowup(input),input);
 for(const patch of [{kind:'OTHER'},{baselineVersionId:undefined},{baselineVersionId:'bad'},{kind:'INITIAL',previousProposalId:id},{proposedBody:' '},{proposedBody:'x'.repeat(50001)}])assert.throws(()=>policy.normalizeFollowup({...input,...patch}),e=>e.getStatus()===400);
 assert.equal(policy.normalizeFollowup({...input,kind:'INITIAL',baselineVersionId:undefined,previousProposalId:id}).kind,'INITIAL');
 for(const patch of [{reason:''},{reason:'x'.repeat(10001)},{expectedVersion:0},{expectedVersion:1.5}])assert.throws(()=>policy.normalizeWithdrawal({expectedVersion:1,reason:'cancel',idempotencyKey:'key',...patch}),e=>e.getStatus()===400);
 assert.deepEqual(policy.normalizeWithdrawal({expectedVersion:1,reason:' cancel ',idempotencyKey:'key'}),{expectedVersion:1,reason:'cancel',idempotencyKey:'key'});
 const pm=[randomUUID(),randomUUID()];assert.deepEqual(policy.normalizeFollowup({...input,requiredPmIds:pm}),policy.normalizeFollowup({...input,requiredPmIds:[...pm].reverse()}));
});
