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
