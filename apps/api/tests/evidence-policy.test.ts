import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFreshLocalSnapshot } from '../src/evidence/evidence-policy.js';

test('local snapshot is automatic evidence for at most 24 hours with no newer dirty report', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  assert.equal(isFreshLocalSnapshot({ syncedAt: new Date('2026-09-28T12:00:00Z'), dirtyAt: null }, now), true);
  assert.equal(isFreshLocalSnapshot({ syncedAt: new Date('2026-09-28T11:59:59Z'), dirtyAt: null }, now), false);
  assert.equal(isFreshLocalSnapshot({ syncedAt: new Date('2026-09-29T11:00:00Z'), dirtyAt: new Date('2026-09-29T11:30:00Z') }, now), false);
  assert.equal(isFreshLocalSnapshot({ syncedAt: new Date('2026-09-29T11:00:00Z'), dirtyAt: new Date('2026-09-29T10:00:00Z') }, now), true);
  assert.equal(isFreshLocalSnapshot({ syncedAt: new Date('2026-09-29T13:00:00Z'), dirtyAt: null }, now), false);
});
