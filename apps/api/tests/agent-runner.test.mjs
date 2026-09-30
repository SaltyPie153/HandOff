import assert from 'node:assert/strict';
import { test } from 'node:test';

const { ManagedAgentRunner } = await import('../dist/src/handoff/agent-runner.js');

test('verifies an explicit claim through Upstage Solar Pro 4', async () => {
  const previous = globalThis.fetch;
  let url;
  let authorization;
  let request;
  globalThis.fetch = async (input, init) => {
    url = String(input);
    authorization = new Headers(init?.headers).get('authorization');
    request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'CONFIRMED' } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const runner = new ManagedAgentRunner();
    const result = await runner.confirmExplicitClaim('API_SCOPE: read-only', [
      { content: 'API_SCOPE: read-only\nOTHER: private' }
    ], 'upstage-fake-key');
    assert.equal(result, true);
    assert.equal(url, 'https://api.upstage.ai/v1/chat/completions');
    assert.equal(authorization, 'Bearer upstage-fake-key');
    assert.equal(request.model, 'solar-pro4');
    assert.equal(JSON.stringify(request).includes('OTHER: private'), false);
  } finally { globalThis.fetch = previous; }
});

test('does not confirm an ambiguous Solar response', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: 'REVIEW' } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    assert.equal(await new ManagedAgentRunner().confirmExplicitClaim('API_SCOPE: read-only', [
      { content: 'API_SCOPE: read-only' }
    ], 'upstage-fake-key'), false);
  } finally { globalThis.fetch = previous; }
});

test('normalizes evidence indentation consistently and rejects malformed related lines before calling Solar',async()=>{
 const previous=globalThis.fetch;let request;let calls=0;
 globalThis.fetch=async(input,init)=>{calls++;request=JSON.parse(String(init?.body));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'CONFIRMED'}}]}),{status:200,headers:{'Content-Type':'application/json'}});};
 try{
  const runner=new ManagedAgentRunner();
  assert.equal(await runner.confirmExplicitClaim('USER_ID_FORMAT: uuid-v4',[{content:'  USER_ID_FORMAT: uuid-v4\r\nOTHER: private'}],'upstage-fake-key'),true);
  assert.deepEqual(JSON.parse(request.messages[1].content).evidenceLines,[['USER_ID_FORMAT: uuid-v4']]);
  assert.equal(await runner.confirmExplicitClaim('USER_ID_FORMAT: uuid-v4',[{content:'USER_ID_FORMAT: uuid-v4\nUSER_ID_FORMAT： uuid-v7'}],'upstage-fake-key'),false);
  assert.equal(calls,1);
 }finally{globalThis.fetch=previous;}
});
