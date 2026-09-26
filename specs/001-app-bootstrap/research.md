# Research: 앱 기본 골격

조사일: 2026-09-21. 문서 호환성 확인이며 실제 설치·빌드 성공을 주장하지 않는다.

## 1. 저장소와 패키지 관리

- Decision: npm workspaces, apps/web와 apps/api, 루트 lockfile 1개.
- Rationale: Node와 함께 제공되는 도구로 두 앱을 관리하며 별도 모노레포 실행기가 필요 없다.
- Alternatives: pnpm은 유효하지만 이번 규모에서 도구를 추가할 필요가 없다. 별도 저장소는 통합 검증이 번거롭다.
- Source: [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces).

## 2. 화면과 UI 라이브러리

- Decision: React 19 + Vite 8 + MUI Material/Emotion. 사용자에게 UI 라이브러리 포함 선정을 요청받았다.
- Rationale: 상태·버튼·알림·레이아웃을 기존 컴포넌트로 구성하고 후속 업무 화면에도 재사용한다.
- Alternatives: shadcn/ui는 컴포넌트 소스를 소유·수정하기 좋지만 그 소스를 직접 유지해야 한다.
  기본 CSS만 쓰는 방안은 사용자의 이번 선택에 따라 제외했다.
- 첫 화면은 Container/Stack/Typography/Alert/Button 등 기본 컴포넌트로 제한한다.
  유료 MUI X나 DataGrid는 설치하지 않는다. 별도 라우팅·전역 상태·아이콘 패키지도 현재 불필요하다.
- Sources: [MUI 설치](https://mui.com/material-ui/getting-started/installation/),
  [shadcn/ui](https://ui.shadcn.com/), [Vite 시작](https://vite.dev/guide/).
- 구체적인 MUI 안정 버전은 React 19 peer 범위를 확인하여 exact pin한다.

## 3. 런타임·버전·모듈

- Decision: Node 24 LTS (24.15 이상 보안 패치), TypeScript 5.9, NestJS 12,
  Prisma 7 및 adapter-pg, PostgreSQL 17 유지보수 패치, API ESM.
- Rationale: Node24는 Nest 도구 요구를 충족한다. 기존 모듈 호환 코드가 없으므로 ESM으로 통일한다.
  TypeScript 5.9는 선택한 보수적 기준이지 최신 버전 주장이나 TS6 비호환 주장이 아니다.
  PostgreSQL17은 지원 중인 버전이며 새로운 major 업그레이드가 이번 기능에 필요하지 않다.
- Alternatives: Nest11/CommonJS와 PostgreSQL18도 가능하지만 새 앱의 기준은 위 조합으로 한다.
- Prisma client는 명시적 출력 경로와 ESM 형식으로 생성하고 PostgreSQL adapter를 사용한다.
  prisma.config.ts에서 CLI 접속과 .env 로딩을 명시한다. generate와 migrate는 별도 명령으로 둔다.
- Sources: [Node releases](https://nodejs.org/en/about/previous-releases),
  [Nest migration](https://docs.nestjs.com/migration-guide),
  [Prisma7 requirements](https://www.prisma.io/docs/orm/v7/reference/system-requirements),
  [Prisma client](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction),
  [PostgreSQL version policy](https://www.postgresql.org/support/versioning/),
  [TypeScript5.9](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html).

버전 고정 절차: 구현 첫 작업에서 안정 릴리스의 engines/peerDependencies를 조회하고
동일 major 내 호환 패치를 exact pin한다. Prisma CLI/client/adapter는 같은 릴리스로 맞춘다.
Node/npm은 도구 버전 파일·packageManager에, PostgreSQL은 patch tag와 digest에 기록한다.
npm ci, generate, build, 연결 테스트로 조합을 입증한다. 충돌 시 임의 major 변경 대신 연구 결정을 갱신한다.

## 4. 테스트

- Decision: API는 tsc 이후 node:test 및 @nestjs/testing, 웹은 Vitest와 Testing Library,
  E2E는 Playwright Chromium.
- Rationale: API 테스트와 실제 빌드의 decorator metadata 처리 차이를 줄인다.
  브라우저 테스트는 사용자 상태 판정과 장애·복구를 검증한다.
- Alternatives: API까지 Vitest로 통일할 수 있으나 이번에는 Nest 컴파일 설정과의 추가 통합을 피한다.
- Sources: [Nest testing](https://docs.nestjs.com/fundamentals/testing),
  [Node test runner](https://nodejs.org/api/test.html),
  [Vitest](https://vitest.dev/guide/), [Playwright](https://playwright.dev/docs/intro).
- 설치 시 Vite8/Node24와 peer 호환되는 Vitest 안정 버전을 고정한다.
  테스트 실행기가 많아지는 대신 각각 서버 컴파일·브라우저 컴포넌트·실브라우저 검증에 한정한다.

## 5. 연결 확인과 데이터 보존

- Decision: 읽기 전용 HTTP 진단 + 개발 전용 probe CLI. DB named volume.
- Rationale: 초기 화면에 로그인 우회 경로나 쓰기 기능을 만들 필요가 없다.
  DB 연결뿐 아니라 초기 migration 적용 여부까지 확인한다.
- Alternatives: SELECT 1만으로는 필요한 테이블 준비를 판정할 수 없다.
  인메모리 DB는 실제 PostgreSQL 영속성 검증을 대신할 수 없다.
- Sources: [Docker volumes](https://docs.docker.com/engine/storage/volumes/),
  [node-postgres client 설정](https://node-postgres.com/apis/client).
- 화면 전체 10초 제한은 서버 5초·DB 연결/쿼리 각2초 예산과 별도 브라우저 timeout으로 구현한다.
  실제 장애 조건에서 제한 시간과 연결 반환을 검증한다.

## 미결정 항목 처리

이번 기능의 도구·구조·UI·진단·검증 방식은 결정했다.
정확한 패치 잠금은 구현 시점의 재현성 작업이다.
인증 세션·가입 거절·첨부·운영 배포·Discord/Codex는 현재 범위 밖이므로 후속 명세에서 결정한다.
## 구현 시점 버전 검증 — 2026-09-21

- Node.js 24.21.0을 npm의 임시 실행 환경에서 확인했다. 시스템 기본 Node.js는 22.16.0이다.
- npm registry에서 React 19.3.0, Vite 8.3.0, NestJS 12.0.3, Prisma CLI/client/adapter 7.10.0,
  TypeScript 5.9.3, MUI Material 9.4.0, Vitest 5.0.1, Playwright 1.63.0을 확인했다.
  Prisma `latest` dist-tag는 8.0.0-rc.15라서 그대로 사용하지 않고 7.10.0을 고정한다.
- PostgreSQL 17.11-bookworm 공식 이미지의 manifest digest는
  `sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652`이다.
  [PostgreSQL 17.11](https://www.postgresql.org/docs/17/release-17-11.html),
  [Docker Hub tag](https://hub.docker.com/_/postgres/tags?name=17.11-bookworm).
- 2026-09-25 재개 환경에서 Docker Desktop 4.81.0, Engine 29.6.1, Compose 5.2.0으로
  고정 digest 이미지를 pull하고 개발·시험 DB가 각각 healthy가 되는 것을 확인했다.
  두 환경은 loopback의 5432/5433 포트와 별도 project·named volume을 사용하며,
  일반 down 후에도 두 volume이 유지됐다.
- 설치 시 npm의 peer dependency와 빌드 결과를 다시 확인한다. 위 버전 조회만으로 조합의 실행 성공을 주장하지 않는다.
