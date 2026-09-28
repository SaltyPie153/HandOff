import type { EvidenceRecord } from '../evidence/evidence.service.js';

export type ReplyDecision =
  | { kind: 'AUTO_REPLY'; publicBody: string; evidenceRefs: Array<{ kind: string; sourceId: string; version: string }> }
  | { kind: 'REVIEW_REQUIRED'; reason: string };

const clause = /^([A-Z][A-Z0-9_.-]{1,63}): ([^\r\n]{1,400})$/;

export function decideReply(claim: string | null, evidence: EvidenceRecord[], unavailable: string[]): ReplyDecision {
  if (!claim || !clause.test(claim)) return { kind: 'REVIEW_REQUIRED', reason: '명시적 확인 항목이 없습니다' };
  if (unavailable.length || !evidence.length) return { kind: 'REVIEW_REQUIRED', reason: '최신 근거가 부족합니다' };
  const [, key, expected] = clause.exec(claim)!;
  for (const source of evidence) {
    const values = source.content.split(/\r?\n/).map(line => clause.exec(line.trim()))
      .filter((match): match is RegExpExecArray => !!match && match[1] === key)
      .map(match => match[2]);
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
