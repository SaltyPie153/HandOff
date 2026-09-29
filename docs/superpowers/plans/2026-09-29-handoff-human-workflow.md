# 사람 처리 흐름 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일반 인수인계에서 사람이 버전별 확인·수정 요청을 하고, 송신자 MCP가 새 버전을 전송하며, 당사자가 웹 알림과 처리 상태를 확인한다.

**Architecture:** 기존 요청과 불변 버전을 유지하면서 사람 응답·웹 알림을 추가한다. 요청 행 잠금으로 응답·재전송·자동 게시를 조정하고 공개 회신과 배경 작업을 버전에 연결한다. 기존 API 응답 필드는 유지하고 새 필드는 추가한다.

**Tech Stack:** Node.js 24 (`>=24.15 <25`), NestJS, Prisma/PostgreSQL, React/MUI, MCP SDK, node:test/Vitest/Playwright. 신규 의존성 없음.

**Spec:** [승인된 설계](../specs/2026-09-29-handoff-human-workflow-design.md)

## Global Constraints

- 최초 기준 커밋은 `56419a0`, 작업 브랜치는 `codex/handoff-human-workflow`다.
- 모든 셸 명령은 `rtk` 또는 `rtk proxy`를 사용한다.
- 요청 본문·수정 의견·버전별 응답은 현재 프로젝트 멤버인 A·B만 읽는다.
- 사람 응답은 웹 세션+CSRF로만 저장한다. MCP 전송과 공개 회신은 사람 확인 완료가 아니다.
- 전송한 본문·자동 확인 문구는 불변이며 새 버전은 확인 기록을 승계하지 않는다.
- 새 버전은 A의 MCP로 전송하며 제목·프로젝트·송신자·수신자는 유지한다.
- 수정 의견은 1~10,000자, 본문은 1~50,000자, verificationClaim은 단일 줄 1~500자 또는 null, 재시도 키는 1~128자다.
- 실제 키·개발 DB·기존 로컬 프로세스와 `outputs/handoff-spec-eli5-v1.3.html`을 보존한다.
- 계약 합의/PM/Discord/첨부/관리 종료는 이번 완료 기준에 포함하지 않는다.

## Review Focus

1. DB 저장 후 응답 유실: 같은 키는 기존 결과를 돌려주고 알림·응답·버전이 증가하지 않는다. Task 2에서 시험한다.
2. v1 처리 중 v2 도착: 늦은 자동 실행은 새 버전을 변경하거나 게시하지 않는다. Task 3에서 시험한다.
3. 멤버 제외 및 역할 혼동: 프로젝트 관리자·C·MCP 토큰으로 B의 사람 응답을 대행하지 못한다. Task 4에서 시험한다.
4. 브라우저의 오래된 상태: 409 후 입력 의견을 보존하고 과거 버전에 응답하지 않는다. Task 5에서 시험한다.
5. 기존 데이터의 잘못된 확인 승계: 자동 작업 완료·공개 회신이 있는 v1도 사람 확인 대기로 이전한다. Task 1에서 시험한다.

## 파일 책임

- `apps/api/prisma/schema.prisma`, `migrations/0008_handoff_human_workflow/migration.sql`: 상태·응답·알림·버전 연결과 기존 데이터 이전.
- 새 `apps/api/src/handoff/handoff-workflow.ts`: 입력·상태 규칙과 DTO 타입.
- 새 `apps/api/src/handoff/handoff-workflow.repository.ts`: 사람 응답·재전송·알림의 트랜잭션.
- 기존 `handoff.repository.ts`: 최초 전송과 버전별 조회·공개 회신 연결.
- 기존 `background-worker.ts`: 버전별 작업과 게시 직전 동시성 검사.
- 새 `handoff-workflow.controller.ts`, 기존 `handoff.controller.ts`/`handoff.module.ts`: 웹 처리·알림, MCP 재전송 라우팅.
- 기존 `apps/mcp/src/index.ts`/`transport.ts`: `resend_request` 도구.
- 새 `apps/web/src/handoff/HandoffResponseForm.tsx`, `HandoffNotifications.tsx`: 사람 응답 폼과 개인 알림.
- 기존 상세·받은함·피드·프로젝트 룸: 버전 선택·처리 상태·할 일 집계.
- API 통합, 웹, MCP, E2E 테스트와 Quickstart: 수용 기준 검증.

## Task 1: 데이터 모델과 기존 데이터 이전

**Files:** schema.prisma와 새 0008 migration; 새 `apps/api/tests/handoff-migration.integration.test.ts`; 기존 handoff/worker/evidence/agent-key 통합 테스트 fixture.

**Interfaces:**
- `HandoffVersionStatus = AWAITING_REVIEW | ACKNOWLEDGED | CHANGES_REQUESTED | SUPERSEDED`.
- `HandoffResponseAction = ACKNOWLEDGE | REQUEST_CHANGES`.
- `HandoffRequest.currentVersion: number`, 버전 `status`.
- `HandoffResponse`: id, requestId, versionId, actorId, action, comment?, responseKey, payloadHash, createdAt. unique(versionId, actorId), unique(requestId, actorId, responseKey).
- 버전의 전송 키·해시: nullable legacy 값, unique(requestId, sendKey). v1의 기존 요청 전송 키는 기존 위치에서 계속 검증한다.
- `HandoffReply.versionId`와 관계 추가. `HandoffJob.versionId`를 PK로 하고 requestId와 다대일 관계를 유지한다.
- `HandoffNotification`: id, recipientId, projectId, requestId, versionId, kind(REQUEST_RECEIVED/REVISION_RECEIVED/ACKNOWLEDGED/CHANGES_REQUESTED), createdAt, readAt. unique(recipientId, versionId, kind).

- [ ] 이전 0007까지 적용한 격리 DB fixture에서 자동 회신과 COMPLETED job이 있는 요청을 만든 뒤 migration 후 검증하는 실패 테스트를 작성한다: `version.status === 'AWAITING_REVIEW'`, `responses.count === 0`, 기존 회신 내용 동일, reply/job.versionId === v1.id. 여러 버전이 있는 legacy fixture는 명확한 migration 오류를 기대한다.
- [ ] Node24 및 Docker 가용성을 확인하고, 격리 시험 DB에서 실패를 확인한다. 운영/개발 DB에 migration을 실행하지 않는다.
- [ ] SQL 트랜잭션에서 legacy 전제 검사→컬럼/enum/테이블 추가→v1 연결→NOT NULL/FK/unique/check 제약 순으로 구현한다. currentVersion·version은 양수, 응답 의견 규칙과 같은 요청의 version 연결을 DB 제약으로 보강한다.
- [ ] Prisma 생성과 API typecheck를 실행한다. 기존 단일 job 접근은 최신 버전 job을 선택하도록 수정하고 fixture를 새 키에 맞춘다.
- [ ] migration 시험 통과 후 Task 1 파일만 커밋한다.

## Task 2: 사람 응답·재전송·알림 트랜잭션

**Files:** 새 workflow 규칙/저장소, 기존 handoff.repository.ts; 새 `apps/api/tests/handoff-workflow.test.ts`, `handoff-workflow.integration.test.ts`.

**Interfaces:**
- `ResponseInput = { version: number; action: HandoffResponseAction; comment?: string; idempotencyKey: string }`.
- `RevisionInput = { expectedVersion: number; privateBody: string; verificationClaim?: string | null; idempotencyKey: string }`.
- `respond(actorId: string, projectId: string, requestId: string, input: ResponseInput): Promise<HandoffResponse>`.
- `resend(senderId: string, projectId: string, requestId: string, grantId: string, input: RevisionInput): Promise<{ id: string; version: number; versionId: string; createdAt: Date }>`.
- `summary(viewerId, projectId): Promise<{ needsReview: number; needsChanges: number; unreadNotifications: number }>`.
- `notifications(viewerId, projectId): Promise<NotificationView[]>`; `markRead(viewerId, projectId, notificationId): Promise<{ id: string; readAt: Date }>`.
- `NotificationView`: id, requestId, version, publicTitle, kind, createdAt, readAt. 본문/수정 의견 없음.

- [ ] 실패 테스트: v1 수정 요청 후 A 알림 하나; 동일 응답 재시도 id 동일; 같은 키 다른 내용 409; 다른 키로 응답 변경 409; A가 v2를 전송하면 v1 SUPERSEDED/v2 AWAITING_REVIEW; 확인된 v1을 재전송하면 v1 ACKNOWLEDGED 보존; 새로운 v2 응답 가능.
- [ ] 실패 테스트: 동시 동일 키 재전송은 v2 하나와 B 알림 하나; 다른 키 expectedVersion=1 경쟁에서는 한 번만 성공. 응답·재전송 경쟁은 잠금 획득 순서에 맞는 유효 결과와 원자적 알림만 남는다. 저장 결과 응답 유실을 재시도로 재현한다.
- [ ] `rtk proxy npm run test --workspace @handoff/api`와 격리 통합 runner에서 해당 실패를 확인한다. DB가 필요한 테스트의 skip은 성공 증거로 쓰지 않는다.
- [ ] 요청 행을 `SELECT ... FOR UPDATE`로 잠근 후 현재 A·B 멤버십, actor, grant, payload와 상태를 재검사한다. 일치하는 재시도는 현재 권한 확인 뒤 기존 결과를 반환한다. 재전송 payload 해시에 expectedVersion을 포함한다.
- [ ] 응답·상태·알림 생성, 또는 새 버전·currentVersion·job·알림 생성을 한 트랜잭션으로 구현한다. 새 버전은 grantId를 해당 재전송에 사용한 유효 권한에 맞춰 기록한다. 이전 처리의 executionId와 lease를 무효화한다.
- [ ] 최초 요청 시 B의 REQUEST_RECEIVED 알림도 같은 트랜잭션에 추가한다. 읽음은 반복해도 최초 readAt을 유지한다. 알림/집계 조회는 현재 멤버십으로 제한한다.
- [ ] API 단위·격리 DB 통합 통과 후 커밋한다.

## Task 3: 자동 확인과 공개 회신을 버전별로 격리

**Files:** background-worker.ts, handoff.repository.ts; 기존 `handoff-worker.integration.test.ts`, `handoff.integration.test.ts`, `agent-key.integration.test.ts`.

**Interfaces:** `claimNext(): Promise<{ requestId: string; versionId: string; executionId: string } | null>`; 자동 publish는 requestId/versionId/executionId가 모두 현재 작업과 일치해야 한다. `publishReply` 입력에 `version: number`를 추가한다.

- [ ] 실패 테스트: agent 응답을 Promise로 지연시킨 뒤 v2를 전송하거나 B가 v1을 확인한다. 지연된 결과의 공개 회신 수는 0이고 최신 상태는 유지돼야 한다.
- [ ] 실패 테스트: v1의 사람 공개 회신을 만든 뒤 v2의 유효 근거 자동 확인은 v2 회신 하나를 게시한다. 동시 worker 실행도 하나만 게시한다. 공개 회신 게시만으로 version 상태·사람 응답 수는 바뀌지 않는다.
- [ ] 실패 확인 후 worker 조회·갱신 조건을 versionId로 바꾸고 request.currentVersion과 AWAITING_REVIEW 상태를 검사한다. 과거 사람 회신은 같은 버전의 자동 게시에만 영향을 준다.
- [ ] publish에서 Task 2와 같은 요청 잠금을 사용한다. 실행권·근거·grant·멤버십 재검사를 유지한다. 공개 회신 API에는 기대 버전 검증을 추가하고 오래된 화면의 게시를 409로 거부한다.
- [ ] 관련 worker·키·회신 통합 테스트 통과 후 커밋한다.

## Task 4: 웹 API와 MCP 도구 연결

**Files:** 새 handoff-workflow.controller.ts, 기존 handoff.controller.ts/handoff.module.ts/handoff.repository.ts; MCP index.ts/transport.ts; 새 `handoff-workflow-http.integration.test.ts`, 기존 MCP tests/mcp.test.ts.

**Interfaces:**
- 웹 `POST .../requests/:requestId/responses` → Task 2.respond; `GET .../requests/:requestId/versions/:version` → 당사자 전용 과거 상세.
- `GET /api/projects/:projectId/handoff-summary`, `GET .../notifications`, `POST .../notifications/:notificationId/read`.
- 기존 inbox `?direction=received|sent` (생략하면 기존 전체); 배열 각 원소에 currentVersion/status 추가.
- 상세 DTO: 기존 필드 + currentVersion, versionId, status, response, versions({version,status,createdAt}[]), canRespond. response는 action/comment/actorId/createdAt만 제공한다.
- MCP `POST /api/mcp/requests/:requestId/versions`와 `resend_request` → Task 2.resend. `HandoffApiClient.resendRequest({requestId, ...RevisionInput}): Promise<unknown>`.

- [ ] HTTP 실패 테스트: A/C/프로젝트 관리자/MCP bearer의 사람 응답 시도를 거부; B 세션이라도 CSRF 없으면 403; 타 프로젝트/미배정/제외된 회원은 차단; 빈 의견·소수 버전·과대 입력은 400; 오래된 버전은 409.
- [ ] HTTP 실패 테스트: C의 피드에는 response/comment/status/versions가 없음. C는 알림 ID를 알아도 A의 읽음을 변경하지 못한다. 상세·과거 버전·알림에는 Cache-Control no-store.
- [ ] MCP 전송 테스트에 resend_request의 스키마·요청 경로·expectedVersion·키 보존을 추가하고 실패를 확인한다.
- [ ] 명시한 경로를 연결하고 enum/정수/UUID/길이를 검증한다. 사람 응답은 기존 session/CSRF 정책, 재전송은 프로젝트 범위의 MCP grant를 사용한다.
- [ ] 피드에서 기존 senderId/recipientId 노출도 제거한다. 프런트 상세 링크 판단은 별도 불리언 canOpen으로 제공해 비당사자에게 참여자를 노출하지 않는다.
- [ ] API/MCP 단위 및 HTTP 통합 테스트 통과 후 커밋한다.

## Task 5: 웹 처리 화면·버전 이력·개인 알림

**Files:** 새 HandoffResponseForm.tsx/HandoffNotifications.tsx, 기존 handoff/api.ts/HandoffRequestPage.tsx/HandoffInboxPage.tsx/HandoffFeedPage.tsx, projects/ProjectRoomPage.tsx. 새 `apps/web/tests/handoff-workflow.test.tsx`; 기존 handoff-pages/project-pages 테스트 갱신.

**Interfaces:** API 함수 `respondToRequest`, `loadRequestVersion`, `loadHandoffSummary`, `loadNotifications`, `markNotificationRead`. 모든 변경 함수는 CSRF와 안정된 idempotencyKey를 사용한다. 알림 컴포넌트 props는 `{ projectId: string }`.

- [ ] 실패 테스트: B의 최신 확인 대기에서만 버튼 활성화; 수정 의견 필수; A/C/과거 버전에는 버튼 없음; 공개 회신 게시 후 확인 대기 유지; 409와 네트워크 오류 후 작성 의견 유지.
- [ ] 실패 테스트: 같은 입력 재시도는 같은 키, 성공 뒤 새 동작은 새 키. 확인 완료 버튼에서 개발 완료로 오해할 문구 없음. 받은함/보낸함 필터 및 확인 필요/수정 필요 숫자가 서버 집계와 일치.
- [ ] 실패 테스트: 알림 읽음은 버전 확인 상태를 바꾸지 않음. 버전 변경 중 이전 fetch 결과가 최신 화면을 덮어쓰지 않음.
- [ ] `rtk proxy npm run test --workspace @handoff/web`에서 실패를 확인하고 컴포넌트/API 타입을 구현한다. 요청 상세에는 버전 선택·비공개 응답·공개 회신을 구분해 표시한다.
- [ ] 수정 필요 화면에 request ID·현재 버전과 Codex 재전송 안내를 제공한다. 받은함과 프로젝트 룸에서 할 일·알림으로 접근한다. API 실패는 빈 목록/0건으로 표시하지 않는다.
- [ ] 웹 테스트와 typecheck 통과 후 커밋한다.

## Task 6: 전체 흐름·문서·최종 검증

**Files:** 새 `tests/e2e/handoff-workflow.spec.ts`, 새 `specs/005-handoff-human-workflow/quickstart.md`, docs/harness/checks.md, docs/product/technical-design.md, work/human-workflow/resume.md. 시험 포트 충돌이 확인될 때에만 기존 test runner/Playwright config/fixture에 공통 포트 설정을 추가하고 scripts/tests/test-runners.test.mjs로 검증한다.

- [ ] 격리 DB·세 브라우저 A/B/C로 MCP v1→B 비공개 수정 요청→A 알림→MCP v2→B 확인 완료→A 알림을 검증한다. C는 공개 제목·회신만 볼 수 있어야 한다. 새로고침 후에도 상태·이력·읽음이 보존돼야 한다.
- [ ] 이전 버전 URL과 오래된 B 탭에서 응답을 시도해 차단을 확인한다. 토큰 해제·멤버 제외 뒤 재전송/응답/알림 접근을 검사한다.
- [ ] Node24에서 `rtk proxy npm run build`, `rtk proxy npm run typecheck`, `rtk proxy npm test`, `rtk proxy npm run test:integration`, `rtk proxy npm run test:e2e`를 실행한다. 실패 시 원인을 해결한 뒤 영향 범위만 재검증한다.
- [ ] `rtk proxy pwsh -NoProfile -File scripts/check-harness.ps1`와 `scripts/test-harness.ps1` 실행. 통합/E2E는 자동 확인 mock을 사용하며 실제 Solar·OAuth·Discord 검증으로 보고하지 않는다.
- [ ] Quickstart에 A/B/C 수동 확인·MCP 재전송 입력·기대 상태와 웹 알림을 기록한다. 검증 기준은 실제 통과한 일반 인수인계 부분만 갱신한다.
- [ ] 최종 diff, 비밀 값 제외, 사용자 파일 보존을 확인하고 독립 리뷰 후 필요한 수정만 검증한다. push/PR/merge는 별도 요청 전 실행하지 않는다.
- [ ] 최종 커밋과 resume 기록에 실제 명령·종료 코드·미검증을 남기고 결과를 보고한다.

## 자체 검토

- 설계의 상태 전환, 비공개 의견, 웹 알림, MCP 재전송, 과거 이력, 동시성, migration, 자동 작업 버전 격리는 Tasks 1~6에 배정했다.
- 범위상 추가 기능을 넣지 않으며 기존 피드 참여자 노출은 승인된 공개 범위를 지키기 위한 수정이다.
- 구현 중 시그니처·스키마 이름의 사소한 변경은 호출부와 테스트를 함께 갱신한다. 제품 동작·권한·범위 변경은 설계 변경으로 드러낸다.
- 계획 검토 승인 전 제품 구현·의존성 설치를 시작하지 않는다.

## 실행 결과 (2026-09-29)

Tasks 1~6의 제품 구현과 검증을 완료했다. 위 목록은 원래 작업 순서이며 실제 실행 차이는 다음과 같다.

- 신규 DB 검사는 `.integration.test.mjs`로 작성하고 통합 runner의 순차 실행 대상에 포함했다. 규칙 검사는 저장소·HTTP 통합에서 함께 수행했다.
- Notification의 프로젝트는 요청 관계로 조회해 중복 projectId 저장을 피했다.
- 스키마·작업·조회 코드가 함께 컴파일돼야 하므로 전체 검증 후 하나의 기능 커밋으로 묶었다.
- 기존 AgentKeyExceptionFilter의 초기화 전 adapter 캡처 때문에 403이 500이 되는 문제를 HTTP 테스트로 재현하고 HttpAdapterHost 참조로 수정했다.
- 독립 리뷰의 중요 항목 2개(최신 버전 로드 시 의견 유실, 상대 권한 상실 후 할 일 집계)와 경미 항목 1개(공개 회신 성공 후 키 재사용)를 실패 테스트로 재현한 뒤 수정했다. 다른 키 재전송 및 응답/재전송 경합도 추가 검증했다.

### 실제 실행

Node.js v24.19.0을 사용했다. 작업용 `rtk proxy powershell -NoProfile -File work/human-workflow/node24.ps1`이 Node24 경로를 설정해 npm CLI를 호출한다. 아래 최종 실행은 모두 종료 코드 0이다.

| 명령 | 결과 |
|---|---|
| `npm ci` | 설치 완료, 감사 취약점 0 |
| `npm run build`, `npm run typecheck` | API·웹·MCP 통과 |
| `npm test` | 스크립트23·API57·웹45·MCP3 통과. DB 의존23개는 이 명령에서 skip |
| `npm run test:integration` | 실제 격리 DB에서 기존 검사 및 신규 migration/worker/workflow/HTTP 통과 |
| `npm run test:e2e` | 전체 10개 통과 |
| 리뷰 수정 후 API `build`, 웹 `build`·`test` | 빌드 및 웹46개 통과 |
| 리뷰 수정 후 `node --env-file=.env --test --test-concurrency=1 apps/api/tests/handoff-workflow.integration.test.mjs apps/api/tests/handoff-workflow-http.integration.test.mjs` | 격리 DB 2개 통과 |
| 리뷰 수정 후 `node node_modules/@playwright/test/cli.js test handoff-workflow.spec.ts handoff.spec.ts` | 관련 E2E2개 통과 |
| `pwsh -NoProfile -File scripts/check-harness.ps1` | 14개 파일·40개 링크 PASS, PRODUCT NOT_RUN |
| `pwsh -NoProfile -File scripts/test-harness.ps1` | 18개 시나리오 PASS |
| `git diff --check` | 통과 |

중간 실패는 미래 버전 요청의 P2025, 기존 회신 fixture의 version 누락(400), 예외 필터의 500, 리뷰의 의견 유실·집계·키 문제였다. 수정 후 관련 검사를 통과했다. Vitest 루트 직접 호출은 패키지 경로가 없어 실패했고 워크스페이스 npm 명령으로 실행했다.

남은 경고: 웹 번들 약504 kB로 Vite의500 kB 안내, pg 동시 query 사용 중단 예정 안내. 실제 OAuth·Solar·Discord 호출과 운영 배포·복구는 이번 검증에 포함되지 않는다. 기존 키·개발 DB·5175 앱·사용자 산출물은 보존했다. push·PR·merge는 별도 요청 범위다.
