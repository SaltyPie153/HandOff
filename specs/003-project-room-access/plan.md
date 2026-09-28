# 프로젝트 룸과 멤버 권한 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인 회원이 프로젝트를 만들고 승인된 팀원을 배정하며, 현재 멤버만 프로젝트 룸에 들어가도록 한다.

**Architecture:** 기존 인증 세션과 CSRF 검사를 `AuthService`에서 재사용하고, 새 `ProjectModule`이 프로젝트·멤버십·변경 기록을 소유한다. 읽기 권한은 매 요청의 현재 회원 상태와 멤버십으로 확인하고, 생성·멤버 변경은 한 트랜잭션에서 권한 재검사와 기록을 함께 저장한다. 웹은 현재의 경로 분기 방식을 유지한다.

**Tech Stack:** Node.js `>=24.15 <25`, npm 10.9.2, NestJS/TypeScript, PostgreSQL/Prisma, React/MUI, Vitest, Node test runner, Playwright.

**Spec:** [spec.md](spec.md) (FR-001~FR-012, SC-001~SC-005)

## Global Constraints

- 원본 제품 명세 R20~R23의 가입 승인·서비스 관리자·프로젝트 관리 담당자 경계를 유지한다.
- 승인 회원만 프로젝트를 만들고, 생성자는 멤버이자 관리 담당자가 된다. 서비스 관리자도 미배정 룸 콘텐츠에는 접근하지 못한다.
- 관리 담당자 양도·제외, 프로젝트 삭제, 인수인계·계약 본문/첨부는 이번 계획에 포함하지 않는다.
- 비밀값과 `.env`를 Git에 넣지 않는다. 개발 DB와 시험 DB를 분리하고 기존 볼륨을 삭제하지 않는다.
- DB 상태가 바뀌면 열린 화면과 기존 세션도 다음 요청에서 현재 권한을 적용한다.

## Review Focus

- 공백만 있는 이름 또는 120자를 넘는 이름은 프로젝트·멤버십·감사 기록을 남기지 않고 거부한다 (Task 1).
- 승인 대기 회원을 후보로 골랐거나 후보 조회 후 승인 상태가 바뀌어도 추가 시점의 현재 상태로 거부한다 (Task 3).
- 같은 회원을 동시에 두 번 추가해도 멤버십과 ADD 기록이 각각 하나만 생긴다 (Task 3).
- 관리 담당자 제거 요청은 서비스 관리자가 보내도 거부해 관리자 없는 프로젝트를 만들지 않는다 (Task 3).
- 미배정 서비스 관리자의 직접 룸 주소와 제외된 회원의 오래된 화면은 다음 읽기에서 차단된다 (Tasks 2, 5).

---

### Task 1: 프로젝트 데이터와 원자적 생성

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/0003_project_rooms/migration.sql`
- Create: `apps/api/src/projects/project.types.ts`
- Create: `apps/api/src/projects/project.repository.ts`
- Test: `apps/api/tests/projects.integration.test.ts`

**Interfaces:**
- Produces `ProjectRole = 'MANAGER' | 'MEMBER'` and `ProjectView = { id: string; name: string; description: string | null; role: ProjectRole; createdAt: Date }` in `project.types.ts`.
- Produces `new ProjectRepository(prisma: PrismaService)` and `createProject(actorId: string, input: { name: string; description: string | null }): Promise<ProjectView>`.
- `Project` has UUID ID, trimmed name (1~120자), optional description (최대 500자), creator, creation time. `ProjectMembership` uses `(projectId,userId)` as unique active membership key and role. `ProjectMemberEvent` records `ADD | REMOVE`, target, actor, timestamp; creator registration emits one ADD event.

- [x] **Step 1: Write the failing integration test** `approved creator gets project, MANAGER membership and one ADD event; pending creator and invalid name leave all three counts unchanged` in `projects.integration.test.ts`.

  ```ts
  assert.equal(created.role, 'MANAGER');
  assert.equal(await prisma.projectMembership.count({ where: { projectId: created.id } }), 1);
  assert.equal(await prisma.projectMemberEvent.count({ where: { projectId: created.id, action: 'ADD' } }), 1);
  ```
- [x] **Step 2: Run `npm run test:integration`** and confirm the new test or compilation fails before the migration/repository exists.
- [x] **Step 3: Add the three models and migration** with the fields, uniqueness and name constraint in the Interfaces block.
- [x] **Step 4: Implement `ProjectRepository.createProject`**. Trim/validate inputs; recheck actor `APPROVED` inside one transaction; create project, manager membership and ADD event together.
- [x] **Step 5: Run `npm run db:generate`**; expect Prisma generation to succeed.
- [x] **Step 6: Run `npm run test:integration`**; expect the creation and rejection cases to pass against an isolated migrated DB.
- [x] **Step 7: Commit only Task 1 files** with message `feat(projects): add project creation and membership storage`.

### Task 2: 프로젝트 선택과 룸 읽기 경계

**Files:**
- Create: `apps/api/src/projects/project.service.ts`
- Create: `apps/api/src/projects/project.controller.ts`
- Create: `apps/api/src/projects/project.module.ts`
- Modify: `apps/api/src/projects/project.repository.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/tests/projects.integration.test.ts`

**Interfaces:**
- `ProjectService.create(actorId, input): Promise<ProjectView>`, `listMine(actorId): Promise<ProjectView[]>`, `room(actorId, projectId): Promise<ProjectView & { members: MemberView[] }>`; `MemberView = { userId: string; displayName: string | null; role: ProjectRole; joinedAt: Date }`.
- `GET /api/projects` returns only current member projects; `POST /api/projects` accepts `{ name, description? }` and requires session + CSRF; `GET /api/projects/:id` returns room metadata and member roster only for current approved members. Unknown or unassigned room IDs return the same 404 shape.
- HTTP integration tests reuse the existing `request(path, token?, method = 'GET', csrf?)` helper shape from `auth.integration.test.ts`.
- `AuthModule` exports `AuthService` and `PrismaService`. `ProjectModule.register(config)` imports `AuthModule.register(config)` and provides project classes; `AppModule.register` imports `ProjectModule` in place of the direct `AuthModule` import, retaining existing auth routes once.

- [x] **Step 1: Write failing HTTP integration tests**: anonymous 401, pending create/list/room 403, approved create 201 and own list 200, guessed other-project room 404, unassigned service admin room 404. Assert `Cache-Control: no-store` for private reads.

  ```ts
  assert.equal((await request('/api/projects', pendingToken)).status, 403);
  assert.equal((await request(`/api/projects/${otherId}`, memberToken)).status, 404);
  assert.equal((await request(`/api/projects/${otherId}`, adminToken)).status, 404);
  ```
- [x] **Step 2: Run `npm run test:integration`**; confirm project routes or assertions fail.
- [x] **Step 3: Add repository reads and `ProjectService.create/listMine/room`**. Re-read current approval and membership for every read; do not grant room access from the service-admin flag.
- [x] **Step 4: Add `ProjectController` and module wiring**. Validate unknown JSON types and UUIDs; use `AuthService.requireSession`/`requireAction` and `requireCsrf` on mutations.
- [x] **Step 5: Run `npm run test:integration`**; expect all project and existing auth HTTP cases to pass.
- [x] **Step 6: Run `npm run typecheck`**; expect both workspaces to pass.
- [x] **Step 7: Commit only Task 2 files** with message `feat(projects): enforce project room access`.

### Task 3: 멤버 배정·제외와 서비스 관리자 관리 보기

**Files:**
- Modify: `apps/api/src/projects/project.repository.ts`
- Modify: `apps/api/src/projects/project.service.ts`
- Modify: `apps/api/src/projects/project.controller.ts`
- Create: `apps/api/src/projects/project-admin.controller.ts`
- Modify: `apps/api/src/projects/project.module.ts`
- Test: `apps/api/tests/projects.integration.test.ts`

**Interfaces:**
- `ProjectService.members(actorId, projectId): Promise<MemberView[]>` and `eligibleUsers(actorId, projectId, query: string): Promise<Array<{ id: string; displayName: string | null }>>` allow only that project's manager or a service admin.
- `ProjectService.addMember(actorId, projectId, targetId): Promise<'ADDED' | 'ALREADY_MEMBER'>` and `removeMember(...): Promise<'REMOVED' | 'NOT_MEMBER'>` recheck actor role/admin and target status inside one transaction with membership/event mutation. Manager removal returns a conflict; repeated add/remove writes no duplicate event.
- `ProjectService.adminProjects(actorId): Promise<Array<{ id: string; name: string; description: string | null; memberCount: number }>>` is service-admin-only and excludes room content.
- `GET /api/projects/:id/members`, `GET /api/projects/:id/eligible-users?query=`, `POST /api/projects/:id/members` with `{ userId }`, and `DELETE /api/projects/:id/members/:userId` support management. `GET /api/admin/projects` returns project ID/name/description/member count for service admins, without room content. Mutations require CSRF.
- Unknown or unassigned project IDs return 404 to nonadmins; an assigned ordinary member's management attempt returns 403. Manager removal returns 409.

- [x] **Step 1: Write failing integration tests** for own manager and unassigned service admin add/remove, pending target rejection, cross-project manager and ordinary member rejection, missing CSRF, parallel duplicate adds (one active row/ADD event), repeated remove (one REMOVE event), manager removal conflict, and actor approval/role changes before mutation. Seed one member with both provider identities and verify its two sessions see the same project and one membership.

  ```ts
  assert.equal(await prisma.projectMembership.count({ where: { projectId, userId: targetId } }), 1);
  assert.equal(await prisma.projectMemberEvent.count({ where: { projectId, targetId, action: 'ADD' } }), 1);
  assert.equal((await request(managerMemberUrl, adminToken, 'DELETE', adminCsrf)).status, 409);
  ```
- [x] **Step 2: Run `npm run test:integration`**; confirm missing routes/behavior fail.
- [x] **Step 3: Implement repository membership reads and transactions**. Keep `(projectId,userId)` uniqueness as the race arbiter and emit an event only for a successful state change.
- [x] **Step 4: Add service methods and management controllers**. Candidate lookup returns approved nonmembers with minimal display data; service-admin listing exposes no room body.
- [x] **Step 5: Run `npm run test:integration`**; expect the role matrix, audit counts and existing auth cases to pass.
- [x] **Step 6: Run `npm run typecheck`**; expect both workspaces to pass.
- [x] **Step 7: Commit only Task 3 files** with message `feat(projects): manage approved project members`.

### Task 4: 프로젝트 선택·빈 룸·멤버 관리 화면

**Files:**
- Create: `apps/web/src/projects/api.ts`
- Create: `apps/web/src/projects/ProjectSelectPage.tsx`
- Create: `apps/web/src/projects/ProjectRoomPage.tsx`
- Create: `apps/web/src/projects/ProjectMembersPage.tsx`
- Create: `apps/web/src/projects/AdminProjectsPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/tests/projects-pages.test.tsx`

**Interfaces:**
- `projects/api.ts` exports typed `ProjectView`/`MemberView` (JSON times are ISO strings), `loadMine()`, `createProject(name, description)`, `loadRoom(id)`, `loadMembers(id)`, `loadCandidates(id, query)`, `addMember(id,userId)`, `removeMember(id,userId)`, `loadAdminProjects()`. Mutations send the existing `ho_csrf` value; fetches keep same-origin credentials.
- Routes: `/projects` selection/creation, `/projects/:id` empty room with member roster, `/projects/:id/members` own-manager controls, `/admin/projects` service-admin assignment view. Keep `/login`, `/pending`, `/settings`, `/admin/pending`, `/dev/health` behavior.

- [x] **Step 1: Write failing Vitest cases** for empty list/create guidance, disabled repeat-submit during creation, successful creation and room entry, admin-unassigned assignment view without room link, pending redirect, and 403/404 after membership loss clearing prior room data.

  ```tsx
  expect(screen.getByRole('heading', { name: '프로젝트 선택' })).toBeVisible();
  expect(screen.getByRole('button', { name: '프로젝트 만들기' })).toBeDisabled(); // 요청 진행 중
  expect(screen.queryByText('이전 룸 멤버 현황')).not.toBeInTheDocument(); // 접근 상실 후
  ```
- [x] **Step 2: Run `npm run test --workspace @handoff/web -- projects-pages.test.tsx`**; confirm new assertions fail.
- [x] **Step 3: Implement `projects/api.ts`** with typed response parsing and CSRF on member mutations.
- [x] **Step 4: Implement four pages and `App` path dispatch** using existing MUI conventions. Show loading/error/empty states; on denied room fetch, return to `/projects` with an access-lost message.
- [x] **Step 5: Run `npm run test --workspace @handoff/web -- projects-pages.test.tsx`**; expect the new and existing auth screens to pass.
- [x] **Step 6: Run `npm run typecheck`**; expect both workspaces to pass.
- [x] **Step 7: Run `npm run build`**; expect API and web builds to pass.
- [x] **Step 8: Commit only Task 4 files** with message `feat(web): add project selection and membership screens`.

### Task 5: 두 사용자 종단 검증과 문서 동기화

**Files:**
- Create: `tests/e2e/projects.spec.ts`
- Create: `specs/003-project-room-access/quickstart.md`
- Modify: `docs/harness/checks.md`
- Modify: `docs/product/technical-design.md` (implementation-stage status only)
- Modify: `specs/003-project-room-access/plan.md` (record checked steps and actual results)

**Interfaces:**
- E2E uses the existing isolated PostgreSQL/Chromium fixture and seeds approved/pending users plus sessions as `tests/e2e/auth.spec.ts` does; it cleans only its own rows.
- Quickstart documents migration and two-account project create → assign → room enter → remove → denied path, with no secrets.

- [x] **Step 1: Add the Playwright flow**: manager creates a room, approved second member sees it only after assignment, both see the same roster, unassigned admin can assign but cannot enter, and removed member loses access on next request. Include direct URL and pending-user denials.

  ```ts
  await expect(memberPage.getByText(projectName)).toBeVisible();
  await expect(removedMemberPage.getByText(projectName)).not.toBeVisible();
  await expect(unassignedAdminPage.getByText('접근 권한이 없습니다')).toBeVisible();
  ```
- [x] **Step 2: Run `npm run test:e2e -- tests/e2e/projects.spec.ts`**; expect the full flow to pass after Tasks 1~4. If it fails, record the exact step and symptom.
- [x] **Step 3: Resolve any E2E-exposed feature defect** in its owning API or web file, then rerun the focused E2E test.
- [x] **Step 4: Update quickstart and coverage documentation** for R20~R23 and stale implementation-stage wording. Do not mark future content/attachment checks complete or change product rules.
- [x] **Step 5: Run `pwsh -NoProfile -File scripts/check-product.ps1` under Node 24/Docker**; record exit code, E2E count and migration result.
- [x] **Step 6: Run `pwsh -NoProfile -File scripts/check-harness.ps1`**; record exit code.
- [x] **Step 7: Run `pwsh -NoProfile -File scripts/test-harness.ps1`**; record exit code.
- [x] **Step 8: Record manual acceptance status in `work/003-project-room-access/resume.md`**. With Google·Discord 시험 자격 증명, check the same member's project list through both logins; otherwise mark SC-005 live login unverified. Record the 4~5-person usability check as verified or pending.
- [x] **Step 9: Commit Task 5 files** with message `test(projects): verify project room access end to end`.

## Completion Boundary

- Product completion requires the FR-001~FR-012 role matrix and SC-001~SC-005 to have observed evidence; automated E2E cannot alone certify the 4~5-person usability criterion.
- The team-shared handoff/contract list, drafts, attachments and versioned agreements remain the next feature. Project-room permission checks from this plan become their server-side prerequisite.
- Coverage: Task 1 covers FR-001/002/011; Task 2 covers FR-003/004/007; Task 3 covers FR-005~011; Task 4 covers the visible flows of FR-003/006/012; Task 5 checks the combined SC-001~005 flows and records manual gaps.

## 실행 기록 (2026-09-28)

- Node.js 24.19.0과 Docker Desktop 29.6.1의 격리 PostgreSQL에서 `npm run db:generate`, `npm run test:integration`, `npm run typecheck`, `npm run build`가 종료 코드 0으로 완료됐다.
- 웹 전용 테스트는 5/5, 프로젝트 두 사용자 Playwright 테스트는 1/1 통과했다. `scripts/check-product.ps1`은 빌드→타입→단위→통합→전체 E2E(8/8)를 실행해 `PRODUCT: PASS`를 반환했다.
- `scripts/check-harness.ps1`은 14개 파일·37개 링크 검사 exit 0, `scripts/test-harness.ps1`은 18개 시나리오 exit 0이었다.
- 최초 통합 시도는 Docker Desktop 중지로 시험 DB 준비가 실패했다. Docker 시작 후 통과했다. 첫 E2E는 후보 검색 전 목록의 중복 버튼 선택 문제로 실패했고, 검색 시작 시 이전 후보를 비우고 대상 행을 지정한 뒤 통과했다.
- 실제 승인 회원 2명으로 프로젝트 생성, 미배정 회원의 목록·직접 주소 차단, 멤버 추가 후 두 계정의 룸 접근, Google·Discord 각각 재로그인 후 동일 프로젝트 목록 유지, 멤버 제외 후 새로고침·목록 접근 차단을 수동 확인했다. DB의 최종 멤버십은 관리 담당자 1명이고 ADD·REMOVE 감사 기록도 확인했다. 따라서 SC-005의 실제 제공자 재로그인 부분은 확인됐다. 4~5명 팀 사용성 검사는 아직 하지 않았다.
- 독립 리뷰 후 동명이인 후보의 회원 ID 표시, 검색 응답 순서 보호, Quickstart 초기 명령을 보완했다. UI 변경으로 기존 E2E 행 선택이 한 차례 시간 초과했으나 선택자를 수정해 집중 E2E 1/1 및 전체 제품 검사 `PRODUCT: PASS`(E2E 8/8)를 재확인했다. 웹 테스트는 최종 35/35다.
