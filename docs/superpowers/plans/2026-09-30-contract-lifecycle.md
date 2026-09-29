# 계약 변경·철회·폐기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A만 변경·폐기를 제안하고, 미완료 제안은 사람 A가 철회하며, 새 합의 전까지 기존 확정 계약을 보존한다.

**Architecture:** 기존 contracts 모듈의 계약·제안 관계를 1:N으로 확장한다. 계약 행 잠금 아래 기준 확정본·OPEN 제안·버전·현재 권한을 검사하고, 사람 전원 동의만으로 현행 본문 교체 또는 폐기를 원자적으로 저장한다.

**Tech Stack:** Node.js24, NestJS/TypeScript, Prisma/PostgreSQL, React/MUI, MCP SDK, node:test/Vitest/Playwright. 새 외부 의존성 없음.

**Spec:** [승인된 설계](../specs/2026-09-30-contract-lifecycle-design.md)

## Global Constraints

- 변경·폐기 제안은 기존 송신자 A만 시작한다. A·B는 원래 계약의 당사자로 고정한다.
- 계약 하나에 OPEN 제안은 최대 하나다. CHANGES_REQUESTED도 OPEN에 포함한다.
- A·B·필수 PM의 동일 버전 전원 동의가 필요하다. 참조 PM은 열람만 한다. 에이전트는 사람의 동의를 대행하지 않는다.
- 확정 본문은 프로젝트 팀 전체 공개, 검토 본문과 수정 의견은 해당 버전 참여자만 열람한다.
- 철회는 A가 웹에서 직접 사유를 입력한다. 폐기 이유는 폐기 합의가 끝나면 팀에 공개한다. 확정 전에는 참여자에게만 공개한다.
- 기존 본문·전송 버전·응답을 덮어쓰지 않는다. 새 버전과 새 제안에 동의를 복사하지 않는다. RETIRED는 재활성화하지 않는다.
- 기존 제한 유지: 제목160자, 본문50,000자, 수정 의견10,000자, 키128자, PM 배열 각각10명. 철회 이유는 수정 의견과 동일하게1~10,000자, 폐기 이유는 제안 본문과 동일하게1~50,000자다. 원문 길이와 trim 후 빈 값 모두 검사한다.
- 활성 worktree `contract-agreement/Handoff`와 전용 시험 DB55439를 재사용한다. 원래9578·수동 앱5578/3308·사용자 DB55438·outputs·비밀은 보존한다.
- 셸은 `rtk proxy`, Node24는 기존 `work/contract-agreement/node24.ps1`로 실행한다. 실제 사용자 DB migration·push·PR·merge·배포는 이 계획의 자동 실행 항목이 아니다.

## Review Focus

1. 이전 확정 제안에 대한 요청이 새 OPEN 제안을 잘못 닫는 경우: 모든 상태 변경을 proposalId와 expectedVersion에 결박한다. Task2.
2. 철회 저장 후 응답 유실 및 동일 키 재사용: 동일 payload는 기존 결과, 변경 payload는409, 기록·알림은 한 번만 생성한다. Task2/5.
3. 새 PM이 이전 제안 ID를 알아낸 경우: 버전별 비공개 접근을 유지하며 공개 이력에서 참여자·수정 의견을 제거한다. Task3.
4. 폐기 본문이 예전 클라이언트에서 현행 계약처럼 보이는 경우: RETIRED의 body/version은 null이고 과거 본문은 별도 필드로만 제공한다. Task3/4/5.
5. 기존 ACTIVE·수정 요청·재전송 데이터 업그레이드: ID·본문·응답 보존과 상태 backfill, 잘못된 교차 계약 참조 거부를 검증한다. Task1.

## 파일 책임

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/0010_contract_lifecycle/migration.sql`: 다중 제안, 확정/폐기 포인터, 철회 기록, DB 제약 및 이전.
- `apps/api/src/contracts/contract.types.ts`, `contract-policy.ts`: 입력·DTO·정규화.
- `apps/api/src/contracts/contract.repository.ts`: 기존 제안/재전송/동의와 신규 후속 제안·철회의 트랜잭션. 불필요한 별도 서비스 도입 없음.
- `apps/api/src/contracts/contract-query.repository.ts`: 공개 확정 이력, 개인 제안과 할 일·알림.
- `apps/api/src/contracts/contract.controller.ts`, `contract-mcp.controller.ts`: 세션/CSRF와 grant 경계.
- `apps/mcp/src/index.ts`, `transport.ts`: 제안 도구와 API 전송.
- `apps/web/src/contracts/api.ts`, `ContractDetailPage.tsx`, `ContractListPage.tsx`, `ContractProposalPage.tsx`, `ContractResponseForm.tsx`, `ContractNotifications.tsx`, 새 `ContractWithdrawForm.tsx`: 상태·이력·사람 철회 화면.
- 해당 API/MCP/web 테스트와 새 `tests/e2e/contract-lifecycle.spec.ts`, `specs/007-contract-lifecycle/{quickstart,validation}.md`, 제품/기술/검증 문서.

## 공유 인터페이스

Task1에서 다음 타입을 contract.types.ts에 정의한다. JSON 날짜는 ISO 문자열이다.

```ts
type ContractProposalKind = 'INITIAL'|'CHANGE'|'RETIRE';
type HumanSession = {tokenHash:string;csrfHash:string};
type FollowupContractInput = {
 kind: ContractProposalKind; baselineVersionId?:string; previousProposalId?:string;
 proposedBody:string; requiredPmIds:string[]; referencePmIds:string[]; idempotencyKey:string;
};
type WithdrawContractInput = {expectedVersion:number;reason:string;idempotencyKey:string};
type WithdrawalReceipt = {proposalId:string;version:number;status:'WITHDRAWN';withdrawnAt:string};
type ConfirmedSnapshot = {proposalId:string;versionId:string;version:number;body:string;confirmedAt:string};
```

기존 `ProposalReceipt`·`ResponseReceipt`는 유지한다. ProposeContractInput은 `previousContractId?:string`만 추가하며 ReviseContractInput에 이 필드가 섞이지 않도록 명시적 Pick/Omit을 사용한다.

- INITIAL 후속 제안은 previousProposalId 필수·baselineVersionId 금지, CHANGE/RETIRE는 baselineVersionId 필수다. previousProposalId가 있으면 같은 계약의 철회된 같은 kind여야 한다.
- 공개 카드에 status RETIRED와 retiredAt을 추가한다. 공개 상세의 기존 body/version은 ACTIVE에서 유지, RETIRED에서는 null이다. `history:ConfirmedSnapshot[]`, `lastConfirmed:ConfirmedSnapshot|null`, `retirement:{versionId,version,reason,confirmedAt}|null`, `previousContractId:string|null`을 제공한다. history에는 INITIAL/CHANGE의 CONFIRMED만 넣는다.
- 개인 상세에 kind, lifecycle, baselineVersionId, previousProposalId, canWithdraw, withdrawal `{actorId,reason,withdrawnAt}|null`을 추가한다. 목록·알림에도 kind를 추가한다. 비공개 versions 배열에는 자신이 참여한 버전만 남긴다.

## Task 1: 데이터 이전·상태·입력 규칙

**Files:** schema/migration, types/policy, 새 `apps/api/tests/contract-lifecycle-policy.test.mjs`, `contract-lifecycle-migration.integration.test.mjs`, 기존 `contract-fixture.mjs`.

**Interfaces:** `normalizeFollowup(input:FollowupContractInput):FollowupContractInput`, `normalizeWithdrawal(input:WithdrawContractInput):WithdrawContractInput`; 기존 normalizeProposal/normalizeRevision 호환.

- [ ] `invalid lifecycle input is rejected` 작성: 빈 이유, 10,001자 철회사유, 50,001자 폐기사유, 음수 버전, 잘못된 UUID, INITIAL+baseline, CHANGE without baseline은400; PM 정렬 결과는 동일하다.
- [ ] API 단위 검사를 실행해 신규 함수 부재로 FAIL을 확인한다.
- [ ] `0009 data survives lifecycle migration` 작성: 격리 schema에 기존 UNCONFIRMED/ACTIVE·수정 요청·재전송을 만든 후0010 적용, 기존 ID·본문·응답 동일, sender/recipient backfill, ACTIVE last=current, OPEN 중복/교차 계약 포인터 거부.
- [ ] 모델을 확장한다. 계약 original sender/recipient와 이전 계약 링크, lastConfirmed/retirement 포인터·retiredAt; proposal kind/lifecycle/baseline/previous/withdrawal 정보. 기존1:1 unique를 제거하고 계약별 OPEN 부분 unique index 및 같은 계약을 보장하는 복합 FK·상태 CHECK를 추가한다. 철회 key/hash는 proposal에 저장한다.
- [ ] 기존 확정 proposal은 CONFIRMED, 나머지는 OPEN으로 backfill한다. 기존 계약 생성 코드를 최소 조정해 신규 필수 필드를 채우고 fixture cleanup의 추가 포인터도 정리한다.
- [ ] Node24 `npm run db:generate`, API build, 새 policy/migration 테스트 실행: exit0, DB skip0. 명시적 변경 파일만 `feat: add contract lifecycle schema and policy`로 커밋한다.

## Task 2: 변경·철회·폐기의 원자적 저장

**Files:** contract.repository.ts, 새 `apps/api/tests/contract-lifecycle.integration.test.mjs`, 기존 agreement/session 통합검사.

**Interfaces:** `proposeFollowup(actorId:string,projectId:string,contractId:string,grantId:string,input:FollowupContractInput):Promise<ProposalReceipt>`; `withdraw(actorId:string,projectId:string,proposalId:string,input:WithdrawContractInput,session:HumanSession):Promise<WithdrawalReceipt>`. 기존 propose/revise/respond 시그니처 유지.

- [ ] `change keeps active body until unanimous consent` 작성: 최초 확정→CHANGE→수정→재전송까지 current 불변, 마지막 동의에서만 교체; A 외 followup404, 같은 계약 OPEN 경쟁409, stale baseline409.
- [ ] `withdrawal is human sender only and retry safe` 작성: A 웹 세션 철회 성공, B/참조404, 세션 누락/만료401; 동일 키 결과 동일·변경 payload409; 철회 뒤 응답/재전송409; 새 연결 INITIAL/CHANGE의 응답0.
- [ ] `retirement preserves history and cannot reactivate` 작성: 검토 중ACTIVE 유지, 전원 동의 후 RETIRED/current=null/last 보존, 폐기 제안 버전을 현행 본문으로 사용하지 않음, 재활성화409; 이전 폐기 계약 링크는 같은 프로젝트만 허용.
- [ ] 실제 DB Lock 대기와 양쪽 순서를 강제해 철회/마지막 동의, 철회/재전송, 경쟁 followup을 검사한다. 이전 확정 proposal 철회409가 새 OPEN proposal에 영향을 주지 않음을 검사한다. 세션/grant 철회와 멤버 제외 저장 직전 검사도 재사용한다.
- [ ] 해당 테스트를 실행해 FAIL을 확인한다.
- [ ] 계약 행→회원 ID순→session/grant의 기존 잠금 순서를 유지해 구현한다. OPEN·kind·baseline과 최신버전 검사, 재시도 비교, 상태/응답/알림 저장을 하나의 트랜잭션으로 수행한다. 멤버 누락이면 변경/철회/합의를 막고 담당자 변경 필요를 유지한다.
- [ ] respond의 마지막 동의에서 INITIAL/CHANGE는 현행·마지막 본문 교체, RETIRE는 현재 포인터 제거·폐기 포인터 기록, 공통 proposal CONFIRMED 전환. revise는 OPEN 상태로 판단하고 ACTIVE 계약의 CHANGE/RETIRE도 허용한다.
- [ ] API build 후 lifecycle/agreement/session DB 검사 exit0, skip0 확인. `feat: implement atomic contract lifecycle`로 커밋한다.

## Task 3: 공개 이력·개인 권한·할 일

**Files:** contract-query.repository.ts, 새 `apps/api/tests/contract-lifecycle-access.integration.test.mjs`.

**Interfaces:** 기존 listPublic/getPublic/listMine/getProposal/summary/notifications 메서드 인수 유지, 위 공유 DTO 적용.

- [ ] `public history contains confirmed bodies only` 작성: C에게 초기·변경 확정본만 공개, 철회 본문/수정 의견/participants/responses 미포함; RETIRED body/version=null, lastConfirmed 및 retirement 구별; 유효 목록 제외.
- [ ] `new PM cannot read old private proposals` 작성: 새 제안 PM이 과거 비공개 ID로 조회404; 원래 PM도 미참여 새 버전404; 제외 회원은 공개 과거 본문도404. 여러 공개 본문 반환 시 실제 반환한 versionId 각각 조회감사 기록, 목록은0.
- [ ] `open change tasks do not depend on contract status` 작성: ACTIVE의 OPEN CHANGE도 needsReview 집계, 개인 동의 후0, 철회/확정 이후0, 필수 멤버 상실 시0. 철회 알림 중복0·읽음 idempotent.
- [ ] 테스트 FAIL 후 기존 singular proposal 조회를 plural로 변경하고 OPEN 기반 집계·DTO whitelist 적용. 개인 이력은 proposal와 version 양쪽의 참여 권한을 검사한다.
- [ ] API build와 lifecycle/access DB 검사 exit0 확인. `feat: expose scoped contract lifecycle history`로 커밋한다.

## Task 4: HTTP·MCP 인터페이스

**Files:** controllers, MCP index/transport, 기존 `apps/api/tests/contract-http.integration.test.mjs`, `apps/mcp/tests/mcp.test.ts`.

**Interfaces:** POST `/api/mcp/contracts/:contractId/proposals`→proposeFollowup; POST `/api/projects/:projectId/contract-proposals/:proposalId/withdraw`→withdraw. 기존 조회·응답·재전송 API 유지. MCP transport `proposeContractChange`와 `restartContractProposal`은 동일 followup 경로를 호출한다.

- [ ] 신규 HTTP404 실패를 먼저 확인한다. 이후 session+CSRF 철회201, MCP bearer401, CSRF없음403, 잘못된 필드400, 오래된 상태409, 타프로젝트404를 검사한다. body의 actor/session 값은 신뢰하지 않는다.
- [ ] SDK 검사에서 `propose_contract_change`(kind CHANGE/RETIRE)와 `restart_contract_proposal`(kind INITIAL 고정)의 스키마·정확한 URL·payload·키 보존을 검사한다. 이전 계약 링크를 propose_contract에서 전달한다. 동의·철회 MCP 도구는 없어야 한다.
- [ ] 경계 구현 후 API HTTP 검사, MCP 테스트, 전체 typecheck exit0. RETIRED의 null 필드가 MCP 그대로 전달됨을 확인하고 `feat: add contract lifecycle endpoints and MCP tools`로 커밋한다.

## Task 5: 변경 검토·사람 철회·폐기 이력 화면

**Files:** 웹 파일 책임 목록, 기존 `apps/web/tests/contract-pages.test.tsx`, 새 `contract-lifecycle.test.tsx`.

**Interfaces:** `withdrawProposal(projectId,proposalId,input:WithdrawContractInput)` API 함수. `ContractWithdrawForm` props `{version:number,onSubmit:(input:WithdrawContractInput)=>Promise<void>}`. 부모가 새로고침·409와 현재 proposal 경계를 관리한다.

- [ ] UI FAIL 검사: A의 최신OPEN에만 철회 폼, B/과거/종료는 숨김; 변경의 기준 확정본과 제안 구분; RETIRE 동의 문구 `이 계약의 폐기에 동의`; RETIRED에 `현재 유효 계약 없음`과 과거 본문 표시.
- [ ] 네트워크 실패→재시도 키·사유 동일, 입력 변경→새 키,409→최신상태 후 자동 제출 없음, proposal 변경 시 과거 입력이 다른 제안으로 전송되지 않음을 검사한다.
- [ ] DTO와 화면을 구현한다. 철회 사유·본문은 React 텍스트로 렌더링한다. 계약 이력은 versionId/proposalId로 식별하고 서로 다른 proposal의 버전1을 혼동하지 않는다. 기존 확정본·변경 검토·폐기 상태를 별도로 표시한다.
- [ ] 웹 전체 tests와 build exit0 확인. `feat: add contract lifecycle review screens`로 커밋한다.

## Task 6: 전체 흐름·검증 기록·리뷰

**Files:** 새 E2E, specs/007 문서, docs/product/spec.md·technical-design.md, docs/harness/checks.md·decisions.md, work/contract-agreement/resume.md.

- [ ] A/B/PM/C E2E: 최초확정→변경검토·수정→철회→C기존본문 유지→연결 변경 새합의→C새본문→폐기합의→유효목록 제외·직접 이력. 새로고침·비공개 URL 차단 포함.
- [ ] Node24 `npm run build`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run test:e2e`를 실행하고 종료코드 기록. 통합/E2E 포트 공유 runner는 순차 실행한다. 기존 프로세스를 종료하지 않는다.
- [ ] Quickstart·실제 검증 결과를 작성하고 R08/R13/R16 및 R19의 구현 부분을 갱신한다. 담당자 복구·관리 종료는 완료로 표시하지 않는다. 사용자 A-only 결정을 제품 명세·결정 기록에 반영한다.
- [ ] Harness 두 검사와 `git diff --check` 실행. 최종 독립 리뷰에서 데이터 이전·공개 DTO·경합·세션 권한을 확인하고 중요한 결함은 실패 재현 후 수정·재검증한다.
- [ ] 명시적 파일만 커밋하고 실제 명령·오류·미검증·남은 작업을 보고한다. 실제 OAuth/Solar·운영복구·대규모 성능 결과를 자동 suite 결과로 대신하지 않는다.

## 자체 검토와 실행

- 설계의 동일 계약 ID·다중 제안·철회·폐기·이력·권한·MCP·화면·migration을 Tasks1~6에 대응시켰다.
- 기존 최초합의와 새 lifecycle의 공유 메서드·DTO 이름을 통일했다. 미완료 여부는 계약 ACTIVE 여부가 아니라 proposal OPEN으로 판단한다.
- 계약 변경을 자동 판정 근거로 사용하는 기능은 포함하지 않았다. 운영 검증도 별도 환경·증거가 필요하다.
- 사용자 선호인 직접 구현을 유지한다. 본 계획 검토 후 executing-plans로 순서대로 구현하고 최종 독립 리뷰를 수행한다.
