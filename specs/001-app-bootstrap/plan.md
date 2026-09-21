# Implementation Plan: 앱 기본 골격과 로컬 실행

**Branch**: 현재 `feature/technical-design`; 구현 예정 `feature/app-bootstrap` | **Date**: 2026-09-21 | **Spec**: [spec.md](spec.md)

**Input**: `specs/001-app-bootstrap/spec.md`
**Status**: Phase 0 조사·Phase 1 설계 완료. 앱 구현·설치·실행 검증 전.
setup-plan의 BRANCH 출력 `001-app-bootstrap`은 기능 식별자이며 실제 Git 브랜치가 아니다.

## Summary

npm workspaces로 React 웹과 NestJS API를 분리하고 로컬 PostgreSQL에 Prisma로 연결한다.
사용자 요청에 따라 UI 라이브러리도 선정하여 MUI를 사용한다.
개발 시작 화면에서 연결 결과와 확인 시각을 표시하고, 개발 전용 검증 자료로 재시작 후 보존을 확인한다.
구현 전 도구 버전을 정확히 고정하고 정상·장애·복구·비밀값 비노출을 검증한다.

## Technical Context

**Language/Version**: Node.js 24 LTS (24.15 이상 최신 보안 패치), TypeScript 5.9 계열.
**Primary Dependencies**: React 19, Vite 8, NestJS 12/Express, Prisma 7, pg 및 Prisma PostgreSQL adapter,
MUI Material의 React 19 호환 안정 버전과 Emotion. npm workspaces.
정확한 패치·peer dependency는 설치 전 검증하여 package.json과 package-lock.json에 고정한다.
이는 최신 버전을 무조건 추적하라는 지시가 아니다.
**Storage**: PostgreSQL 17의 유지보수 패치 이미지와 digest, Compose named volume.
**Testing**: API는 tsc로 컴파일한 node:test + @nestjs/testing, 웹은 Vitest + Testing Library,
브라우저 흐름은 Playwright Chromium. 루트 test는 웹 컴포넌트·API 단위·scripts/tests의 DB 비의존 테스트를 모두 실행한다. database-setup.test.mjs와 health 계약·통합 테스트는 test:integration에서 실제 시험 DB로 실행하며, test:e2e는 브라우저 흐름을 검증한다. 각 실행기는 하위 실패를 종료 코드로 전달한다. PowerShell 7 실행 가이드를 제공한다.
**Target Platform**: Windows 개발 PC, Docker Desktop Linux containers, PowerShell 7.
**Project Type**: 단일 저장소 웹 + API; 이번 단계는 로컬 실행 전용.
**Performance Goals**: 화면 확인 전체 10초 이내, 서버 진단 5초 이내, DB 연결·쿼리 각각 2초 제한.
**Constraints**: 외부 계정 불필요, loopback 바인딩, 비밀값 비노출, 데이터 보존,
자동 마이그레이션·초기화 금지, 일반 종료에 volume 삭제 금지.
**Scale/Scope**: 개발자 4~5명, 시작 화면 1개, 읽기 전용 진단 1개, 개발 전용 검증 테이블 1개.

## Constitution Check

| 원칙 | 조사 전 판단 | 설계 후 근거 |
|---|---|---|
| I 명세 우선 | 통과: FR-001~010 정의 | 아래 요구사항-설계-검증 추적표 |
| II 사람의 승인 | 해당 없음: 업무 승인 기능 제외 | 사용자·권한·승인 데이터를 생성하지 않음 |
| III 권한 경계 | 통과: 업무 자료 접근 없음 | loopback 전용, production 시작 거부, 쓰기 HTTP 없음 |
| IV 합의 정합성 | 해당 없음: 계약 기능 제외 | 검증 자료를 계약으로 사용하지 않음 |
| V 서비스 원본 | 통과: 실제 기록 제외 | 진단은 DB 실조회, 가짜 정상값 금지 |
| VI 증거 기반 완료 | 통과: 검증 계획 수립 | 문서 검증과 앱 테스트 구분, 실패 exit code |
| VII 단순 운영 | 통과: 웹·API·DB만 사용 | npm 기본 기능, 별도 큐·캐시·오케스트레이터 없음 |

운영 백업·복구와 두 사용자 업무 회신 검증은 후속 기능의 필수 조건으로 유지한다.
이번 개발 DB 보존 검증으로 운영 복구 검증을 대체하지 않는다.

## Project Structure

### Documentation (this feature)

```text
specs/001-app-bootstrap/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── local-bootstrap.md
└── checklists/requirements.md
```

tasks.md는 다음 speckit.tasks 단계에서 생성한다.

### Source Code (repository root)

아래는 구현할 경로이며 현재 존재하는 앱 파일 목록이 아니다.

```text
apps/
  web/src/                 # MUI 시작 화면, 상태 확인
  web/tests/
  api/src/                 # 설정, 진단, Prisma 연결
  api/tests/
  api/prisma/              # schema와 개발 검증 테이블 migration
  api/prisma.config.ts
scripts/
  dev-init.mjs
  verify-bootstrap.mjs
  probe.mjs
tests/e2e/
compose.dev.yml
package.json
package-lock.json
.env.example
```

**Structure Decision**: apps/web와 apps/api 두 workspace와 루트 lockfile을 사용한다.
공유 패키지·라우터·전역 상태 라이브러리는 현재 화면 하나에 필요하지 않아 도입하지 않는다.
MUI theme와 컴포넌트로 화면을 구성한다. 엔드포인트 DTO는 [계약](contracts/local-bootstrap.md)으로 검증한다.

## Implementation Design

1. 버전 확인과 의존성 exact pin 후 lockfile 생성. Node/npm 버전·이미지 digest 기록.
   API는 ESM/NodeNext와 decorator metadata를 사용하는 tsc 빌드로 구성한다.
2. dev:init은 루트 .env를 최초 한 번 생성하며 기존 파일은 덮어쓰지 않는다.
   DB용 임의 로컬 비밀번호를 생성하고 전체 값은 로그에 출력하지 않는다.
   .env.example은 변수 이름·예시 비밀값 자리표시자만 제공한다.
3. 웹 127.0.0.1:5173, API 127.0.0.1:3000, PostgreSQL 127.0.0.1:5432.
   Vite strictPort로 포트 충돌 시 실패하며 /api 경로를 로컬 API로 proxy한다.
   포트 설정은 루트 .env에서 공통으로 읽고 브라우저에는 비밀 설정을 전달하지 않는다.
4. API 부팅 시 설정의 형식과 개발 대상 DB를 검증한다. DB가 내려가도 진단 API는 시작하며
   HTTP 503과 status=degraded, service=ok, database=unavailable, code=DATABASE_UNAVAILABLE를 반환한다. 잘못된 필수 설정은 변수 이름·오류 코드만 출력하고 종료한다.
5. 진단은 연결과 BootstrapProbe 테이블 읽기를 수행하여 누락 migration도 구분한다.
   pool 연결 제한·서버 statement timeout·query timeout으로 미완료 작업을 제한한다.
   단순 Promise.race만으로 DB 작업이 취소됐다고 간주하지 않는다.
6. React 상태는 idle/checking/ready/degraded/unavailable.
   fetch AbortController와 요청 순번으로 이전 결과를 무시한다. 자동 무한 재시도는 없다.
7. probe CLI만 검증 행을 생성·조회·정리한다. 업무용 HTTP 쓰기 API는 만들지 않는다.
   DB 이름·loopback·NODE_ENV guard로 운영 오접속을 방지한다.
8. 개발용 API는 NODE_ENV=production에서 시작을 거부한다. 추후 운영 지원 시 이 차단을
   단순 제거하지 말고 인증·배포 명세에 따라 진단 경계를 재설계한다.

## Verification and Traceability

| 요구사항 | 설계 | 검증 |
|---|---|---|
| FR-001,002 | 초기화·문서·MUI 시작 화면 | 깨끗한 사본의 팀원 실행 SC-001 |
| FR-003 | 설정 검증, strictPort, bind 오류 | 누락·잘못된 설정·포트 충돌 |
| FR-004,005 | 진단 API, timeout, 최신 요청만 반영 | 정상/DB중단/API중단/복구, 역순 응답 SC-002 |
| FR-006 | allowlist 오류 코드·로그, 환경 비밀값 제외 | 시험 비밀값 출력 검색 SC-005 |
| FR-007 | named volume, probe CLI | down/up 포함 일반 재시작 3회 SC-003 |
| FR-008 | verify:bootstrap과 Harness 구분 | 정상 exit 0/DB중단 exit 1 SC-004 |
| FR-009,010 | 별도 검증 테이블·loopback·production 차단 | 운영 대상 거부, 외부 자격 증명 없는 실행 |

시험 기록은 work/001-app-bootstrap/에 두고 실제 명령·exit code·환경·남은 제약을 기록한다.
제품 검증을 추가할 때 Harness의 productChecksConfigured만 true로 바꾸지 않는다.
검사기가 실제 제품 검사 결과를 전달하도록 의미 있는 실행기를 구현·검증한 후 변경한다.

## Integration Sequence

현재 develop에는 선행 Harness·기술 문서가 없다. 구현 전 별도 통합 단계에서
공유 대상 문서와 SDD 산출물을 선별하여 검증·리뷰하고 사용자 승인 후 develop에 병합한다.
로컬 전용 경로 변경과 outputs는 자동 stage하지 않는다.
이후 develop에서 feature/app-bootstrap을 생성한다. 이번 작업은 브랜치 생성·병합·push를 하지 않는다.

## Complexity Tracking

헌법 위반 없음. MUI는 사용자 요청에 따른 UI 구성 선택이며 유료 컴포넌트·별도 디자인 시스템은 추가하지 않는다.
