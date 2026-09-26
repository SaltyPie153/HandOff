import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { startOAuthAttempt, consumeOAuthAttempt } from '../src/auth/oauth-attempt.ts';

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async create(attempt) {
      assert.equal(rows.has(attempt.stateHash), false);
      rows.set(attempt.stateHash, attempt);
    },
    async consume(stateHash) {
      const attempt = rows.get(stateHash) ?? null;
      rows.delete(stateHash);
      return attempt;
    },
  };
}

const now = 1_800_000_000_000;

test('Google login uses an opaque state and exposes nonce and S256 challenge', async () => {
  const store = memoryStore();
  const started = await startOAuthAttempt(store, {
    provider: 'GOOGLE',
    intent: 'LOGIN',
    browserSessionId: 'browser-a',
  }, now);
  assert.match(started.state, /^[A-Za-z0-9_-]{43}$/);
  assert.match(started.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.match(started.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(store.rows.size, 1);
  const [saved] = store.rows.values();
  assert.notEqual(saved.stateHash, started.state);
  assert.equal(saved.stateHash, createHash('sha256').update(started.state).digest('hex'));
  assert.equal(saved.browserSessionId, 'browser-a');
  assert.equal(saved.codeVerifier.length, 43);

  const result = await consumeOAuthAttempt(store, {
    state: started.state,
    provider: 'GOOGLE',
    intent: 'LOGIN',
    browserSessionId: 'browser-a',
  }, now + 1000);
  assert.equal(result.kind, 'OK');
  assert.equal(result.attempt.nonce, started.nonce);
  assert.equal(store.rows.size, 0);
  assert.deepEqual(await consumeOAuthAttempt(store, {
    state: started.state,
    provider: 'GOOGLE',
    intent: 'LOGIN',
    browserSessionId: 'browser-a',
  }, now + 2000), { kind: 'INVALID' });
});

test('Discord login has state protection without assuming PKCE support', async () => {
  const store = memoryStore();
  const started = await startOAuthAttempt(store, {
    provider: 'DISCORD',
    intent: 'LOGIN',
    browserSessionId: 'browser-a',
  }, now);
  assert.equal(started.nonce, undefined);
  assert.equal(started.codeChallenge, undefined);
  assert.equal((await consumeOAuthAttempt(store, {
    state: started.state,
    provider: 'DISCORD',
    intent: 'LOGIN',
    browserSessionId: 'browser-a',
  }, now + 1000)).kind, 'OK');
});

test('wrong browser session or provider consumes the attempt without logging in', async () => {
  for (const override of [{ browserSessionId: 'browser-b' }, { provider: 'DISCORD' }]) {
    const store = memoryStore();
    const started = await startOAuthAttempt(store, {
      provider: 'GOOGLE', intent: 'LOGIN', browserSessionId: 'browser-a',
    }, now);
    const callback = {
      state: started.state, provider: 'GOOGLE', intent: 'LOGIN',
      browserSessionId: 'browser-a', ...override,
    };
    assert.deepEqual(await consumeOAuthAttempt(store, callback, now + 1000), { kind: 'INVALID' });
    assert.equal(store.rows.size, 0);
  }
});

test('expired and malformed state cannot authorize a callback', async () => {
  const store = memoryStore();
  const started = await startOAuthAttempt(store, {
    provider: 'GOOGLE', intent: 'LOGIN', browserSessionId: 'browser-a',
  }, now);
  assert.deepEqual(await consumeOAuthAttempt(store, {
    state: 'not-a-state', provider: 'GOOGLE', intent: 'LOGIN',
    browserSessionId: 'browser-a',
  }, now + 1000), { kind: 'INVALID' });
  assert.deepEqual(await consumeOAuthAttempt(store, {
    state: started.state, provider: 'GOOGLE', intent: 'LOGIN',
    browserSessionId: 'browser-a',
  }, now + 10 * 60 * 1000), { kind: 'INVALID' });
});

test('link attempt is bound to the signed-in member and cannot become login', async () => {
  const store = memoryStore();
  const started = await startOAuthAttempt(store, {
    provider: 'DISCORD', intent: 'LINK',
    browserSessionId: 'browser-a', memberId: 'member-a',
  }, now);
  assert.deepEqual(await consumeOAuthAttempt(store, {
    state: started.state, provider: 'DISCORD', intent: 'LINK',
    browserSessionId: 'browser-a', memberId: 'member-b',
  }, now + 1000), { kind: 'INVALID' });
  assert.equal(store.rows.size, 0);
  await assert.rejects(
    startOAuthAttempt(store, {
      provider: 'DISCORD', intent: 'LINK', browserSessionId: 'browser-a',
    }, now),
    /member/i,
  );
});
