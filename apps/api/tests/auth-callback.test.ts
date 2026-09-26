import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthController } from '../src/auth/auth.controller.js';
import type { AuthService } from '../src/auth/auth.service.js';

test('link conflict keeps HTTP 409 and gives a safe return path', async () => {
  const service = {
    requireAction: async () => ({ userId: 'member' }),
    sessionToken: () => 'a'.repeat(43),
    finish: async () => ({ kind: 'CONFLICT' })
  } as unknown as AuthService;
  const response = {
    statusCode: 200,
    body: '',
    setHeader() { return this; },
    status(code: number) { this.statusCode = code; return this; },
    send(body: string) { this.body = body; return this; },
    redirect() { throw new Error('Conflict must not redirect silently'); }
  };
  await new AuthController(service).finishLink('discord', 'state', 'code', { headers: {} }, response as never);
  assert.equal(response.statusCode, 409);
  assert.match(response.body, /이미 다른 회원/);
  assert.match(response.body, /\/settings/);
  assert.doesNotMatch(response.body, /member|state|code/);
});

test('provider cancellation consumes its state and returns to login with a distinct message', async () => {
  let finished = false;
  const service = {
    browserToken: () => 'a'.repeat(43),
    sessionToken: () => null,
    finish: async () => { finished = true; throw new Error('Provider cancelled'); }
  } as unknown as AuthService;
  const response = {
    destination: '',
    setHeader() { return this; },
    clearCookie() { return this; },
    redirect(url: string) { this.destination = url; }
  };
  await new AuthController(service).finishLogin('google', 'b'.repeat(43), '', { headers: {} }, response as never);
  assert.equal(finished, true);
  assert.equal(response.destination, '/login?error=cancelled');
});
