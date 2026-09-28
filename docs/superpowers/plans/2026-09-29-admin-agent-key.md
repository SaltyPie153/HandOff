# 서버 Codex API 키 웹 설정 Implementation Plan

후속 결정: 이 계획의 최초 OpenAI 호출은 Upstage `solar-pro4` 호출과 별도 Upstage 키 보호 파일로 전환됐다. 현재 동작은 [기술 설계](../../product/technical-design.md)를 따른다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서비스 관리자가 웹에서 서버 자동 회신용 OpenAI API 키를 안전하게 저장·교체·사용 중지하고, 워커가 즉시 새 상태를 따르게 한다.

**Architecture:** `AgentKeyStore`가 Git 제외 서버 파일과 환경 변수 대체값을 단일 출처로 관리한다. Nest 관리자 컨트롤러와 배경 워커가 같은 저장소 인스턴스를 사용하며, 웹은 설정 여부만 받아 입력값을 되돌려 표시하지 않는다.

**Tech Stack:** Node.js 24, NestJS/TypeScript, React/TypeScript, Node 파일 API, PostgreSQL/Prisma, `node:test`.

**Spec:** [서버 Codex API 키 웹 설정 설계](../specs/2026-09-29-admin-agent-key-design.md)

## Global Constraints

- 범위는 `OPENAI_API_KEY` 한 종류다. MCP·근거 암호화·GitHub 키 설정은 제외한다.
- 개발 기본 경로는 Git 제외 `work/server-secrets/`; 운영 경로는 VM 영구 디스크의 절대 `HANDOFF_SECRET_DIR`이다.
- Linux 권한은 디렉터리 `0700`, 파일 `0600`; Windows는 현재 사용자 전용 ACL을 확인·적용하고 실패 시 저장을 거부한다.
- 파일의 명시적 비활성 상태는 환경 변수 키보다 우선한다. 손상·권한 오류 시 자동 회신은 중단된다.
- GET/PUT/DELETE `/api/admin/agent-key`는 현재 DB의 승인된 서비스 관리자만 사용한다. PUT/DELETE는 CSRF를 검사하고 모든 응답은 `Cache-Control: no-store`다.
- 키 문자열·일부 문자·해시·파일 경로는 API 응답과 일반 로그에 나오지 않는다. 계약 동의·확인 완료는 이 기능이 만들지 않는다.

## File Structure

- `apps/api/src/admin/agent-key.store.ts`: 파일 경로·권한·원자 교체·상태 세대·환경 변수 대체값의 단일 구현.
- `apps/api/src/admin/agent-key.controller.ts`: 관리자 권한과 CSRF를 거친 상태 조회·저장·중지 HTTP API.
- `apps/api/src/auth/domain.ts`: 관리자 키 관리 권한 액션.
- `apps/api/src/handoff/handoff.module.ts`: 저장소와 컨트롤러 등록, 워커에 같은 저장소 주입.
- `apps/api/src/handoff/agent-runner.ts`, `background-worker.ts`: 작업별 키 조회, 세대 재검사, 중지 작업 재큐잉.
- `apps/web/src/handoff/agent-key.api.ts`, `AgentKeySettings.tsx`, `apps/web/src/App.tsx`: 관리자 전용 웹 입력과 상태 표시.
- `apps/api/tests/agent-key.store.test.ts`, `agent-key.integration.test.ts`, `handoff-worker.integration.test.ts`: 파일·HTTP·워커 동작 검증.
- `apps/web/tests/agent-key-settings.test.tsx`: 관리자 설정 UI 및 입력 초기화 검증.

## Review Focus

1. 경로가 상대값이거나 웹 정적 경로 아래인 `HANDOFF_SECRET_DIR`: 저장을 거부한다(Task 1).
2. 파일이 손상되거나 다른 계정이 읽을 수 있는 상태: 환경 변수로 우회하지 않고 자동 호출을 멈춘다(Task 1).
3. 프로젝트 관리자이지만 서비스 관리자가 아닌 계정: HTTP 키 상태도 읽지 못한다(Task 2).
4. 입력 중 API 오류가 난 키: 웹 상태에서 즉시 제거되고 화면에 재표시되지 않는다(Task 4).
5. 키 교체·중지가 Agents 호출과 겹침: 이전 세대로 자동 공개 회신을 쓰지 않는다(Task 3).

---

### Task 1: 서버 키 저장소

**Files:**
- Create: `apps/api/src/admin/agent-key.store.ts`
- Test: `apps/api/tests/agent-key.store.test.ts`

**Interfaces:**
- Produces: `type AgentKeyState = { configured: boolean; source: 'file' | 'environment' | 'disabled' | 'none'; generation: string; key?: string }`.
- Produces: `class AgentKeyStore { constructor(config: { nodeEnv: string; secretDir?: string; workRoot?: string }); read(): Promise<AgentKeyState>; save(input: unknown): Promise<void>; disable(): Promise<void>; withGeneration<T>(expected: string, action: () => Promise<T>): Promise<{ unchanged: boolean; value?: T }> }`.
- Store owns the filename `agent-key.json`; absent file alone allows `process.env.OPENAI_API_KEY` fallback. File record has `version: 1`, `generation` UUID, and exactly one of `key` or `disabled: true`.

- [ ] **Step 1: Write failing store tests.** Check save/read across a new instance; disable masks environment; malformed or overlong input is rejected without echoing it; malformed or weak-permission file does not fall back; relative/unsafe production directory is rejected. Linux tests assert `0700`/`0600`; Windows checks restrictive ACL. Use temporary directories without real keys.
- [ ] **Step 2: Run the focused test and observe failure.** `rtk proxy npm run test --workspace @handoff/api`; expected: missing store/module or failing assertions. The API script builds TS tests into `dist/tests` before `node --test`.
- [ ] **Step 3: Implement the store.** Validate bounded single-line key input; resolve development path to ignored `work/server-secrets` and production to absolute `HANDOFF_SECRET_DIR`; reject web/static or Git-tracked paths; create temp file exclusively, restrict permissions before writing the secret, flush and rename atomically; verify existing path/file permissions and record schema on each read; assign a fresh UUID generation on each mutation; keep errors generic. Windows ACL command arguments may contain file path and current-user SID but never the key. `withGeneration` and save/disable use one in-process mutex to make final publish checks atomic against admin mutation.
- [ ] **Step 4: Run focused tests and API build.** Both exit 0; inspect `git status --short` to ensure no secret path is staged.
- [ ] **Step 5: Commit only source and tests.** `feat: persist server agent key in protected file`.

### Task 2: 관리자 HTTP API

**Files:**
- Create: `apps/api/src/admin/agent-key.controller.ts`
- Modify: `apps/api/src/auth/domain.ts`, `apps/api/src/handoff/handoff.module.ts`
- Test: `apps/api/tests/agent-key.integration.test.ts`

**Interfaces:**
- Consumes: `AgentKeyStore.read/save/disable` from Task 1.
- Produces: `GET /api/admin/agent-key -> { configured: boolean; source: 'file' | 'environment' | 'disabled' | 'none' }`; PUT body `{ key: string }`; DELETE returns `{ configured: false, source: 'disabled' }`.
- Produces: `AuthAction` value `MANAGE_AGENT_KEY`, allowed only for approved service admins.

- [ ] **Step 1: Write failing HTTP integration tests.** Anonymous 401; pending/member/project manager 403; DB admin approval transition takes effect with an existing session; PUT/DELETE without CSRF 403; valid mutations succeed; GET/PUT/DELETE response JSON/headers never contain key, prefix, path or hash; invalid inputs return a fixed message.
- [ ] **Step 2: Run the focused integration test and observe failure.** Use the existing `NODE_ENV=test` and disposable PostgreSQL test database; expected missing route or failed authorization assertions.
- [ ] **Step 3: Add controller and module wiring.** Register one `AgentKeyStore` in `HandoffModule` with `nodeEnv: config.nodeEnv`, `secretDir: process.env.HANDOFF_SECRET_DIR`, and `workRoot: process.cwd()`; inject it into controller and worker. Every handler calls `requireAction(req, 'MANAGE_AGENT_KEY')`; mutations call `requireCsrf`; set `Cache-Control: no-store` including error responses. On successful save, await `HandoffBackgroundWorker.wakeUnavailableJobs()`.
- [ ] **Step 4: Run focused integration test and API build.** Both exit 0.
- [ ] **Step 5: Commit source and tests.** `feat: add admin agent key API`.

### Task 3: 워커의 키 상태와 세대 검사

**Files:**
- Modify: `apps/api/src/handoff/agent-runner.ts`, `apps/api/src/handoff/background-worker.ts`, `apps/api/src/handoff/handoff.module.ts`
- Test: `apps/api/tests/handoff-worker.integration.test.ts`, `apps/api/tests/agent-key.store.test.ts`

**Interfaces:**
- Consumes: `AgentKeyStore.read()`; `AgentRunner.confirmExplicitClaim(claim, evidence, key)` receives the key chosen for this job.
- Worker captures `generation` before Agents call and uses `withGeneration(generation, publish)` before the DB insert; mismatch changes job to `REVIEW_REQUIRED` without `CODEX_AUTO` reply.

- [ ] **Step 1: Write failing worker tests.** Missing/disabled key causes no managed API call and review; save requeues only jobs with `서버 Codex 확인 불가`; rotation/deletion during a deferred agent call leaves zero `CODEX_AUTO` replies; matching generation still publishes once; stale evidence and human replies keep existing behavior.
- [ ] **Step 2: Run the focused worker integration test and observe failure.** Expected missing injected store or generation behavior.
- [ ] **Step 3: Replace direct environment lookups.** Inject the store into the worker; pass the current key to the managed runner only in memory; call `withGeneration` around final publish within the one-API-process deployment boundary. Review on unreadable state. Keep the existing request/version/evidence/permission checks and `skipDuplicates` reply key.
- [ ] **Step 4: Run worker tests and API build.** Both exit 0.
- [ ] **Step 5: Commit source and tests.** `feat: honor managed key changes in automatic replies`.

### Task 4: 관리자 설정 화면 및 전체 검증

**Files:**
- Create: `apps/web/src/handoff/agent-key.api.ts`, `apps/web/src/handoff/AgentKeySettings.tsx`, `apps/web/tests/agent-key-settings.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: Task 2's GET/PUT/DELETE routes and existing CSRF cookie helper.
- Produces: `<AgentKeySettings />`, mounted only for `state.viewer.isServiceAdmin` on `/settings`.

- [ ] **Step 1: Write failing UI tests.** Password field does not prefill; configured status has no fragment of key; save and error both clear input; disabled state displays clearly; ordinary viewer has no section. Use existing web test tooling, adding a test dependency only if the package already supports a runner.
- [ ] **Step 2: Run `rtk proxy npm run test --workspace @handoff/web -- agent-key-settings.test.tsx` and observe failure.** Expected missing component or assertions.
- [ ] **Step 3: Implement API helper and settings component.** Use `credentials: 'same-origin'`, `cache: 'no-store'`, CSRF on PUT/DELETE, `autoComplete="off"`, generic errors, no local storage, and an explicit ‘사용 중지’ action.
- [ ] **Step 4: Run `rtk proxy npm run build`, `rtk proxy npm test`, `rtk proxy npm run test:integration`, and `rtk proxy git diff --check`.** Confirm all exit codes. Manually exercise admin save, page reload, API restart persistence, disable with environment fallback present, and member denial using dummy key only; report any unrun live steps.
- [ ] **Step 5: Commit source/tests and record results in `work/005-agent-key/resume.md`.** Do not stage `.env`, actual key files, or the ignored work log.
