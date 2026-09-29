# 계약 변경·철회·폐기 확인

전제: Node.js24, Docker PostgreSQL, 기존 인증·프로젝트·MCP 설정. [최초 합의 안내](../006-contract-agreement/quickstart.md)로 A/B/필수 PM/C를 준비한다. 실제 사용자 DB에 적용하기 전 백업과 적용 대상을 확인한다. `.env`·키·토큰은 공유하거나 커밋하지 않는다.

## 준비

모든 셸 명령에 `rtk proxy`를 사용한다. 해당 브랜치에서 `npm ci`, `npm run db:generate`, 시험 DB에 `npm run db:migrate`, `npm run build`를 실행한다. 0010 migration은 기존 계약 ID·버전·응답을 보존하며 계약별 여러 제안을 지원한다. 기존 수동 앱이 실행 중이면 별도 포트·DB를 사용한다.

MCP 빌드를 갱신한 뒤 해당 MCP 연결을 재시작해 `propose_contract_change`, `restart_contract_proposal`이 노출되는지 확인한다. 전역 설정은 자동 변경하지 않는다. MCP 연결은 A에게 위임된 해당 프로젝트 자격이어야 한다.

## 변경 → 철회 → 새 합의

1. 최초 계약을 A·B·필수 PM이 웹에서 동의해 확정한다.
2. A의 MCP `get_contract`로 조회한 `lastConfirmed.versionId`를 기준으로 변경한다.

```json
{
  "contractId": "계약 UUID",
  "kind": "CHANGE",
  "baselineVersionId": "현재 확정 버전 UUID",
  "proposedBody": "새 전체 계약 본문",
  "requiredPmIds": ["필수 PM UUID"],
  "referencePmIds": [],
  "idempotencyKey": "새 UUID"
}
```

3. `propose_contract_change` 결과의 proposalId로 `/projects/<프로젝트 ID>/contract-proposals/<제안 ID>`를 연다. B가 수정 요청해도 C에게 보이는 기존 확정 본문은 그대로다.
4. A가 웹에서 사유를 입력하고 제안을 철회한다. 이후 같은 제안에는 응답·재전송할 수 없다. 비공개 변경안·철회 사유는 C에게 보이지 않는다.
5. 새 변경 제안에는 현재 baselineVersionId와 철회된 previousProposalId를 함께 넣는다. A·B·필수 PM이 새 제안에 각각 동의한 후에만 현행 본문이 바뀐다. 과거 확정본은 이력으로 남는다.

최초 제안을 철회한 뒤 같은 계약에서 다시 시작할 때는 `restart_contract_proposal`에 contractId, previousProposalId, proposedBody, PM 배열, 새 idempotencyKey를 넣는다. baselineVersionId는 보내지 않는다.

## 폐기

1. `propose_contract_change`에 kind=`RETIRE`, 현재 baselineVersionId, proposedBody=`폐기 이유`를 넣는다.
2. 검토 중에는 기존 계약이 유효하다. 웹은 기준 확정본과 폐기 이유를 구분하고 `이 계약의 폐기에 동의` 버튼을 표시한다.
3. 필수 인원이 모두 동의하면 계약은 RETIRED다. 팀에는 폐기 시각·합의된 이유·과거 확정본이 보인다.
4. `list_active_contracts`에는 빠진다. `get_contract`는 status=RETIRED, body=null, version=null을 반환한다. lastConfirmed는 과거 기록이며 현행 계약이 아니다.
5. 폐기 계약은 되살릴 수 없다. 필요한 경우 `propose_contract`의 previousContractId로 이전 폐기 계약을 연결한 새 계약을 만든다.

## 실패·재시도

- 재시도는 동일 입력과 동일 idempotencyKey를 사용한다. 내용이 바뀌면 새 키를 사용한다.
- 409는 오래된 버전·기준 확정본, 이미 열린 제안, 종료된 제안 등을 뜻한다. 최신 상태를 확인한 뒤 사람이 다시 판단한다.
- A 외 변경·철회, 미배정 회원, 과거 비참여 버전 접근은 차단된다. 관리자도 동의를 대행하지 않는다.
- MCP는 제안만 전송한다. 동의·수정 요청·철회는 사람 웹 세션과 CSRF가 필요하다.
- 필수 참여자가 프로젝트 권한을 잃으면 담당자 변경 필요가 된다. 담당자 교체·관리 종료는 후속 기능이다.

## 자동 검사

`npm run build`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run test:e2e`를 순차 실행한다. 통합/E2E는 시험 전용 DB를 생성하므로 실제 DB 복구 검증과 구분한다. 실제 결과는 [검증 기록](validation.md)에 기록한다.
