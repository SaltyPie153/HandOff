import type { EvidenceRecord } from '../evidence/evidence.service.js';
import {parseClaim,extractClaimLines} from '../evidence/evidence-clause.js';

export type ReplyDecision =
  | { kind: 'AUTO_REPLY'; publicBody: string; evidenceRefs: Array<{ kind: string; sourceId: string; version: string }> }
  | { kind: 'REVIEW_REQUIRED'; reason: string };

export function decideReply(claim: string | null, evidence: EvidenceRecord[], unavailable: string[]): ReplyDecision {
  const parsed=parseClaim(claim);
  if (!parsed) return { kind: 'REVIEW_REQUIRED', reason: '명시적 확인 항목이 없습니다' };
  if (unavailable.length || !evidence.length) return { kind: 'REVIEW_REQUIRED', reason: '최신 근거가 부족합니다' };
  const {key,value:expected}=parsed;
  for (const source of evidence) {
    const {values,malformed}=extractClaimLines(source.content,key);
    if(malformed)return {kind:'REVIEW_REQUIRED',reason:'근거 문구가 모호합니다'};
    if (!values.length || values.some(value => value !== expected)) {
      return { kind: 'REVIEW_REQUIRED', reason: '근거가 누락되거나 서로 다릅니다' };
    }
  }
  return {
    kind: 'AUTO_REPLY',
    publicBody: '요청한 항목이 등록된 최신 근거에서 일치함을 확인했습니다.',
    evidenceRefs: evidence.map(source => ({ kind: source.kind, sourceId: source.sourceId, version: source.version }))
  };
}
