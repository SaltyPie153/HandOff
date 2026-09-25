import assert from 'node:assert/strict';
import test from 'node:test';
import { canPerform, decideProviderLink } from '../src/auth/domain.ts';

const pending = { id: 'member-a', status: 'PENDING', isServiceAdmin: false };
const approved = { id: 'member-a', status: 'APPROVED', isServiceAdmin: false };
const admin = { id: 'member-a', status: 'APPROVED', isServiceAdmin: true };

test('pending member can see own state and link a provider but cannot use work APIs', () => {
  assert.equal(canPerform(pending, 'READ_OWN_STATUS', false), true);
  assert.equal(canPerform(pending, 'LOGOUT', false), true);
  assert.equal(canPerform(pending, 'LINK_PROVIDER', false), true);
  for (const action of ['CREATE_PROJECT', 'READ_PROJECT', 'LIST_PENDING_USERS', 'APPROVE_USER', 'GRANT_ADMIN']) {
    assert.equal(canPerform(pending, action, true), false, action);
  }
});

test('approved member can create projects but reads only assigned projects', () => {
  assert.equal(canPerform(approved, 'CREATE_PROJECT', false), true);
  assert.equal(canPerform(approved, 'READ_PROJECT', false), false);
  assert.equal(canPerform(approved, 'READ_PROJECT', true), true);
  assert.equal(canPerform(approved, 'LIST_PENDING_USERS', true), false);
  assert.equal(canPerform(approved, 'APPROVE_USER', true), false);
  assert.equal(canPerform(approved, 'GRANT_ADMIN', true), false);
});

test('service admin may approve and grant but project access still requires assignment', () => {
  assert.equal(canPerform(admin, 'LIST_PENDING_USERS', false), true);
  assert.equal(canPerform(admin, 'APPROVE_USER', false), true);
  assert.equal(canPerform(admin, 'GRANT_ADMIN', false), true);
  assert.equal(canPerform(admin, 'READ_PROJECT', false), false);
  assert.equal(canPerform(admin, 'READ_PROJECT', true), true);
});

test('pending admin flag and unknown action never grant authority', () => {
  const inconsistent = { id: 'member-a', status: 'PENDING', isServiceAdmin: true };
  assert.equal(canPerform(inconsistent, 'APPROVE_USER', false), false);
  assert.equal(canPerform(admin, 'DELETE_EVERYTHING', true), false);
  assert.equal(canPerform(null, 'READ_OWN_STATUS', false), false);
});

test('provider link belongs only to one internal member', () => {
  assert.deepEqual(decideProviderLink('member-a', null), { kind: 'CREATE' });
  assert.deepEqual(decideProviderLink('member-a', 'member-a'), { kind: 'ALREADY_LINKED' });
  assert.deepEqual(decideProviderLink('member-a', 'member-b'), { kind: 'CONFLICT' });
});
