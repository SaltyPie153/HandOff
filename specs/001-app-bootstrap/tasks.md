# Tasks: 앱 기본 골격과 로컬 실행

**Input**: `specs/001-app-bootstrap/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [계약](contracts/local-bootstrap.md), [quickstart.md](quickstart.md)
**Status**: 작업 분해 완료 · 모든 구현 작업 미착수.
**Tests**: 명세 FR-008과 SC-001~005에 따라 단위·계약·실DB·브라우저 검증을 포함한다.
동작 검증은 관련 구현 전에 실패를 확인한다. 단순 문서 변경에는 형식적인 테스트를 추가하지 않는다.

## Format: `[ID] [P?] [Story] Description`

[P]는 해당 단계의 선행 조건을 충족한 뒤 다른 파일의 작업과 병행 가능하다는 뜻이다.
병렬 에이전트 실행 지시는 아니며, 동일 파일·lockfile 수정은 직렬로 수행한다.
경로는 저장소 루트 기준이며 앱 파일은 앞으로 생성할 대상이다.

## Path Conventions

- 앱: apps/web, apps/api
- 공통 실행기: scripts/ ; 통합 흐름: tests/e2e/
- 공유 명세: specs/001-app-bootstrap/ ; 임시 실행 근거: work/001-app-bootstrap/
- 현재 문서 브랜치: feature/technical-design. 구현 브랜치: develop 기반 feature/app-bootstrap.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 선행 변경을 보존하고 재현 가능한 패키지·도구 구성을 준비한다.

- [X] T001 현재 Git 상태와 선행 Harness·SDD 공유 대상, 로컬 전용 변경을 work/001-app-bootstrap/resume.md에 기록한다. AGENTS.md의 로컬 경로 변경·outputs를 자동 stage하지 않고, 사용자 승인 후 선행 문서를 develop에 통합·검증한 다음 feature/app-bootstrap을 생성한다. 승인 전 병합하거나 이 게이트를 완료 처리하지 않는다.
- [X] T002 research.md의 버전 계열에 대해 공식 registry의 engines/peerDependencies와 지원 상태를 확인하고 정확한 Node/npm·앱 의존성·PostgreSQL patch/digest를 specs/001-app-bootstrap/research.md에 기록한다. 호환되지 않으면 설치 강행 대신 plan.md와 조사 결정을 수정한다.
- [X] T003 package.json, apps/web/package.json, apps/api/package.json, package-lock.json, .node-version에 npm workspaces·exact 버전·packageManager를 구성하고 .gitignore에 node_modules·빌드·시험 산출물 제외를 추가한다. 기존 제외 규칙과 로컬 변경을 보존한다. lockfile 생성 후 npm ci 재현을 확인한다.
- [X] T004 apps/api/tsconfig.json, apps/api/tsconfig.test.json, apps/web/tsconfig.json, apps/web/vitest.config.ts, playwright.config.ts에 API ESM/NodeNext·decorator metadata·tsc 후 node:test, 웹 Vitest/Testing Library, Playwright Chromium 검증 환경을 구성한다. package.json에 build/typecheck/test 실행 진입점을 연결한다. test는 웹 컴포넌트, API 단위, scripts/tests의 DB 비의존 테스트를 모두 실행하고 어느 하나 실패해도 실패를 전달한다. 실DB가 필요한 database-setup.test.mjs와 health 계약·통합 테스트는 test:integration 대상으로 분리한다. T010에서는 기반 검사만, 전체 build/typecheck는 앱 진입점 생성 후 T015에서 검증한다.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 세 사용자 흐름이 공유할 개발 설정·DB·실행 경계를 만든다.
**Gate**: T001~T004 완료 후 시작한다.

- [X] T005 scripts/tests/dev-environment.test.mjs에 필수 설정 누락·잘못된 URL·포트·DB 설정 불일치, production/원격 DB 거부, 기존 .env 보존과 비밀값 비노출 실패 사례를 작성한다. 허용 범위는 NODE_ENV=development/test, loopback, DB 이름 handoff_dev 또는 handoff_test이다.
- [X] T006 scripts/lib/dev-environment.mjs, scripts/dev-init.mjs, .env.example에 T005의 설정 검증과 최초 한 번의 임의 개발 비밀번호 생성을 구현한다. 환경 변수 이름만 진단하고 전체 URL·비밀번호·토큰을 기록하지 않는다. 루트 .env를 앱·CLI가 같은 규칙으로 읽고 기존 파일은 덮어쓰지 않는다.
- [X] T007 compose.dev.yml, compose.test.yml, scripts/db.mjs에 PostgreSQL17 patch/digest·named volume·loopback 바인딩·유한 ready 대기를 구성한다. 개발/시험 project·DB·volume·포트를 분리하고 db:down은 volume을 보존한다. scripts/db.mjs는 T006 검증 후에만 Compose를 호출한다.
- [X] T008 apps/api/prisma/schema.prisma와 apps/api/prisma/migrations/0001_bootstrap_probe/migration.sql에 BootstrapProbe의 id “UUID, primary key”, value “문자열, 1~128자”, createdAt “UTC timestamp, 필수”를 구현한다. DB에도 길이 제약을 두고 업무 테이블·관계·실제 데이터를 만들지 않는다.
- [X] T009 apps/api/prisma.config.ts, apps/api/src/database/prisma.service.ts, scripts/prisma.mjs에 Prisma7 adapter-pg·ESM client 생성·명시적 .env 로드·연결 종료 처리를 구성한다. generate/migrate 명령을 분리하고 migration 전에 T006의 대상 검증을 수행한다. API 시작 시 migration/reset/seed를 자동 실행하지 않는다.
- [X] T010 package.json과 scripts/tests/database-setup.test.mjs에 dev:init/db:up/db:down/db:generate/db:migrate 명령을 연결하고, 빈 시험 DB의 명시적 migration·재적용·원격/운영 대상 거부를 검증한다. T005 검사, npm ci, client 생성과 DB 준비 검증 결과를 work/001-app-bootstrap/foundation.md에 기록한다. 이 단계에서는 앱 진입점이 없으므로 전체 build/typecheck 성공을 완료 조건으로 삼지 않는다. database-setup.test.mjs는 여기서 직접 실행하고 T023에서 test:integration에 연결한다.

**Checkpoint**: 설정과 검증 DB를 준비할 수 있으며 웹·API·진단 기능은 아직 미완료다.

## Phase 3: User Story 1 - 안내를 따라 로컬 앱 시작하기 (Priority: P1)

**Goal**: 외부 계정 없이 시작 화면을 열고 실행 오류를 안전하게 진단한다.
**Independent Test**: 새 사본에서 설정·실행하여 HandOff/개발 환경 표시를 보고 누락 설정·포트 충돌을 재현한다.
전체 ready 판정은 US2가 제공한다. US1만으로 SC-001 전체 완료를 주장하지 않는다.

### Tests for User Story 1

- [X] T011 [P] [US1] apps/web/tests/start-screen.test.tsx에 HandOff·개발 환경·상태 확인 진입점, 키보드 조작, 업무 메뉴 부재를 검증하는 실패 테스트를 작성한다. FR-002/010.
- [X] T012 [P] [US1] apps/api/tests/startup.test.ts와 scripts/tests/dev-process.test.mjs에 설정 누락·production 거부·API/웹 포트 충돌 시 실패, 타 프로세스 보존, DB 중단 상태에서도 API 프로세스 시작을 검증하는 실패 테스트를 작성한다. FR-003/006/010.

### Implementation for User Story 1

- [X] T013 [US1] apps/web/index.html, apps/web/src/main.tsx, apps/web/src/App.tsx, apps/web/src/theme.ts에 React·MUI/Emotion 시작 화면을 구현한다. 아직 확인하지 않은 상태는 미확인으로 표시하고 정적 ready 값을 넣지 않는다. T011을 통과시킨다.
- [X] T014 [US1] apps/api/src/main.ts, apps/api/src/app.module.ts에 Nest12/Express 앱과 T006 설정 검증을 연결한다. loopback 바인딩, production 거부, 비밀값 없는 오류 코드/시각, 종료 정리를 구현한다. DB 연결 실패를 앱 시작 실패로 전파하지 않는다.
- [X] T015 [US1] apps/web/vite.config.ts, scripts/dev-api.mjs, package.json에 strictPort·/api proxy·루트 포트 설정, tsc watch/Node 실행과 dev:web/dev:api 명령을 연결한다. API 자식 프로세스가 실패하면 숨기지 않고 자식만 정리한다. 브라우저에 DB 설정을 전달하지 않는다. T013/T014의 앱 진입점이 생성된 뒤 전체 npm run build와 npm run typecheck를 실행하고 work/001-app-bootstrap/us1.md에 결과를 기록한다.
- [X] T016 [US1] README.md와 specs/001-app-bootstrap/quickstart.md에 실제 준비·실행·종료·충돌 해결 명령을 반영한다. US2/US3 미완료 명령은 구현 예정으로 표시하고 존재하지 않는 기능을 실행 가능하다고 안내하지 않는다. FR-001.
- [X] T017 [US1] T011/T012와 새 사본 시작 화면·설정 오류·포트 충돌 확인을 수행하고 work/001-app-bootstrap/us1.md에 실행 명령·종료 코드·미검증 범위를 기록한다. 외부 자격 증명을 제공하지 않는다.

**Checkpoint**: 로컬 시작 화면 데모 가능. 서비스/저장소 ready 확인과 데이터 보존은 다음 단계다.

## Phase 4: User Story 2 - 연결 상태와 장애 구분하기 (Priority: P1)

**Goal**: 실제 연결 결과를 10초 이내에 보여주고 장애 후 다시 확인해 복구를 판단한다.
**Independent Test**: 정상·DB중단·API중단·복구를 각각 재현하고 상태·시각·비노출을 확인한다.

### Tests for User Story 2

- [X] T018 [P] [US2] apps/api/tests/health.contract.test.ts에 GET /api/health/ready의 200/503·no-store·UTC checkedAt·필드/enum·빈 테이블 정상·스키마 누락을 검증하는 실패 테스트를 작성한다. status “ready | degraded”, service “ok”, database “ok | unavailable | schema_missing”, code “OK | DATABASE_UNAVAILABLE | SCHEMA_NOT_READY”를 그대로 검사한다. FR-004/006.
- [X] T019 [P] [US2] apps/web/tests/health-state.test.tsx에 checking/ready/degraded/unavailable, 503과 무응답 구별, 비JSON·필드 오류, 10초 timeout, 역순 응답 무시, 서버 확인 시각과 클라이언트 시도 시각 구분을 검증하는 실패 테스트를 작성한다. FR-005.
- [X] T020 [US2] apps/api/src/health/health.service.ts에 실제 DB 연결과 BootstrapProbe 읽기, 스키마 누락 판정, 2초 연결·2초 쿼리·5초 서버 진단 예산과 연결 반환을 구현한다. 원시 SQL 오류를 고정 코드로 변환하고 Promise.race만으로 DB 취소를 대신하지 않는다.
- [X] T021 [US2] apps/api/src/health/health.controller.ts, apps/api/src/health/health.module.ts, apps/api/src/app.module.ts에 읽기 전용 엔드포인트를 연결한다. 계약의 필드·상태만 반환하며 cache/행 값/행 개수/SQL/접속정보를 노출하지 않는다. T018을 통과시킨다.
- [X] T022 [US2] apps/web/src/health/useHealth.ts와 apps/web/src/health/HealthPanel.tsx에 AbortController·증가 requestId·최신 결과만 반영·10초 제한을 구현한다. MUI 상태 표시/재확인/조치 안내, 텍스트와 aria-live를 제공하고 App.tsx에 연결한다. T019를 통과시킨다.
- [X] T023 [US2] tests/e2e/fixtures/environment.ts와 playwright.config.ts에 별도 시험 project/volume/포트·API/웹 기동·유한 대기·자기 프로세스 정리를 구성한다. scripts/test-integration.mjs와 package.json에 test:integration/test:e2e 진입점을 연결한다. test:integration은 scripts/tests/database-setup.test.mjs와 apps/api/tests의 health 계약·통합 테스트를 실제 시험 DB에서 실행한다. 루트 test의 scripts/tests 단위 테스트 포함 여부와 각 실행기의 테스트 발견 목록을 확인하고, finally 정리 실패를 성공으로 숨기지 않는다.
- [X] T024 [US2] tests/e2e/health.spec.ts와 apps/api/tests/health.integration.test.ts에서 실DB 정상·중단·복구·빈 스키마, API 중단·느린 응답, 반복 timeout 후 연결 누적 부재를 검증한다. 화면 10초/서버5초/DB2초 제한을 구분해 기록한다. FR-004/005, SC-002.
- [X] T025 [US2] tests/e2e/secret-redaction.spec.ts에 시험 비밀번호·토큰·전체 연결 문자열을 주입한 실패 시나리오를 추가하고 화면·로그·클라이언트 산출물에 노출 0건임을 확인한다. 정상/장애/복구 결과와 함께 work/001-app-bootstrap/us2.md에 비밀값 없이 기록한다. FR-006/010, SC-005.

**Checkpoint**: 화면에서 실제 상태를 확인할 수 있다. probe 쓰기·보존 검증은 아직 없다.

## Phase 5: User Story 3 - 데이터를 유지하며 재시작하고 검증하기 (Priority: P2)

**Goal**: 같은 검증 자료가 재시작 후에도 남고 점검 실패를 정확히 보고한다.
**Independent Test**: 한 번만 만든 동일 id/value가 재시작3회 후 유지되고, 정상 exit0 → DB장애 exit1 → 복구 exit0을 확인한 뒤 정리한다.

### Tests for User Story 3

- [X] T026 [P] [US3] scripts/tests/probe.test.mjs에 UUID/1~128자 검증, 같은 id/value 재시도, 다른 value 충돌, 누락/불일치 verify 실패, id 한 건만 cleanup, 원격/운영 DB 거부 실패 테스트를 작성한다. FR-007/009.
- [X] T027 [P] [US3] scripts/tests/verify-bootstrap.test.mjs에 필수 --id/--value, 진단과 저장값 확인, 정상0/DB장애1/불일치1, 없는 자료 자동 생성 금지와 실패 항목 표시를 검증하는 실패 테스트를 작성한다. FR-008.
- [X] T028 [US3] scripts/probe.mjs와 apps/api/src/database/probe.repository.ts에 create/verify/cleanup을 구현한다. 기존 id와 같은 value는 기존 결과, 다른 값은 충돌로 반환하며 조회 실패를 갱신으로 해결하지 않는다. DB 유일 제약으로 동시 create를 처리하고 cleanup은 지정 id만 대상으로 한다.
- [ ] T029 [US3] scripts/verify-bootstrap.mjs와 package.json에 probe/verify:bootstrap을 연결한다. T006 guard 이후 진단·지정 자료를 검사하고 성공0/실패1 및 비밀값 없는 결과를 반환한다. 도구 종료 시 DB 연결을 닫고 T026/T027을 통과시킨다.
- [ ] T030 [US3] tests/e2e/persistence.spec.ts에 probe를 최초 한 번 생성한 뒤 웹·API 종료와 DB down/up을 포함한 일반 재시작3회 검증을 추가한다. 매회 동일 id/value를 읽고 중간 create·seed·reset·volume 삭제를 금지한다. FR-007, SC-003.
- [ ] T031 [US3] tests/e2e/verification.spec.ts에 동일 probe의 정상0 → DB중단1(DB 실패 항목) → 복구0 순서를 검증한다. 전체 검증 후에만 해당 probe를 cleanup하고 다른 probe가 남는지 확인한다. FR-008/009, SC-004.
- [ ] T032 [US3] specs/001-app-bootstrap/quickstart.md의 보존·장애·정리 명령을 실제 실행하고 work/001-app-bootstrap/us3.md에 3회 보존·종료 코드·제한된 정리 결과를 기록한다. 운영 백업·복구 검증과 구분한다.

**Checkpoint**: US1~US3의 기능별 검증 가능. 전체 완료는 최종 점검과 팀원 재현 후 판단한다.

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T033 scripts/check-product.ps1에 실제 build/typecheck/test/test:integration/test:e2e 명령을 실행하고 실패 코드를 전달하는 제품 검사 진입점을 구현한다. scripts/check-harness.ps1과 docs/harness/manifest.json은 이 실행기에 연결하고 scripts/test-harness.ps1에 제품 성공/실패 전파 검증을 추가한 후에만 productChecksConfigured를 변경한다. 문서 검사와 제품 결과를 분리한다.
- [ ] T034 README.md, docs/harness/checks.md, docs/product/technical-design.md, specs/001-app-bootstrap/quickstart.md에 실제 명령·버전·검증 범위를 동기화한다. 전체 제품 R01~R25를 이 기능 완료만으로 구현 완료 표시하지 않는다.
- [ ] T035 새 사본에서 팀원 한 명이 추가 구두 도움 없이 최초 실행과 ready 확인을 수행하도록 하고 work/001-app-bootstrap/onboarding.md에 SC-001 결과를 기록한다. 에이전트 단독 실행으로 팀원 검증을 대체하지 않으며 참여 전에는 미검증으로 남긴다.
- [ ] T036 scripts/check-product.ps1 및 Harness 검사를 실행하고 work/001-app-bootstrap/final-verification.md에 FR-001~010/SC-001~005별 근거, 실제 exit code, 제한과 리뷰 지적 조치 결과를 기록한다. 미실행·실패·수동 확인 대기는 성공과 구별한다.
- [ ] T037 work/001-app-bootstrap/resume.md에 최종 변경·남은 항목·통합 준비 상태를 정리한다. 사용자 요청 시에만 검증된 기능을 develop에 병합하고 통합 테스트 후 main 최종 반영 절차를 따른다. 로컬 전용 변경을 포함하거나 main에 직접 push하지 않는다.

## Dependencies & Execution Order

### Phase Dependencies

T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010.
기반이 완료되면 사용자 흐름별 테스트를 먼저 작성하여 유효한 실패를 확인하고 구현한다.

### User Story Dependencies

- US1: T011/T012 병행 → T013/T014 → T015 → T016 → T017.
- US2: US1 후 T018/T019 병행 → T020 → T021 → T022 → T023 → T024 → T025.
- US3: US2 후 T026/T027 병행 → T028 → T029 → T030 → T031 → T032.
- 최종: T033 → T034 → T035 → T036 → T037.
- US2의 서버 계약 테스트와 US3 probe 로직은 기반 위에서 독립 검증할 수 있지만,
  전체 UI·verify:bootstrap 수용 검증에는 앞선 단계가 필요하다.
- package.json·App.tsx·공통 DB 연결·시험 fixture를 수정하는 작업은 병행하지 않는다.

### Parallel Opportunities / Examples

- US1: T011 웹 화면 테스트와 T012 서버·실행기 테스트는 파일이 달라 병행 가능.
  구현 역시 T013과 T014를 서로 다른 담당자가 처리하고 T015에서 통합할 수 있다.
- US2: T018 서버 계약 테스트와 T019 화면 상태 테스트는 병행 가능.
  서버 구현 T020/T021 완료 후 T022에서 실제 UI 계약을 연결한다.
- US3: T026 probe 테스트와 T027 검증 명령 테스트는 병행 가능.
  T028과 T029는 probe 구현 의존성이 있어 순서대로 수행한다.
- 병렬 예시는 작업 배치 가능성만 설명한다. 지금 에이전트를 생성하거나 구현을 시작하지 않는다.

## Requirement Coverage

| 요구사항/성공 기준 | 주요 작업 |
|---|---|
| FR-001 / SC-001 | T006, T016, T034, T035 |
| FR-002 | T011, T013, T017 |
| FR-003 | T005, T006, T012, T014, T015 |
| FR-004 | T018, T020, T021, T024 |
| FR-005 / SC-002 | T019, T020, T022, T024 |
| FR-006 / SC-005 | T005, T006, T014, T025 |
| FR-007 / SC-003 | T007~010, T026, T028, T030 |
| FR-008 / SC-004 | T027, T029, T031, T033 |
| FR-009 | T008, T026, T028, T031 |
| FR-010 | T005, T012~015, T017, T025 |

## Implementation Strategy

US1은 첫 데모 범위다. 명세의 준비 완료 상태까지 보여주는 최소 MVP는 US1+US2이며,
이번 기능 전체 완료에는 US3와 최종 검증이 필요하다.
기반 → US1 → US2 → US3 순서로 진행하고 각 체크포인트에서 명세와 결과를 대조한다.
후속 speckit.analyze에서 명세·계획·작업의 누락과 충돌을 먼저 확인한 뒤 구현에 들어간다.
이 목록 작성은 앱 구현·브랜치 병합·배포 승인이나 테스트 성공을 의미하지 않는다.

## Notes

- 37개 작업: 공통 준비/기반10, US1 7, US2 8, US3 7, 최종5.
- 체크는 실제 산출물과 검증 근거가 있을 때만 완료로 바꾼다.
- T001의 사용자 승인과 T035의 실제 팀원 참여가 필요한 지점은 미리 식별했다.
  현재 문서 작성에는 추가 승인이 필요하지 않다.
- 기존 상태를 변경하는 병합·커밋·push는 이번 작업에서 수행하지 않았다.
