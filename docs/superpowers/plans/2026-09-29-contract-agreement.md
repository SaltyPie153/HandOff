# 개발 계약 최초 합의 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP로 제안한 개발 계약을 A·B·필수 PM이 웹에서 버전별로 동의하고, 최초 확정 본문을 프로젝트 팀에 공개한다.

**Architecture:** 같은 NestJS/PostgreSQL 안에 contracts 모듈을 추가한다. 기존 일반 인수인계와 별도 데이터·응답 상태를 사용하며, 인증·프로젝트/MCP 권한 검증을 재사용한다. 계약 행 잠금으로 응답·재전송·확정을 직렬화한다.

**Tech Stack:** Node.js 24 (`>=24.15 <25`), TypeScript, NestJS, Prisma/PostgreSQL, React/MUI, MCP SDK, node:test/Vitest/Playwright. 새 외부 서비스·의존성 없음.

**Spec:** [승인된 1단계 설계](../specs/2026-09-29-contract-agreement-design.md)

## Global Constraints

- 최초 코드 기준은 develop `acc60f1`, 설계 커밋은 `50abdad`, 현재 문서 브랜치는 `feature/contract-agreement`다.
- 모든 셸은 `rtk` 또는 `rtk proxy`를 사용한다. Node24 경로를 확인하고 npm 명령의 실제 런타임을 기록한다.
- 작업 트리9578의 웹5578/API3308/복제 DB55438와 기존 앱·DB, 사용자 `outputs/`를 보존한다. 구현 전 using-git-worktrees로 별도 실행 작업 공간을 준비한다. 현재 웹의 감시 대상 파일을 편집해 수동 시험 앱을 바꾸지 않는다.
- 시험 runner의 전용 DB를 사용한다. 기존 `.env`로 신규 migration·직접 DB 테스트를 실행하지 않는다. 비밀 값·MCP 토큰·DB 복사본을 출력하거나 커밋하지 않는다.
- A·B는 서로 다르며, PM 배열은 각 최대10명이고 역할 간 겹침/중복이 없다. 참여자 모두 전송 시 현재 승인된 프로젝트 멤버다.
- 제목1~160자, 본문1~50,000자, 수정 의견1~10,000자, 재시도 키1~128자. 버전은 양의 정수다. 문자열은 trim 후 빈 값을 거부하고 입력 원문 길이 제한도 적용한다.
- 동의·수정 요청은 사람의 웹 세션+CSRF 전용이다. 송신자도 별도 동의해야 한다. 참조 PM·MCP·관리자가 이를 대신하지 못한다.
- 확정 본문은 현재 팀 전체 공개, 미확정 본문·수정 의견·개인 응답은 버전 참여자만 열람한다. 참가자·응답·비공개 버전 메타데이터도 공개 DTO에서 제외한다.
- 전송 버전은 불변, 새 버전은 이전 동의 승계 없음. 확정 후 변경/철회/폐기·담당자 교체·첨부·Discord·자동 근거 연결은 이번 범위에서 제외한다.
- 제품 명세의 공개 범위 문구는 승인된 설계에 맞춰 명시적으로 갱신한다. 기존 인수인계 확인을 계약 동의로 변환하지 않는다.

## Review Focus

1. 역할 구성 순서만 다른 재시도: 같은 PM 집합은 같은 payload로 판정하며 버전·알림이 늘지 않는다. Task2에서 검사한다.
2. 새 PM이 과거 URL·알림 ID를 알아낸 경우: 자신이 참여하지 않은 비공개 버전·의견·이력을 반환하지 않는다. Task3/4에서 검사한다.
3. 마지막 동의와 새 버전/멤버 제외 경합: 과거·접근 불가 버전이 잘못 확정되지 않고 개인 응답과 확정 알림이 원자적이다. Task2에서 검사한다.
4. 저장 성공 후 네트워크 응답 유실·새 버전 복구: 같은 입력 재시도 키를 유지하고 작성 의견을 보존하되 새 버전에 자동 동의하지 않는다. Task5에서 검사한다.
5. 확정 본문 조회와 목록·MCP 자동 활동 혼동: 목록은 비공개 정보를 노출하지 않고, 본문 감사 기록은 사람 동의·할 일 수를 바꾸지 않는다. Task3/4에서 검사한다.

## 파일 책임

- `apps/api/prisma/schema.prisma`, `migrations/0009_contract_agreement/migration.sql`: 계약·제안·참여자·응답·알림·조회 감사 및 정합성 제약.
- 새 `apps/api/src/contracts/contract-policy.ts`, `contract.types.ts`: 입력 정규화, 상태 규칙, 명시적 DTO.
- 새 `contract.repository.ts`: 제안·재전송·사람 응답의 저장 트랜잭션.
- 새 `contract-query.repository.ts`: 공개/개인 조회, 할 일 집계·알림·읽음과 조회 감사.
- 새 `contract.controller.ts`, `contract-mcp.controller.ts`, `contract.module.ts`: HTTP 경계와 DI. 기존 `apps/api/src/app.module.ts`에 등록.
- 기존 `apps/mcp/src/index.ts`, `transport.ts`: 계약 전용 도구·API 호출.
- 새 `apps/web/src/contracts/api.ts`, `ContractListPage.tsx`, `ContractDetailPage.tsx`, `ContractInboxPage.tsx`, `ContractProposalPage.tsx`, `ContractResponseForm.tsx`, `ContractNotifications.tsx`: 계약 화면. 기존 `App.tsx`와 `projects/ProjectRoomPage.tsx`에 경로·링크만 연결.
- API 단위/통합·MCP·웹·E2E 검사, `specs/006-contract-agreement/quickstart.md`, 제품·검증 문서.

## 공유 인터페이스

Task1의 `contract.types.ts`에서 정의한다. JSON DTO 날짜는 ISO 문자열로 직렬화한다.

```ts
type ProposeContractInput = { recipientId: string; publicTitle: string; proposedBody: string;
  requiredPmIds: string[]; referencePmIds: string[]; idempotencyKey: string };
type ReviseContractInput = { expectedVersion: number; proposedBody: string;
  requiredPmIds: string[]; referencePmIds: string[]; idempotencyKey: string };
type ContractResponseInput = { version: number; action: 'AGREE'|'REQUEST_CHANGES'; comment?: string; idempotencyKey: string };
type ProposalReceipt = { contractId: string; proposalId: string; versionId: string; version: number; createdAt: string };
type ResponseReceipt = { id: string; proposalId: string; version: number; action: 'AGREE'|'REQUEST_CHANGES'; createdAt: string };
type ContractSummary = { needsReview: number; needsChanges: number; unreadNotifications: number };
```

공개 카드는`{id,publicTitle,status:'UNCONFIRMED'|'ACTIVE',confirmedAt:string|null,canOpenProposal:boolean}`만 반환한다. ACTIVE 상세는 공개 카드에`{version,body}`를 추가한다. UNCONFIRMED의 본문 상세는404다.

개인 상세는`{contractId,proposalId,publicTitle,senderId,recipientId,currentVersion,versionId,version,proposedBody,status,blocked,canRespond,canRevise,participants,versions,responses}`다. participants는 대상 버전의`{userId,role,displayName}`, versions는 열람 가능한 버전만의`{version,status,createdAt}`, responses는 대상 버전의`{actorId,action,comment,createdAt}`다. 개인 목록도 열람 가능한 가장 최근 버전만 반환하고 비참여 최신 버전의 본문은 반환하지 않는다.

알림 DTO는`{id,proposalId,version,publicTitle,kind,createdAt,readAt}`. kind는`PROPOSAL_RECEIVED|REVISION_RECEIVED|CHANGES_REQUESTED|CONFIRMED`다. 나머지 DTO와 페이지 문구는 위 필드와 승인된 설계를 기준으로 구현하며 서버에서 Prisma 객체를 그대로 반환하지 않는다.

## Task 1: 데이터 모델과 입력·참여 규칙

**Files:** schema/migration, 새 contract.types.ts·contract-policy.ts, `apps/api/tests/contract-policy.test.ts`, `contract-migration.integration.test.mjs`.

**Interfaces:** `normalizeProposal(senderId, input): ProposeContractInput`, `normalizeRevision(input): ReviseContractInput`, `normalizeResponse(input): ContractResponseInput`; PM 배열 정렬, UUID/중복/역할 검증은 policy에서 수행한다.

- [ ] 정책 실패 검사를 작성한다: 빈/과대 제목·본문·의견, 버전0/소수, 동일 A/B, 중복·겹친 PM, 각11명 PM 거부. PM 순서만 다른 입력의 정규화 결과는 deepEqual이다.
- [ ] `npm run test --workspace @handoff/api`로 실패를 확인한다. Expected: 새 policy 미구현으로 FAIL.
- [ ] 별도 시험 DB의 0008 fixture에 기존 인수인계 응답을 만든 뒤 0009 적용 검사를 작성한다. Expected: 기존 기록 동일, 계약 응답0; 같은 버전 중복 참여·응답, 다른 계약의 현재 버전 참조는 DB에서 거부.
- [ ] 모델을 구현한다: `DevelopmentContract(UNCONFIRMED|ACTIVE,currentVersionId?)`, `ContractProposal(contractId unique,senderId,recipientId,currentVersion,sendKey,payloadHash)`, `ContractProposalVersion(version,status,proposedBody,sendKey,payloadHash,confirmedAt?)`, `ContractParticipant(role)`, `ContractResponse`, `ContractNotification`, `ContractReadAudit(userId,grantId?,versionId,createdAt)`.
- [ ] proposal/version·계약 연결은 복합 FK로 보강한다. 버전 양수, 응답 의견 규칙, 버전/회원 및 알림 수신자/버전/종류 unique를 추가한다. 순환 참조는 테이블 생성 후 FK를 추가한다. 미확정 계약의 currentVersionId는 null이다.
- [ ] `npm run db:generate`, API build와 policy/migration 검사를 실행한다. Expected: 생성·빌드 PASS, 실제 DB 검사 skip0. 해당 파일만 `feat: add contract agreement schema and policy`로 커밋한다.

## Task 2: 제안·재전송·사람 동의 트랜잭션

**Files:** 새 contract.repository.ts, `apps/api/tests/contract-agreement.integration.test.mjs`.

**Interfaces:** `propose(actorId, projectId, grantId, input): Promise<ProposalReceipt>`; `revise(actorId, projectId, proposalId, grantId, input): Promise<ProposalReceipt>`; `respond(actorId, projectId, proposalId, input): Promise<ResponseReceipt>`.

- [ ] 실제 DB 테스트를 작성한다. 핵심 assertions: `responses.count===0` after MCP propose; A/B 동의 후 필수PM 대기면 계약 UNCONFIRMED; 참조PM 미응답 상태에서도 필수PM 동의 후 ACTIVE; `currentVersionId===agreedVersion.id`; 확정 알림은 참여자별1개.
- [ ] 수정 요청 시 이후 새 응답409, 과거 응답 불변, 새 버전 전송 시 응답0·최신IN_REVIEW, 확정 후 재전송409를 검사한다. 같은 키/입력은 동일ID, 다른 입력409. 배열 순서만 다른 재시도도 동일ID다.
- [ ] 동시 마지막 동의·재전송, 동의·수정 요청, 멤버 제외·확정의 경합을 명시적 DB 잠금/Promise 장벽으로 재현한다. 성공한 순서와 맞는 상태·응답·알림만 남아야 한다. 세션권한과 MCP grant 철회도 저장 직전 재검사한다.
- [ ] 격리 환경에서 테스트를 실행한다. Expected: 저장소 미구현으로 FAIL. DB가 없어 skip이면 진행하지 말고 시험 환경을 준비한다.
- [ ] 계약 행을 먼저 잠그고 필수 회원·멤버십을 ID순으로 잠근 뒤 처리한다. 최초 전송은 A+키 기준 advisory lock으로 중복 생성 방지. 유효 권한 확인 후 재시도 조회→payload 확인→최신 상태 검사 순서다.
- [ ] 새 버전·참여 스냅샷·알림, 또는 응답·전원 동의 검사·확정 포인터·알림을 각각 원자적으로 저장한다. 마지막 동의 후 새 버전은 거부한다. 이력과 현재 유효본문을 바꾸는 별도 관리 API를 만들지 않는다.
- [ ] `npm run test:integration`에서 Task1/2와 기존 검사를 실행한다. Expected: PASS, 신규 DB 검사 skip0. `feat: implement atomic contract agreement`로 커밋한다.

## Task 3: 권한별 조회·알림·집계

**Files:** 새 contract-query.repository.ts, `apps/api/tests/contract-access.integration.test.mjs`.

**Interfaces:** `listPublic(viewerId,projectId,activeOnly=false)`, `getPublic(viewerId,projectId,contractId,grantId?)`, `listMine(viewerId,projectId)`, `getProposal(viewerId,projectId,proposalId,version?,grantId?)`, `summary(viewerId,projectId): Promise<ContractSummary>`, `notifications(viewerId,projectId)`, `markRead(viewerId,projectId,notificationId)`.

- [ ] C는 제안 제목만 읽고 미확정 본문404, 확정 후 합의한 본문만 읽는 검사를 작성한다. public JSON에 participants/responses/comment/proposedBody/이전 비공개 버전이 없음을 검사한다.
- [ ] v1참여PM 제거·v2새PM 추가 후 각 사용자가 자신이 참여했던 비공개 버전만 읽는지 검사한다. 프로젝트 제외 시 과거도404. 알림ID를 추측해 다른 회원의 읽음을 바꾸면404다.
- [ ] B동의 후 PM대기에서 B needsReview0/PM1, 수정 요청 후 A needsChanges1/필수참여자 needsReview0, 필수 권한 상실 시 집계0, 참조자 상실 시 검토 가능을 검사한다. 알림 읽음 반복은 readAt을 유지한다.
- [ ] 본문 조회는 정확한 user/grant/version 감사1건, 목록은 감사0건, 어느 조회도 응답·동의·상태를 바꾸지 않는지 검사한다. DB 검사 실행 Expected: FAIL.
- [ ] Task2와 같은 현재 승인·프로젝트 권한을 검사하고 버전별 참여 조건 및 공개 DTO whitelist를 적용한다. 할 일은 최신 버전의 미응답·필수권한 모두 충족 조건으로 계산한다. 감사 저장 실패 시 본문 조회도 실패 처리한다.
- [ ] 관련 실제 DB 검사와 API typecheck 실행 Expected: PASS. `feat: add scoped contract queries and notices`로 커밋한다.

## Task 4: 웹 HTTP·MCP 연결

**Files:** 새 controller/module 세 파일, 기존 app.module.ts, MCP index.ts/transport.ts, `apps/api/tests/contract-http.integration.test.mjs`, `apps/mcp/tests/mcp.test.ts`.

**Interfaces:** 웹 GET `/api/projects/:projectId/contracts`, `contracts/:contractId`, `contract-proposals`, `contract-proposals/:proposalId?version=N`, `contract-summary`, `contract-notifications`; POST `contract-proposals/:proposalId/responses`, `contract-notifications/:id/read`.

MCP POST `/api/mcp/contracts`, `/api/mcp/contract-proposals/:proposalId/versions`; GET `/api/mcp/contract-proposals/:proposalId?version=N`, `/api/mcp/contracts`, `/api/mcp/contracts/:contractId`. MCP GET contracts는 ACTIVE만 반환한다. projectId는 grant에서 검증하며 생성 입력의 projectId와 일치해야 한다.

- [ ] HTTP 실패 검사를 작성한다: 올바른 사람 세션+CSRF만 응답201; MCP bearer401, CSRF없음403, 비참여관리자/타프로젝트/제외회원404; enum·버전·과대입력400; 구버전409; 비공개 GET no-store.
- [ ] 실제 MCP SDK 테스트에서 `propose_contract`, `revise_contract_proposal`, `get_my_contract_proposal`, `list_active_contracts`, `get_contract` 목록·스키마·정확한 URL/payload/키 보존을 검사한다. 동의 도구가 없음을 검사한다. Expected: 신규 라우트/도구 미구현 FAIL.
- [ ] 컨트롤러에서 세션+CSRF 또는 프로젝트 MCP grant를 분리해 Task2/3를 호출한다. MCP transport에 동일 이름의 camelCase 메서드를 추가한다. 네트워크/권한 실패 메시지는 토큰·본문을 포함하지 않는다.
- [ ] `npm run test --workspace @handoff/mcp`, API HTTP 실제 DB 검사, root typecheck 실행 Expected: PASS. `feat: expose contract web and MCP endpoints`로 커밋한다.

## Task 5: 계약 화면·동의·개인 알림

**Files:** 위 파일 책임의 웹 contracts 파일들, App.tsx/ProjectRoomPage.tsx, `apps/web/tests/contract-pages.test.tsx`; 기존 룸 테스트에 URL별 fetch fixture 추가.

**Interfaces:** 각 페이지 props `{projectId}` 또는 `{projectId,contractId}`/`{projectId,proposalId,viewerId}`. API 함수는 Task4 경로와 Task1 DTO를 사용한다. 라우트는 `/projects/:id/contracts`, `/contracts/:contractId`, `/contract-inbox`, `/contract-proposals/:proposalId`.

- [ ] 실패 UI 검사를 작성한다: A에게도 동의 버튼, 참조/과거/종료버전에는 버튼 없음; 전원 동의 전 공개될 본문 안내문 표시; PM대기와 내응답완료 구분; C확정상세에 의견/개인응답 없음.
- [ ] 네트워크 응답 유실 후 동일 입력 재시도 키 동일, 성공 뒤 새 행동은 새 키, 409→최신 버전 로드 후 의견 유지 및 자동 전송 없음, 늦은 과거 fetch가 최신화면을 덮지 않음을 검사한다. 읽음은 동의 호출을 하지 않는다. Expected: `npm run test --workspace @handoff/web` FAIL.
- [ ] 공개목록/확정본문과 비공개 제안화면을 분리한다. React 텍스트 렌더링으로 본문을 표시하고 원시 HTML을 실행하지 않는다. 응답 폼의 의견 상태는 부모에서 요청별로 유지한다. 서버 canRespond/canRevise와 역할 안내를 사용한다.
- [ ] 계약 전용 알림·할 일과 MCP 재전송 안내(제안ID·현재버전)를 제공한다. 조회 실패를0건/빈목록으로 속이지 않고 오류와 재시도를 표시한다.
- [ ] 웹 전체 test와 build 실행 Expected: PASS. `feat: add contract agreement screens`로 커밋한다.

## Task 6: 전체 흐름·문서·최종 검증

**Files:** `tests/e2e/contract-agreement.spec.ts`, `specs/006-contract-agreement/quickstart.md`, docs/product/spec.md·technical-design.md, docs/harness/checks.md·decisions.md, work/contract-agreement/resume.md.

- [ ] 격리 A/B/필수PM/C 브라우저 E2E를 작성한다. MCP제안→B수정요청→A새버전→A/B동의→PM대기→PM동의→C확정본문 조회를 검사한다. 새로고침 후 상태·알림 유지, C비공개 URL404, 과거 응답409, 확정후 재전송409를 포함한다.
- [ ] Node24에서 `npm run build`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run test:e2e` 실행 Expected: 모두 exit0. 포트 충돌 시 기존 프로세스를 종료하지 않는다. 시험 전용 실행환경만 조정하고 기록한다.
- [ ] Quickstart에 MCP입력·동의/공개범위·PM상태·사용자검증 순서를 기록한다. 제품 명세의 모호한 확정본문 공개 문구를 사용자 결정으로 명확히 하고 R07/R09/R12/R17/R18/R29의 실제 구현 부분만 갱신한다. R08/R13/R15/R16/R19의 후속 범위는 완료로 표시하지 않는다.
- [ ] `pwsh -NoProfile -File scripts/check-harness.ps1`, `pwsh -NoProfile -File scripts/test-harness.ps1`, `git diff --check` 실행 Expected: PASS. Harness와 제품 검사 결과를 구분한다.
- [ ] executing-plans의 최종 독립 리뷰에서 Review Focus와 문서·실제 diff를 검사한다. 중요한 결함은 RED→GREEN으로 수정하고 영향을 받는 검사만 재실행한다.
- [ ] 문서·검증 결과를 커밋하고 resume에 명령·종료코드·커밋·미검증을 남긴다. 실제 OAuth/Solar/운영 배포를 확인했다고 보고하지 않는다. push/PR/merge는 별도 요청 전 하지 않는다.

## 자체 검토

- 승인된 설계의 모델·동의·참여자·공개·MCP감사·집계·알림·웹·이전·시험을 Tasks1~6에 대응시켰다.
- 확정계약과 일반 인수인계는 별도 모델·endpoint이며 일반 handoff worker는 수정할 필요가 없다.
- payload의 projectId는 controller/grant에서, senderId는 자격에서 가져와 임의 송신자 지정과 다른 프로젝트 접근을 막는다.
- read DTO와 변경 DTO를 분리했으며 새 PM의 과거 접근·필수 이탈·참조 이탈의 차이를 명시했다.
- 별도 구현 작업 공간과 시험 DB를 사용해 현재 사용자 시험 환경을 보호한다. 직접 구현 후 전체 독립 리뷰 방식으로 진행하는 것을 권장한다.
