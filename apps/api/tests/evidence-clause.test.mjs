import assert from 'node:assert/strict';
import {test} from 'node:test';
test('parses exact claims, detects malformed same-key lines, and excludes different keys',async()=>{
 const {parseClaim,extractClaimLines}=await import('../dist/src/evidence/evidence-clause.js');
 assert.deepEqual(parseClaim('USER_ID_FORMAT: uuid-v4'),{key:'USER_ID_FORMAT',value:'uuid-v4'});
 for(const input of [null,'natural prose','A: value','USER_ID_FORMAT: '+'x'.repeat(401)])assert.equal(parseClaim(input),null);
 assert.deepEqual(extractClaimLines('  USER_ID_FORMAT: uuid-v4\r\nOTHER: private\r\nUSER_ID_FORMAT_EXTRA: other','USER_ID_FORMAT'),{values:['uuid-v4'],lines:['USER_ID_FORMAT: uuid-v4'],malformed:false});
 for(const line of ['USER_ID_FORMAT:uuid-v4','USER_ID_FORMAT： uuid-v4','USER_ID_FORMAT = uuid-v4','USER_ID_FORMAT'])assert.equal(extractClaimLines(line,'USER_ID_FORMAT').malformed,true);
 assert.deepEqual(extractClaimLines('USER_ID_FORMAT: uuid-v4\nUSER_ID_FORMAT: uuid-v7','USER_ID_FORMAT').values,['uuid-v4','uuid-v7']);
});
test('ambiguous same-key lines never auto-confirm even beside a matching line',async()=>{
 const {decideReply}=await import('../dist/src/handoff/reply-decision.js');
 const source={kind:'LOCAL',sourceId:'s',version:'v',observedAt:new Date(),content:'USER_ID_FORMAT: uuid-v4\nUSER_ID_FORMAT： uuid-v7'};
 assert.equal(decideReply('USER_ID_FORMAT: uuid-v4',[source],[]).kind,'REVIEW_REQUIRED');
});
