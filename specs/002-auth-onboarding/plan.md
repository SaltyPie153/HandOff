# 소셜 로그인과 가입 승인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Google·Discord 로그인 뒤 서비스 관리자 승인 전에는 업무 접근을 막고, 두 제공자 계정을 명시적으로 한 회원에 연결한다.

**Architecture:** 내부 회원 ID와 제공자 계정 연결을 분리하고 DB 유일 제약으로 중복 가입·연결 경합을 막는다. 서버 세션은 PostgreSQL에 보존하며 보호 요청마다 현재 회원 승인 상태와 프로젝트 배정을 다시 읽는다. 다른 PC의 앱 골격이 아직 API/웹 진입점을 제공하지 않으므로 독립적인 정책 코드를 먼저 만들고, 골격 통합 후 데이터·OAuth·세션·화면을 순서대로 연결한다.

**Tech Stack:** Node 24, TypeScript 5.9, NestJS 12/Express, Prisma 7/PostgreSQL 17, React/MUI, Node test runner 및 기존 웹 시험 도구. OAuth는 서버 측 authorization-code 흐름; 구체 라이브러리는 통합 시 Node 24 및 제공자 호환성을 설치 검증해 고정한다.

**Spec:** [spec.md](spec.md) · [research.md](research.md) · [data-model.md](data-model.md) · [API contract](contracts/auth-api.md)

## Global Constraints

- Google·Discord 인증만 허용하고 최초 로그인은 PENDING이다.
- 이메일·표시 이름 일치로 회원을 합치지 않는다.
- 관리자 지정과 가입 승인은 명시적인 사람의 동작이다.
- 서비스 관리자 역할만으로 프로젝트 콘텐츠를 볼 수 없다.
- 앱 골격 브랜치가 완성되기 전 공용 package.json, 앱 진입점, Prisma 기본 설정을 중복 수정하지 않는다.
- 다른 PC의 untracked apps/, node_modules/, outputs/는 이 브랜치에서 정리·추가하지 않는다.
- 기능 브랜치에서 develop/main으로 자동 병합하지 않는다.

## Review Focus

- 동일 제공자 계정의 동시 첫 로그인: 한 회원만 생성하고 둘 다 같은 회원으로 수렴.
- 같은 이메일을 지닌 다른 제공자 계정: 자동 연결이나 승인 승계가 없음.
- 콜백 state 불일치·재사용·세션 변경: 로그인과 연결 모두 실패하며 계정 자료는 그대로.
- 승인 직후 오래된 세션: 새 요청에 현재 승인 상태를 적용.
- 관리자와 프로젝트 배정의 혼동: 관리자가 미배정 프로젝트 자료를 읽지 못함.

## File Map

- apps/api/src/auth/domain.ts: 가입 상태·행위 권한·연결 충돌에 대한 순수 정책.
- apps/api/tests/auth-domain.test.mjs: 정책의 권한 표와 경계 사례. 앱 골격 없이 실행 가능.
- apps/api/prisma/schema.prisma 및 migrations/: 회원·제공자 계정·세션·시도·감사 기록.
- apps/api/src/auth/providers/: Google·Discord code 교환과 검증을 격리.
- apps/api/src/auth/: 세션 저장·콜백·현재 회원·접근 가드.
- apps/api/src/admin/: 대기 목록·가입 승인·관리자 권한 부여.
- apps/web/src/auth/: 로그인·대기·관리자 목록 UI.
- apps/api/tests/, apps/web/tests/, tests/e2e/: 계약·경합·브라우저 검증.

## Task 1: 독립 인증 정책과 단위 검증

**Files:** create apps/api/src/auth/domain.ts; create apps/api/tests/auth-domain.test.mjs.
**Interfaces:** exports Member, Action, canPerform(member, action, projectAssigned), decideProviderLink(memberId, ownerId). Nest 가드와 연결 서비스가 이 함수를 호출한다.

- [ ] Step 1: 실패하는 테스트를 먼저 쓴다. PENDING은 STATUS/LOGOUT/LINK만 허용, APPROVED는 CREATE_PROJECT 허용, 관리자만 APPROVE/GRANT, 프로젝트 READ는 배정된 승인 회원만 허용. 연결 소유자가 다르면 CONFLICT.
- [ ] Step 2: node --experimental-strip-types --test apps/api/tests/auth-domain.test.mjs 로 실패를 확인한다.
- [ ] Step 3: 최소 TypeScript 정책 함수를 구현한다. 검증되지 않은 행위 문자열은 기본 거부한다.
- [ ] Step 4: 같은 명령으로 성공을 확인하고 Node 24에서 다시 실행한다.
- [ ] Step 5: 정책 파일과 시험 파일만 커밋한다.

Test shape:
    assert.equal(canPerform({id:'a', status:'PENDING', isServiceAdmin:false}, 'CREATE_PROJECT', false), false);
    assert.deepEqual(decideProviderLink('a','b'), {kind:'CONFLICT'});

## Task 2: 회원·연결·세션 스키마와 동시성

**Prerequisite:** 앱 골격의 Prisma7 초기 스키마·마이그레이션 및 시험 DB가 기능 브랜치에 통합됨.
**Files:** modify apps/api/prisma/schema.prisma; create 다음 순번 migration.sql; create apps/api/tests/auth-persistence.test.ts.
**Interfaces:** User.id, ProviderIdentity(provider, providerSubject) 유일 키, AuthSession, OAuthAttempt, ApprovalRecord, AdminGrantRecord.

- [ ] Step 1: 실DB 테스트에 동시 첫 가입 2회, 타인 연결 충돌, 승인 중복, 감사 기록 단일 생성을 적는다.
- [ ] Step 2: 시험 DB에서 실패를 확인한다.
- [ ] Step 3: schema와 migration에 복합 유일 제약·외래키·만료 시각을 구현하고 승인 변경/기록을 한 트랜잭션에 저장한다.
- [ ] Step 4: 같은 실DB 테스트와 migration 재적용 점검을 통과시킨다.
- [ ] Step 5: 스키마·migration·시험을 커밋한다.

## Task 3: 제공자 인증과 안전한 세션

**Prerequisite:** Nest 앱 진입점과 환경 설정/Prisma 서비스가 통합됨.
**Files:** create apps/api/src/auth/providers/google.ts, discord.ts; create apps/api/src/auth/oauth-attempt.service.ts, session.service.ts, auth.controller.ts, auth.module.ts; modify apps/api/src/app.module.ts; create apps/api/tests/oauth-contract.test.ts 및 session-contract.test.ts.
**Interfaces:** GET /api/auth/me, 제공자 start/callback, POST link start/logout. 계약은 contracts/auth-api.md를 따른다.

- [ ] Step 1: state 위조·재사용·취소, 연결 세션 교체, Google sub/Discord id, 세션 재발급·로그아웃의 실패 테스트를 작성한다.
- [ ] Step 2: 계약 시험의 실패를 확인한다.
- [ ] Step 3: Google OIDC 검증과 Discord 최소 identify 조회를 구현한다. 토큰은 저장하지 않고 검증된 제공자 키만 저장한다. 세션 쿠키는 HttpOnly·Secure(운영)·SameSite=Lax와 만료를 적용한다.
- [ ] Step 4: 같은 계약 시험과 비밀값 비노출 검사를 통과시킨다.
- [ ] Step 5: 공급자·세션 코드와 시험을 커밋한다.

## Task 4: 가입 승인과 관리자 권한

**Prerequisite:** Task 2~3.
**Files:** create apps/api/src/admin/admin.controller.ts, admin.service.ts, admin.module.ts; create scripts/bootstrap-admin.mjs; create apps/api/tests/admin-contract.test.ts.
**Interfaces:** GET /api/admin/pending-users, POST approve/grant-admin. 명시적 bootstrap은 이미 생성된 회원 ID를 받으며 첫 가입자 자동 승격은 없다.

- [ ] Step 1: 일반 회원의 관리자 API 거부, 승인 중복, 미승인 대상의 관리자 부여 거부, 명시적 최초 관리자 지정, 미배정 관리자의 콘텐츠 접근 거부 테스트를 작성한다.
- [ ] Step 2: 실패를 확인한다.
- [ ] Step 3: 현재 상태 기반 가드, 조건부 승인 및 감사 기록, 관리자 부여와 bootstrap 명령을 구현한다.
- [ ] Step 4: API·DB 시험을 통과시킨다.
- [ ] Step 5: 관리자 코드·시험을 커밋한다.

## Task 5: 로그인·대기·관리자 화면

**Prerequisite:** 앱 골격 React/MUI 시작 화면과 API 계약 구현.
**Files:** create apps/web/src/auth/LoginPage.tsx, PendingPage.tsx, PendingUsersPage.tsx, useViewer.ts; modify apps/web/src/App.tsx; create apps/web/tests/auth-pages.test.tsx.
**Interfaces:** /login, /pending, /admin/pending, 승인 후 프로젝트 선택 자리. 화면만이 아니라 API 거부가 권한의 원본이다.

- [ ] Step 1: 로그인 선택, 대기·로그아웃·제공자 연결, 관리자 목록·승인, 비관리자 접근 안내의 실패 컴포넌트 시험을 작성한다.
- [ ] Step 2: 실패를 확인한다.
- [ ] Step 3: API 응답에 따라 라우팅하고 실패·충돌을 분명히 보여준다.
- [ ] Step 4: 컴포넌트 시험과 접근성 점검을 통과시킨다.
- [ ] Step 5: 웹 코드·시험을 커밋한다.

## Task 6: 통합·실제 제공자 검증

**Prerequisite:** 앱 골격 전체 및 Task 1~5.
**Files:** create tests/e2e/auth.spec.ts; update specs/002-auth-onboarding/quickstart.md and 관련 운영 설정 예시.
**Interfaces:** 제품 기준 R20, R23, R24.

- [ ] Step 1: 두 사용자/두 제공자, 대기 차단, 관리자 승인, 동일 회원 연결, 경합·세션 종료, 미배정 자료 접근 거부의 종단 시험을 작성한다.
- [ ] Step 2: 실패를 확인하고 구현·설정 결함을 수정한다.
- [ ] Step 3: build, typecheck, 단위·실DB·브라우저 시험을 실행한다.
- [ ] Step 4: 실제 Google/Discord 시험 자격 증명으로 callback을 확인하고 결과·미검증 범위를 work/auth-onboarding/verification.md에 남긴다.
- [ ] Step 5: 검증 근거와 문서를 커밋하고 리뷰한다. 사용자 승인 없이 develop/main에 병합하지 않는다.

## Spec coverage

FR-001/002/010~013은 Tasks 2~3, FR-003/004/009는 Tasks 1/3/5, FR-005~008은 Tasks 2/4가 담당한다. SC-001~005는 Task 6의 자동·실연동 검증으로, SC-006은 내부 팀원 확인으로 판정한다. 골격 완료 전 Task 1만 독립적으로 실행 가능하며 나머지 미착수 항목을 완료로 표시하지 않는다.
