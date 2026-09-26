# Tasks: 소셜 로그인과 가입 승인

**Input**: specs/002-auth-onboarding/spec.md
**Prerequisites**: plan.md, research.md, data-model.md, contracts/auth-api.md, quickstart.md
**Status**: T001~T012 구현 및 자동 검증 완료. T013의 실제 Google·Discord 앱 인증과 운영 설정 검증은 자격 증명 준비 후 진행.

## Phase 1: 독립 정책과 인증 시도

- [x] T001 [US1] apps/api/tests/auth-domain.test.mjs에 대기 회원 접근 차단과 승인 회원 생성 자격의 실패 테스트를 작성한다.
- [x] T002 [US2] apps/api/tests/auth-domain.test.mjs에 관리자 전용 승인·권한 부여와 미배정 콘텐츠 차단의 실패 테스트를 작성한다.
- [x] T003 [US3] apps/api/tests/auth-domain.test.mjs에 타인 계정 연결 충돌과 동일 회원 연결의 실패 테스트를 작성한다.
- [x] T004 apps/api/src/auth/domain.ts에 T001~T003의 정책을 구현하고 Node 24 단위 검증을 통과시킨다.
- [x] T005 [US1] apps/api/src/auth/oauth-attempt.ts와 apps/api/tests/oauth-attempt.test.mjs에 state 원문 비저장, 세션 결박, 재사용·만료 차단, Google nonce·PKCE 시험을 작성·구현한다.

## Phase 2: 앱 골격 통합 후 DB·API

- [x] T006 apps/api/prisma/schema.prisma와 새 migration.sql에 회원·제공자 연결·세션·시도·감사 기록 및 복합 유일 제약을 추가한다.
- [x] T007 [US1] apps/api/src/auth/와 auth.controller.ts에 Google/Discord code 로그인 및 대기 세션을 구현하고 계약 테스트를 통과시킨다.
- [x] T008 [US3] apps/api/src/auth/oauth-attempt.ts의 PostgreSQL 저장소와 연결 콜백의 타인 연결 충돌을 구현·검증한다.
- [x] T009 [US2] apps/api/src/admin/와 scripts/bootstrap-admin.mjs에 관리자 대기 목록·승인·관리자 부여·명시적 최초 관리자 지정을 구현·검증한다.

## Phase 3: 화면·통합

- [x] T010 [US1] apps/web/src/auth/LoginPage.tsx와 PendingPage.tsx에 로그인·대기 화면을 구현·검증한다.
- [x] T011 [US2] apps/web/src/auth/PendingUsersPage.tsx에 관리자 목록·승인 화면을 구현·검증한다.
- [x] T012 [US3] apps/web/src/auth/에 계정 연결·충돌 안내를 구현·검증한다.
- [ ] T013 tests/e2e/auth.spec.ts와 specs/002-auth-onboarding/quickstart.md에 R20·R23·R24 종단 검증과 실제 제공자 시험 결과를 반영한다.

## Dependencies

feature/app-bootstrap의 API·웹·DB 골격은 feature/auth-onboarding에 병합했다. T013의 실 제공자 검증과 배포 설정은 후속이다. 사용자 승인 없이 develop/main에 병합하지 않는다.
