import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HandoffApiClient } from '../src/transport.js';
import { createServer } from '../src/index.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

test('MCP client sends one bearer credential and preserves the idempotency key', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ id: 'request-id', publicTitle: 'Milestone' }), {
      status: 201, headers: { 'content-type': 'application/json' }
    });
  };
  const client = new HandoffApiClient('https://handoff.example', 'private-token', fakeFetch);
  const result = await client.sendRequest({ projectId: 'project-id', recipientId: 'member-id',
    publicTitle: 'Milestone', privateBody: 'private terms', idempotencyKey: 'stable-key' });
  assert.deepEqual(result, { id: 'request-id', publicTitle: 'Milestone' });
  assert.equal(requests[0]?.url, 'https://handoff.example/api/mcp/requests');
  assert.equal(new Headers(requests[0]?.init.headers).get('authorization'), 'Bearer private-token');
  assert.equal(JSON.parse(String(requests[0]?.init.body)).idempotencyKey, 'stable-key');
});

test('MCP server advertises tools and validates arguments before sending', async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify([{ id: 'project-id' }]), { status: 200 });
  };
  const server = createServer(new HandoffApiClient('https://handoff.example', 'private-token', fakeFetch));
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['get_contract','get_my_contract_proposal','get_my_request','list_active_contracts','list_my_projects','propose_contract','resend_request','revise_contract_proposal','send_request']);
    const result = await client.callTool({ name: 'list_my_projects', arguments: {} });
    assert.equal(result.isError, undefined);
    assert.equal(calls.length, 1);
    const resent = await client.callTool({ name: 'resend_request', arguments: {
      requestId: '4dafdeba-9bb7-4581-900a-b3f60d1bf081', expectedVersion: 1,
      privateBody: 'new private version', idempotencyKey: 'retry-key'
    } });
    assert.equal(resent.isError, undefined);
    assert.equal(calls.at(-1), 'https://handoff.example/api/mcp/requests/4dafdeba-9bb7-4581-900a-b3f60d1bf081/versions');
    const invalid = await client.callTool({ name: 'send_request', arguments: { privateBody: 'secret' } });
    assert.equal(invalid.isError, true);
    assert.equal(calls.length, 2);
  } finally {
    await client.close();
    await server.close();
  }
});

test('contract MCP tools preserve exact version and retry keys without exposing a consent tool',async()=>{
 const calls:Array<{url:string;init:RequestInit}>=[];
 const server=createServer(new HandoffApiClient('https://handoff.example','private-token',async(url,init)=>{calls.push({url:String(url),init:init??{}});return new Response('{}');}));
 const client=new Client({name:'contract-test',version:'1'});const [ct,st]=InMemoryTransport.createLinkedPair();
 const id='4dafdeba-9bb7-4581-900a-b3f60d1bf081',other='b3258a04-d2e4-473c-8886-0946de9a8cce';
 try{
  await server.connect(st);await client.connect(ct);
  const names=(await client.listTools()).tools.map(t=>t.name);assert.ok(!names.some(n=>/agree|respond|consent/.test(n)));
  const input={projectId:id,recipientId:other,publicTitle:'title',proposedBody:'body',requiredPmIds:[],referencePmIds:[],idempotencyKey:'stable-contract-key'};
  assert.equal((await client.callTool({name:'propose_contract',arguments:input})).isError,undefined);
  assert.equal(calls.at(-1)?.url,'https://handoff.example/api/mcp/contracts');assert.deepEqual(JSON.parse(String(calls.at(-1)?.init.body)),input);
  const revision={proposalId:id,expectedVersion:1,proposedBody:'v2',requiredPmIds:[],referencePmIds:[],idempotencyKey:'revision-key'};
  assert.equal((await client.callTool({name:'revise_contract_proposal',arguments:revision})).isError,undefined);
  assert.equal(calls.at(-1)?.url,`https://handoff.example/api/mcp/contract-proposals/${id}/versions`);
  assert.equal(JSON.parse(String(calls.at(-1)?.init.body)).idempotencyKey,'revision-key');
  await client.callTool({name:'get_my_contract_proposal',arguments:{proposalId:id,version:2}});assert.equal(calls.at(-1)?.url,`https://handoff.example/api/mcp/contract-proposals/${id}?version=2`);
  await client.callTool({name:'list_active_contracts',arguments:{}});assert.equal(calls.at(-1)?.url,'https://handoff.example/api/mcp/contracts');
  await client.callTool({name:'get_contract',arguments:{contractId:id}});assert.equal(calls.at(-1)?.url,`https://handoff.example/api/mcp/contracts/${id}`);
  const count=calls.length;assert.equal((await client.callTool({name:'revise_contract_proposal',arguments:{...revision,expectedVersion:0}})).isError,true);assert.equal(calls.length,count);
 }finally{await client.close();await server.close();}
});

test('MCP client rejects insecure remote origins and redacts API failures', async () => {
  assert.throws(() => new HandoffApiClient('http://public.example', 'token'));
  const client = new HandoffApiClient('http://127.0.0.1:3000', 'private-token', async () =>
    new Response(JSON.stringify({ message: 'private terms private-token' }), { status: 403 }));
  await assert.rejects(client.sendRequest({ projectId: 'p', recipientId: 'r', publicTitle: 'x', privateBody: 'private terms', idempotencyKey: 'k' }),
    error => error instanceof Error && error.message === 'HandOff API request failed (403)');
});
