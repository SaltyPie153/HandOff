import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCookie, validCsrf } from '../src/auth/auth-http.js';
import { sha256 } from '../src/auth/auth.repository.js';

test('cookie parser accepts exact cookie name only', () => {
  const token = 'a'.repeat(43);
  assert.equal(readCookie(`other=x; ho_session=${token}; ho_session_extra=bad`, 'ho_session'), token);
  assert.equal(readCookie('ho_session_extra=bad', 'ho_session'), null);
  assert.equal(readCookie('ho_session=abc%0Aevil', 'ho_session'), null);
});

test('CSRF requires an exact unguessable token bound to the session', () => {
  const token = 'a'.repeat(43);
  assert.equal(validCsrf(token, sha256(token)), true);
  assert.equal(validCsrf('b'.repeat(43), sha256(token)), false);
  assert.equal(validCsrf(undefined, sha256(token)), false);
});
