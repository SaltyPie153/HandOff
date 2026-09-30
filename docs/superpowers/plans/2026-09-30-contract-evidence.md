# 확정 계약 근거 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 프로젝트의 현재 유효 확정 계약을 명시적 사실 회신에 재사용하고, 계약 변경·폐기와 경합해도 오래된 근거로 게시하지 않는다.

**Architecture:** 기존 EvidenceService와 배경 작업에 계약 후보 수집을 추가한다. 공용 한 줄 파서로 결정적 비교와 Solar 입력을 일치시키고, 프로젝트별 공유/배타 advisory lock 안에서 최종 근거 집합을 재검사한다. 계약 확정 트랜잭션에서 기존 작업의 실행 ID를 무효화하고 필요한 작업만 재확인한다.

**Tech Stack:** Node.js24, TypeScript, NestJS, PostgreSQL17/Prisma7, React, 기존 Upstage `solar-pro4`·OpenAI SDK. 의존성 추가 없음.

**Spec:** [승인 설계](../specs/2026-09-30-contract-evidence-design.md)

## Global Constraints

- 현재 프로젝트의 유효한 확정본만 사용한다. 변경 검토 중에는 기존 확정본을 유지하며 폐기 계약·과거 확정본·미확정 본문을 자동 근거로 사용하지 않는다.
- 명시된 사실이 직접 일치할 때만 게시한다. 기존 키 형식 `[A-Z][A-Z0-9_.-]{1,63}`, 값 길이1~400자. 자연어 추론·추천은 B의 비공개 검토로 넘긴다.
- 등록 로컬·GitHub 근거의 엄격한 누락·충돌·만료 규칙을 유지한다. 계약에는 로컬 24시간 만료를 적용하지 않는다.
- 공개 회신은 기존 짧은 문구이며 본문·확인 키 값·경로·비공개 의견을 복사하지 않는다. 자동 회신과 사람 확인·계약 동의·사람 열람 감사는 별개다.
- 잠금 순서: 프로젝트 근거 잠금 → 계약 또는 요청 → ID순 회원/멤버십 → grant/세션. 외부 파일 조회·Solar 호출은 잠금 밖이다.
- 기존5580/3310 수동 앱·DB와9578의 outputs를 보존한다. 모든 셸은 rtk proxy, 비밀 값 출력·커밋 금지. API/MCP 입력·모델 공급자·키 보관 방식 유지.
- 기본 구현은 새 공개 API·DB migration 없이 기존 계약과 HandoffJob JSON/lease/executionId를 사용한다. 승인 범위 밖의 모델 변경이 필요하면 설계를 갱신한다.

## Review Focus

1. 들여쓰기·CRLF·전각 콜론·같은 키의 잘못된 줄: 파서/모델의 불일치로 잘못 확인하지 않아야 한다 — Task1.
2. 다른 주제 계약과 같은 키의 새 계약: 무관한 계약은 제외하지만 새 충돌 계약은 빠뜨리지 않아야 한다 — Task2/3.
3. ACTIVE이지만 현재 버전이 null/미확정/다른 계약 소속인 잘못된 데이터: 과거 이력으로 대체하지 않고 실패해야 한다 — Task2.
4. 게시 직전 grant 철회·B 멤버 제거·lease 만료·사람 회신: 계약 근거가 맞아도 기존 게시 조건을 우회하지 않아야 한다 — Task3.
5. 실행 중 계약 확정과 이전 실행의 검토 저장, 사람 종료 요청: 이벤트를 놓치거나 종료 작업을 되살리지 않아야 한다 — Task4.

## 파일과 공용 인터페이스

- 새 `apps/api/src/evidence/evidence-clause.ts`: 한 줄 문구 해석과 키별 줄 추출. `evidence-review.ts`는 재확인 가능한 근거 실패 사유 상수를 관리한다.
- 새 `apps/api/src/evidence/contract-evidence.ts`: 계약 후보의 DB 조회, 근거 참조 정렬, 프로젝트 잠금.
- 새 `apps/api/src/handoff/contract-evidence-requeue.ts`: 계약 확정 후 재확인 대상 선택과 기존 실행 무효화.
- 수정 evidence.service, reply-decision, agent-runner, background-worker, contract.repository. 기존 작은 파일·타입 구조를 따르고 전체 저장소를 재배치하지 않는다.
- 웹 변경은 ContractProposalPage의 형식 도움말과 회귀 검사에 한정한다.
- 새 문서 `specs/008-contract-evidence/{quickstart,validation}.md`, 제품·기술·검증 기준 갱신.
- 공용 타입은 기존 EvidenceService의 `EvidenceRecord`, `EvidenceCollection`을 재사용한다. 순환 런타임 import를 만들지 않도록 다른 파일에서는 `import type`을 사용한다.

## 실행 준비와 명령

작업 루트: `C:/Users/fhtkr/.codex/worktrees/contract-evidence/Handoff`. 직접 구현 선호를 유지하고 최종 단계에 독립 리뷰를 수행한다.

Task1 실행 준비에서만 Git 제외된 `work/contract-evidence/node24.ps1`을 작성한다. 기존 Node24 helper와 같이 PATH 앞에 `C:/Users/fhtkr/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`을 넣고 node.exe에 나머지 인자를 전달한다. npm CLI는 `C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js`다. 아래 `N24 <args>`는 `rtk proxy pwsh -NoProfile -File work/contract-evidence/node24.ps1 <args>`, `NPM <args>`는 `N24 "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" <args>`로 실행한다.

- `NPM ci`; 새 작업공간에서만 `N24 scripts/dev-init.mjs`, `NPM run db:generate`, `NPM run build`. dev-init의 로컬 설정은 Prisma 생성/빌드용이며 기존 개발 DB에 db:up/migrate를 실행하지 않는다.
- DB 테스트는 Git 제외된 `work/contract-evidence/run-db.mjs`를 사용한다. `createTestEnvironment({withServices:false})`로 매번 시험용 Compose DB를 만들고, 전달된 테스트 경로를 Node24 `--test`로 environment.env와 함께 실행한 뒤 finally에서 environment.close를 호출한다. 기존 helper의 삭제 범위·실패 전파를 따른다.
- `N24 work/contract-evidence/run-db.mjs <tests/...integration.test.mjs>`가 해당 DB 테스트의 명령이다. 환경이 불가하면 테스트를 skip한 채 통과했다고 하지 않는다.
- 초기 기준 `NPM test`의 실제 결과를 기록한다. 단위 명령의 DB skip과 실DB 실행을 구분한다. focused RED가 import/build 실패인지 의도한 동작 실패인지 확인한다.

### Task1: 공용 한 줄 파서와 기존 판정 일치

**Files:** Create evidence/evidence-clause.ts, evidence/evidence-review.ts, tests/evidence-clause.test.mjs; Modify handoff/reply-decision.ts, handoff/agent-runner.ts, tests/reply-decision.test.ts, tests/agent-runner.test.mjs (앞의 경로는 apps/api/src 또는 apps/api/tests).

**Interfaces:** Produces `parseClaim(value:string|null|undefined): {key:string;value:string}|null`, `extractClaimLines(content:string,key:string): {values:string[];lines:string[];malformed:boolean}`. parseClaim은 요청 전체를 임의 trim하지 않는다. extract는 각 소스 줄을 기존처럼 trim하며 CRLF를 허용한다. 동일 키 다음 공백+콜론/전각 콜론/등호 또는 키만 있는 줄은 같은 키의 후보로 보고, 정확한 `KEY: 값` 문법에 맞지 않으면 malformed다. `API_SCOPE_EXTRA`는 `API_SCOPE` 후보가 아니다. 함수는 네트워크·DB를 사용하지 않는다.

- [x] **Step1 — RED 작성:** `parseClaim('USER_ID_FORMAT: uuid-v4')`의 값 정확 보존, 자연어/null/1자 키/401자 값 거부. CRLF·들여쓰기된 정규 문구 추출, 같은 키 충돌 전체 탐색, `USER_ID_FORMAT:uuid-v4`·전각 콜론·등호·키만 있는 줄 malformed, 비슷한 다른 키 제외를 assert한다. 기존 LOCAL/GITHUB의 누락·만료 검토 회귀는 그대로 둔다.

```js
assert.deepEqual(parseClaim('USER_ID_FORMAT: uuid-v4'), {key:'USER_ID_FORMAT',value:'uuid-v4'});
assert.equal(parseClaim('USER_ID_FORMAT: ' + 'x'.repeat(401)), null);
assert.equal(extractClaimLines('USER_ID_FORMAT： uuid-v4', 'USER_ID_FORMAT').malformed, true);
```

- [x] **Step2 — RED 실행:** API build 후 `N24 --test apps/api/tests/evidence-clause.test.mjs`, `NPM run test --workspace @handoff/api`. 새 파서/모호한 줄 검사가 실패하는지 기록한다.
- [x] **Step3 — 최소 구현:** 공용 파서를 구현하고 decideReply 및 Solar 입력 줄 추출에 사용한다. 정확 비교의 값/대소문자 의미는 바꾸지 않는다. malformed는 사유 `근거 문구가 모호합니다`의 REVIEW_REQUIRED이며 모델을 호출하지 않는다. `EVIDENCE_REVIEW_REASONS:readonly string[]`에 `최신 근거가 부족합니다`, `근거가 누락되거나 서로 다릅니다`, `근거 문구가 모호합니다`, `근거가 처리 중 변경되었습니다`, `게시 전 근거가 변경되었습니다`를 정의하고 후속 판정/재확인에서 공유한다.
- [x] **Step4 — GREEN:** 같은 명령 성공. Solar request의 model=`solar-pro4`, 관련 정규 줄만 포함, unrelated private 문구 미포함과 REVIEW/비정상 종료 거부를 검사한다. 실모델 호출은 하지 않는다.
- [x] **Step5 — Commit:** `feat: share explicit evidence clause parsing`.

### Task2: 유효 계약 후보 수집과 버전 참조

**Files:** Create src/evidence/contract-evidence.ts, tests/contract-evidence.integration.test.mjs; Modify src/evidence/evidence.service.ts. 기존 contract-fixture.mjs를 테스트 데이터 생성/정리용으로 재사용한다.

**Interfaces:** Consumes Task1 파서와 기존 EvidenceRecord/Collection. Produces `collectContractEvidence(db:Pick<Prisma.TransactionClient,'developmentContract'>, projectId:string, claim:string|null|undefined, now:Date): Promise<EvidenceCollection>`와 `canonicalEvidenceRefs(records:EvidenceRecord[]): Array<{kind:string;sourceId:string;version:string}>`. `EvidenceService.collect(ownerId,projectId,now=new Date(),claim?:string|null)`의 마지막 인자로 claim을 추가해 기존 호출의 호환을 유지한다. claim이 없으면 계약을 추론해서 고르지 않는다.

- [x] **Step1 — RED 작성:** 웹 사람 동의 fixture로 `USER_ID_FORMAT: uuid-v4` 확정 후 수집 결과가 `HANDOFF_CONTRACT/contractId/currentVersionId`인지 assert한다. LOCAL 등록 없이도 수집, 동일키 두 계약 수집, unrelated 계약 제외, 미확정·다른 프로젝트·RETIRED·과거 버전 제외, 변경/철회 동안 기존 currentVersion 유지를 검사한다.
- [x] **Step2 — RED 실행:** API build 후 `N24 work/contract-evidence/run-db.mjs apps/api/tests/contract-evidence.integration.test.mjs`. 단위 skip이 아니라 실제 DB의 새 계약 근거 누락으로 실패해야 한다.
- [x] **Step3 — 최소 구현:** 프로젝트 ACTIVE/currentVersion과 그 버전의 contractId·status=CONFIRMED·kind INITIAL/CHANGE를 검증해 수집한다. currentVersion 없는 잘못된 ACTIVE는 `CONTRACT_UNAVAILABLE`로 실패하고 lastConfirmed로 대체하지 않는다. 같은 키의 malformed 후보도 판정에 전달해 조용히 제외하지 않는다. 관측 시각=now, 버전=불변 UUID. 참조는 kind/sourceId/version순으로 정렬한다.
- [x] **Step4 — GREEN:** 데이터 정합성 실패에는 mock DB 객체를 사용해 누락/다른 소속 currentVersion의 unavailable을 검사한다(SQL 제약 우회 없음). B 미승인/멤버 제외 시 수집 차단, 같은 키 충돌/파일 만료 REVIEW, 24시간보다 오래된 유효 확정본 포함을 검사한다. 서버 수집이 ContractReadAudit·ContractResponse·HandoffResponse를 생성하지 않는지도 assert한다.
- [x] **Step5 — Commit:** `feat: collect active confirmed contract evidence`.

### Task3: 최종 게시의 근거 집합·권한·잠금 검사

**Files:** Modify src/evidence/contract-evidence.ts, src/handoff/background-worker.ts, src/contracts/contract.repository.ts; Create tests/contract-evidence-worker.integration.test.mjs, tests/contract-evidence-concurrency.integration.test.mjs; 기존 worker/version/session/contract concurrency 검사는 유지한다.

**Interfaces:** Produces `lockContractEvidenceProject(tx:Prisma.TransactionClient,projectId:string,mode:'READ'|'WRITE'):Promise<void>`. 기존 프로젝트 UUID로 `hashtextextended('handoff:contract-evidence:'+projectId,0)` 키를 만들고 READ는 pg_advisory_xact_lock_shared, WRITE는 pg_advisory_xact_lock을 호출한다. 계약 쓰기의 advisory/sendKey·계약 행·권한 잠금보다 먼저 호출한다. worker.publish는 기존 signature를 유지하되 request의 projectId를 별도 읽기로 찾고 공유 잠금 후 request를 다시 검증한다.

- [x] **Step1 — RED 작성:** fake AgentRunner + 격리 AgentKeyStore로 계약만 있는 요청의 자동 회신 하나, 정확한 evidenceRefs, 최소 공개 body와 사람 상태 미변경을 assert한다. 모델 실패/KEY 없는 자연어 검토도 assert한다. fake runner의 barrier 동안 계약 변경·폐기·새 충돌 계약 확정 시 이전 근거 회신0건을 검사한다.
- [x] **Step2 — RED 실행:** API build 후 run-db로 worker/concurrency 새 파일 실행. 기존 파일 개수 비교 때문에 계약-only 게시가 실패하거나 마지막 집합 검사가 없는 실패를 확인한다.
- [x] **Step3 — 최소 구현:** worker의 두 collect 호출에 최신 claim을 전달하고 정렬 참조 집합을 비교한다. publish의 프로젝트 공유 잠금 안에서 claim별 계약을 다시 읽고 정확한 집합과 decideReply를 검증한다. 외부파일 refs와 계약 refs를 나눠 파일 등록 개수·로컬 해시/dirty/신선도 검사를 유지한다. 계약 저장소 propose/proposeFollowup/revise/respond/withdraw의 첫 트랜잭션 잠금은 프로젝트 WRITE로 통일한다. 외부 모델/파일 호출을 잠금 안으로 넣지 않는다.
- [x] **Step4 — GREEN:** 실제 별도 PG 연결의 잠금과 pg_stat_activity wait를 사용해 게시 선행/계약 확정 선행 양쪽을 강제한다(시간 sleep에 기대지 않음). grant 철회·B 제거·lease 만료·새 요청 버전·사람 회신·키 교체 시 0게시, 동시 worker는1게시, 기존 파일-only 경로 정상, 새 계약 추가를 놓치지 않음을 검사한다. 새 프로젝트 잠금으로 바뀐 기존 contract concurrency 테스트의 관측 기대도 실제 잠금에 맞춰 갱신한다.
- [x] **Step5 — Commit:** `fix: validate contract evidence atomically before publication`.

### Task4: 계약 확정 이벤트의 재확인과 실행 무효화

**Files:** Create src/handoff/contract-evidence-requeue.ts, tests/contract-evidence-requeue.integration.test.mjs; Modify src/contracts/contract.repository.ts 및 Task3 worker/concurrency 회귀.

**Interfaces:** Produces `requeueContractEvidenceJobs(tx:Prisma.TransactionClient,projectId:string):Promise<number>`. contract.respond의 실제 최초/변경/폐기 CONFIRMED 분기에서 포인터 변경과 같은 트랜잭션으로 호출한다. 소비하는 기존 HandoffJob 필드는 status/executionId/leaseUntil/reviewReason/reviewDraft/evidenceRefs다. responseReceipt의 재시도 반환이나 비최종 동의는 호출하지 않는다.

- [x] **Step1 — RED 작성:** 근거 부족 REVIEW_REQUIRED 요청이 최초 확정 뒤 PENDING, 새 실행에서 COMPLETED/회신1건인지 assert한다. 변경/폐기 시 PROCESSING executionId=null·lease=null·PENDING과 이전 fake runner의 지연 완료가 게시·검토 결과를 덮어쓰지 못함을 assert한다.
- [x] **Step2 — RED 실행:** API build/run-db로 새 requeue 파일 실행. 현재 계약 확정이 작업을 깨우지 않는 실패를 확인한다.
- [x] **Step3 — 최소 구현:** projectId 일치, 최신 버전=currentVersion, status=AWAITING_REVIEW, 유효 parseClaim, reply 없음, REVIEW_REQUIRED의 `EVIDENCE_REVIEW_REASONS` 또는 PROCESSING인 작업만 갱신한다. worker는 실제 근거 집합 불일치를 `게시 전 근거가 변경되었습니다`로 구분하며 권한/lease 실패의 기존 포괄 사유는 재확인 대상에서 제외한다. 대상 PENDING 상태·기존 실행 ID 무효화·검토 초안 초기화를 원자 저장한다. 갱신 SQL/where에는 선택 시 status·executionId와 최신 요청/회신 조건을 포함해 대기 중 사람 처리로 COMPLETED가 된 작업을 덮어쓰지 않는다.
- [x] **Step4 — GREEN:** 이미 사람 응답/사람 회신/자동 회신/COMPLETED/구버전/claim 없음/다른 프로젝트/키·모델 실패/권한 실패는 재실행0건이다. 전송·수정·철회·동의 재시도는 재확인0건. 변경 확정과 이전 실행 review 저장 양쪽 순서를 barrier로 강제해 반드시 최신 작업이 남고 사용자 종료 상태가 보존되는지 확인한다. 위 조건 필터로 업데이트 직전 사람 처리 경합도 검사한다.
- [x] **Step5 — Commit:** `feat: recheck waiting requests after contract evidence changes`.

### Task5: 형식 안내와 전체 사용자 흐름 검증

**Files:** Modify apps/web/src/contracts/ContractProposalPage.tsx, apps/web/tests/contract-pages.test.tsx; Create tests/e2e/contract-evidence.spec.ts, tests/e2e/fixtures/contract-evidence-worker.mjs, specs/008-contract-evidence/quickstart.md, specs/008-contract-evidence/validation.md; Modify docs/product/{spec,technical-design}.md, docs/harness/{checks,decisions}.md.

**Interfaces:** 공개 API/MCP 입력 불변. 도움말 `자동 사실 확인에 사용할 항목은 USER_ID_FORMAT: uuid-v4처럼 KEY: 값 한 줄로 명시해 주세요. 자연어만으로는 자동 확인하지 않습니다.`를 최초/변경 제안에만 표시한다. 폐기 이유에는 추가하지 않는다.

- [x] **Step1 — RED 작성/실행:** web 테스트에서 최초/변경 도움말과 RETIRE 미표시를 assert하고 `NPM run test --workspace @handoff/web` 실패 확인. 새 E2E는 A/B 웹 합의 → A MCP KEY 요청 → C 최소 회신 표시·본문 비노출 → 계약 폐기 뒤 같은 claim의 새 요청은 B 검토로 끝나는 흐름을 작성한다.
- [x] **Step2 — 최소 구현:** 작은 도움말만 추가한다. E2E의 모델 결과는 fixture worker의 주입 fake AgentRunner로 제공한다. existing control URL의 `/stop`으로 격리 API 자동 worker를 정지하고, built Prisma/worker/격리 fake key store로 실제 작업을 처리한 뒤 `/start`로 복구해 UI를 검사한다. 서버가 먼저 키 부족 검토로 처리한 경우 wakeUnavailableJobs로 재확인한다. helper는 test-only 파일이며 서비스 URL/토큰 guard·finally 복구·temp 경로 검증을 따른다. 실제 공급자 호출이나 production test endpoint를 추가하지 않는다.
- [x] **Step3 — GREEN:** web 테스트 및 `N24 node_modules/@playwright/test/cli.js test tests/e2e/contract-evidence.spec.ts` 성공. E2E는 browser/server/DB 통합이며 Solar 결과는 주입 모의라는 한계를 기록한다. 폐기 후 새 요청의 자동 회신0건, C에게 비공개 claim 미포함을 assert한다.
- [x] **Step4 — 전체 검증:** 순차 `NPM run build`, `NPM run typecheck`, `NPM test`, `NPM run test:integration`, `NPM run test:e2e`. `rtk proxy pwsh -NoProfile -File scripts/check-harness.ps1`, `... scripts/test-harness.ps1`, `rtk proxy git diff --check`. 실패는 원인 확인·수정 후 영향 범위 재검증. 실제 코드가 바뀌지 않으면 성공한 전체 검사를 반복하지 않는다.
- [x] **Step5 — 기록/리뷰/Commit:** 검증 명령·종료 코드·DB unit skip·모델 모의 여부를 validation에 적고 R27/R28/R29 상태와 남은 운영 한계를 갱신한다. 직접 구현의 최종 독립 리뷰에 spec/plan/diff/실제 결과를 제공하고 필요한 수정·회귀 검사를 마친 뒤 `feat: verify and document confirmed contract evidence replies`로 커밋한다. push/PR/merge·실키 복사·실모델 호출은 별도 사용자 요청을 따른다.

## 자체 검토와 수용 기준 매핑

- 계약 선택·현재 버전·키별 충돌/모호함·로컬 신선도: Task1/2. 공개 최소 문구·정확한 참조·사람 상태 분리: Task3/5.
- 새 계약 추가·변경·폐기 및 양쪽 잠금 순서: Task3. 키/모델/권한/lease/사람 처리 회귀: Task3/4.
- 근거 부족 작업의 새 합의 뒤 재확인·실행 중 이벤트 손실 방지·종료 요청 제외: Task4. UI·실행 안내·전체검증: Task5.
- 새 schema·public API를 만들지 않으며 기존 EvidenceCollection과 collect의 기존3인자를 보존한다. Task3/4의 전용 검토 사유는 동일 helper 상수로 공유한다.
- fixture DB는 테스트 후 정리하고 기존 수동 DB를 대상으로 migration을 실행하지 않는다. 표기한 명령은 앞으로 실행할 계획이며 현재의 성공 증거가 아니다.
