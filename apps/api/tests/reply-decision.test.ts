import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideReply } from '../src/handoff/reply-decision.js';

const evidence = (content: string, sourceId = 'source') => ({ kind: 'LOCAL' as const, sourceId, content,
  version: 'sha', observedAt: new Date('2026-09-29T00:00:00Z') });

test('only the same explicit key and value across every current source qualifies for automatic reply', () => {
  const claim = 'API_SCOPE: read-only';
  assert.equal(decideReply(claim, [evidence('API_SCOPE: read-only')], []).kind, 'AUTO_REPLY');
  assert.equal(decideReply(claim, [evidence('API_SCOPE: read-only'), evidence('API_SCOPE: read-only', 'second')], []).kind, 'AUTO_REPLY');
  assert.equal(decideReply(claim, [evidence('API_SCOPE: read-only'), evidence('API_SCOPE: write', 'second')], []).kind, 'REVIEW_REQUIRED');
  assert.equal(decideReply(claim, [evidence('API_SCOPE: read-only\nAPI_SCOPE: write')], []).kind, 'REVIEW_REQUIRED');
  assert.equal(decideReply(claim, [evidence('API_SCOPE: read-only'), evidence('Other: value', 'second')], []).kind, 'REVIEW_REQUIRED');
  assert.equal(decideReply(claim, [evidence('API_SCOPE: read-only')], ['LOCAL_STALE']).kind, 'REVIEW_REQUIRED');
  assert.equal(decideReply(claim, [], []).kind, 'REVIEW_REQUIRED');
  assert.equal(decideReply('maybe read-only?', [evidence('maybe read-only?')], []).kind, 'REVIEW_REQUIRED');
  assert.equal(decideReply(null, [evidence('API_SCOPE: read-only')], []).kind, 'REVIEW_REQUIRED');
});
