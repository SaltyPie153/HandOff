# MCP Private Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex가 사용자별 MCP 권한으로 비공개 요청을 전송하고, 팀은 제목·게시 회신을 공유하며, 서버는 최신 명시 근거에 한해 자동 사실 회신한다.

**Architecture:** Nest API와 PostgreSQL이 요청·권한·감사·작업의 원본이다. 사용자 Codex의 stdio MCP 도구는 범위가 제한된 토큰으로 API를 호출한다. 서버 작업은 등록된 HandOff·GitHub·로컬 스냅샷 근거를 읽고 검증된 경우에만 공개 회신하며, 그 밖에는 B의 웹 검토로 보낸다.

**Tech Stack:** Node.js 24, TypeScript, NestJS 12, Prisma 7/PostgreSQL 17, React 19/MUI, MCP TypeScript SDK, OpenAI Agents API(연동 검증 후).

**Spec:** [MCP 요청과 근거 기반 회신 설계](../../superpowers/specs/2026-09-29-mcp-private-handoff-design.md)

## Global Constraints

- 요청 제목·게시 회신은 프로젝트 팀 공개; 본문·첨부·비공개 버전은 A/B 및 해당 계약의 명시적 참여자만 조회.
- Codex 자동 전송·사실 회신은 인수인계 확인 완료나 계약 동의가 아니다. 해당 상태 변경 권한을 MCP/배경 자격에 주지 않는다.
- 로컬 근거는 B가 지정한 경로만 동기화하고 마지막 성공 동기화 후 24시간 이내·미동기화 변경 없음일 때만 자동 판정에 사용한다.
- 재시도로 요청·배경 실행·공개 회신이 중복되지 않아야 한다. 서버에서 현재 가입 승인·멤버십·권한을 매번 확인한다.
- 기존 `.env`, OAuth Secret, API 키, 동기화된 계약 원문을 로그·테스트 출력·Git에 넣지 않는다.

## Review Focus

- 프로젝트 멤버가 요청 ID를 추측해도 본문·첨부·B 초안이 404로 숨겨져야 한다. Task 2 통합 테스트.
- A/B가 프로젝트에서 제외되거나 MCP 연결을 해제한 직후 같은 토큰·배경 작업이 전송·게시할 수 없어야 한다. Task 2/6 통합 테스트.
- 전송 또는 회신 저장 직후 응답이 유실돼 재시도해도 DB 행과 공개 피드 항목은 한 개여야 한다. Task 1/6 통합 테스트.
- 오래된 로컬 스냅샷과 상충하는 GitHub/HandOff 근거는 자동 게시되지 않아야 한다. Task 5/6 판정 테스트.
- 공개 제목과 회신은 공개되지만, API 오류·로그·MCP 결과에서 비공개 본문과 자격 증명이 노출되지 않아야 한다. Task 2/3/7 테스트.

---

### Task 1: 요청·공개 회신의 저장 모델

**Files:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/0004_mcp_handoff/migration.sql`, `apps/api/src/handoff/handoff.repository.ts`, `apps/api/src/handoff/handoff.types.ts`, `apps/api/tests/handoff.integration.test.ts`.

**Interfaces:** `createRequest(senderId, projectId, {recipientId, publicTitle, privateBody, idempotencyKey})`; `listFeed(viewerId, projectId)`; `getPrivateRequest(viewerId, requestId)`; `publishReply(actorId, requestId, {body, source, idempotencyKey})`.

- [ ] **Step 1:** 통합 테스트에 승인된 A/B와 비당사자 C를 만들고, 전송 키 재시도 1건, 공개 피드 제목·회신, C의 본문 차단, B의 미게시 초안 차단을 먼저 단언한다.
- [ ] **Step 2:** 집중 통합 테스트를 실행해 모델·메서드 부재로 실패하는 것을 확인한다.
- [ ] **Step 3:** 요청·불변 첫 버전·회신·감사·배경 이벤트와 유니크 전송 키를 migration에 추가하고 repository 메서드를 구현한다. 제목과 비공개 본문은 서로 다른 조회 투영을 사용한다.
- [ ] **Step 4:** 집중 통합 테스트와 `npm run db:generate`, `npm run typecheck`를 통과시킨다.
- [ ] **Step 5:** 모델·repository·테스트만 커밋한다.

### Task 2: 세션 API와 프로젝트별 MCP 자격

**Files:** `apps/api/src/handoff/handoff.controller.ts`, `apps/api/src/handoff/handoff.service.ts`, `apps/api/src/handoff/handoff.module.ts`, `apps/api/src/auth/mcp-grant.ts`, `apps/api/src/app.module.ts`, `apps/api/tests/handoff.integration.test.ts`.

**Interfaces:** 웹 세션 `GET /api/projects/:id/feed`, `GET /api/projects/:id/requests/:requestId`, `GET /api/projects/:id/inbox`, `POST /api/projects/:id/requests/:requestId/replies`; MCP bearer `POST /api/mcp/requests`; 웹 세션 `POST/DELETE /api/mcp/grants`.

- [ ] **Step 1:** HTTP 통합 테스트로 CSRF, 토큰 해시 저장·원문 1회 반환, 프로젝트 제한, 만료·철회, 미배정·미승인·비당사자 차단, 본문 비노출을 먼저 단언한다.
- [ ] **Step 2:** 집중 HTTP 통합 테스트의 실패를 확인한다.
- [ ] **Step 3:** 세션과 bearer의 인증 경계를 나누고 현재 사용자 상태·멤버십을 매 호출에서 재검사한다. `POST /api/mcp/requests`만 자동 전송 범위로 허용하며 확인·동의 API를 노출하지 않는다.
- [ ] **Step 4:** 집중 통합 테스트와 타입 검사를 통과시킨다.
- [ ] **Step 5:** API·자격·테스트만 커밋한다.

### Task 3: 사용자 Codex용 MCP 도구

**Files:** `apps/mcp/package.json`, `apps/mcp/src/index.ts`, `apps/mcp/src/transport.ts`, 루트 `package.json`, `package-lock.json`, `apps/mcp/tests/mcp.test.ts`, `specs/004-mcp-handoff/quickstart.md`.

**Interfaces:** stdio MCP 도구 `send_request({projectId, recipientId, publicTitle, privateBody, idempotencyKey})`, `list_my_projects()`, `get_my_request({requestId})`. 자격은 프로세스 환경의 `HANDOFF_MCP_TOKEN`과 `HANDOFF_API_ORIGIN`에서 읽는다.

- [ ] **Step 1:** 모의 API를 둔 MCP 도구 테스트에서 인수 파싱·bearer 전달·비공개 결과의 범위·중복 키·안전한 실패 메시지를 먼저 단언한다.
- [ ] **Step 2:** 테스트 실패를 확인한 뒤 고정 버전의 MCP SDK로 stdio 도구를 구현한다.
- [ ] **Step 3:** 빌드·집중 테스트를 통과시키고 Quickstart에 Codex 연결·토큰 보관·철회 절차를 기록한다.
- [ ] **Step 4:** 도구·문서·테스트만 커밋한다.

### Task 4: 제목·회신 피드와 당사자 화면

**Files:** `apps/web/src/projects/ProjectRoomPage.tsx`, `apps/web/src/handoff/{FeedPage,InboxPage,RequestPage,ReplyReviewPage,api}.tsx/ts`, `apps/web/src/App.tsx`, `apps/web/tests/handoff-pages.test.tsx`, `tests/e2e/handoff.spec.ts`.

**Interfaces:** 공개 피드에서 제목·게시 회신만; 당사자 상세에서 본문·버전; B의 비공개 검토에서 회신 미리보기 후 게시; 설정에서 MCP 자격 발급·철회.

- [ ] **Step 1:** 웹 테스트와 두 사용자 E2E에서 C는 제목·게시 회신만, A/B는 본문, B만 미게시 검토를 볼 수 있음을 먼저 단언한다.
- [ ] **Step 2:** 집중 테스트 실패를 확인한다.
- [ ] **Step 3:** 현재 MUI·라우트 패턴에 맞춰 API 래퍼와 화면을 구현한다. 공개 게시 전 대상·내용을 보여준다.
- [ ] **Step 4:** 웹 테스트와 집중 E2E를 통과시킨다.
- [ ] **Step 5:** 웹·테스트만 커밋한다.

### Task 5: 등록 근거와 로컬 파일 동기화

**Files:** `apps/api/src/evidence/{evidence.repository,evidence.service,evidence.controller,evidence.types}.ts`, `apps/api/prisma/schema.prisma`, 새 migration, `scripts/sync-evidence.mjs`, `apps/api/tests/evidence.integration.test.ts`, `scripts/tests/evidence-sync.test.mjs`.

**Interfaces:** B가 프로젝트·경로별로 허용한 로컬 파일만 업로드; GitHub 저장소/파일 범위는 읽기 전용으로 등록; HandOff 확정 계약 어댑터는 실제 확정본만 반환. `collectEvidence(recipientId, requestId)`는 원문·종류·버전/해시·동기화 시각을 반환한다.

- [ ] **Step 1:** 세 근거 종류, 허용되지 않은 경로 차단, 해시·시각 기록, 지정 해제, 24시간 경계와 미동기화 변경 플래그를 테스트한다.
- [ ] **Step 2:** 실패를 확인한 뒤 DB·API·지정 파일만 읽는 로컬 커넥터와 읽기 전용 GitHub 조회를 구현한다. 확정 계약이 아직 없으면 그것을 확정 근거로 위장하지 않는다.
- [ ] **Step 3:** 집중 통합·스크립트 테스트와 타입 검사를 통과시킨다.
- [ ] **Step 4:** 근거·커넥터·테스트만 커밋한다.

### Task 6: 근거 판정과 PC 독립 배경 작업

**Files:** `apps/api/src/handoff/{reply-decision,background-worker,agent-runner}.ts`, `apps/api/tests/handoff-worker.integration.test.ts`, `apps/api/tests/reply-decision.test.ts`, `apps/api/src/main.ts`.

**Interfaces:** `decideReply(request, evidence[]) -> AUTO_REPLY | REVIEW_REQUIRED`; `processPendingJobs()`는 lease/재시도 키로 한 요청 버전을 한 번 처리한다. 관리형 Agents API 어댑터는 API 키가 설정된 경우에만 쓰고, 테스트는 모의 어댑터를 주입한다.

- [ ] **Step 1:** 최신 명시 근거의 직접 일치, 부재·충돌·추론·만료, 동시 worker, 멤버십 제거·자격 철회, 응답 유실 재시도를 테스트한다.
- [ ] **Step 2:** 판정·작업 통합 테스트의 실패를 확인한다.
- [ ] **Step 3:** DB outbox/lease 작업자와 판정 게이트를 구현한다. 모호한 결과는 공개하지 않고 B 검토 초안을 저장한다. Agents API는 공식 API 계약에 맞춰 선택적으로 연결하고 키·프롬프트·비공개 본문을 로그에 출력하지 않는다.
- [ ] **Step 4:** 집중 테스트와 타입 검사, 설정이 있을 경우에만 격리된 실제 Agents API 시험을 수행한다. 자격이 없으면 실호출 미검증을 기록한다.
- [ ] **Step 5:** 작업자·판정·테스트만 커밋한다.

### Task 7: 통합 수용과 문서

**Files:** `tests/e2e/handoff.spec.ts`, `docs/harness/checks.md`, `specs/004-mcp-handoff/quickstart.md`, `work/004-mcp-handoff/resume.md`.

- [ ] **Step 1:** 승인 A/B/C에서 MCP 전송 → C의 제목 열람·본문 차단 → 근거 충족 자동 회신 → 근거 부족 B 웹 검토 → 멤버 제외 후 차단을 두 사용자 이상 E2E로 확인한다.
- [ ] **Step 2:** `scripts/check-product.ps1`, `scripts/check-harness.ps1`, `scripts/test-harness.ps1`을 실행하고 실제 종료 코드와 미검증 외부 자격을 기록한다.
- [ ] **Step 3:** R02~R05/R10~R12/R17/R26~R29의 확인 범위를 갱신하고 최종 diff·권한 경계 리뷰를 수행한다.
- [ ] **Step 4:** 수용 문서·테스트를 커밋한다. Push·PR·병합은 별도 요청을 따른다.
