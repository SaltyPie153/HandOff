# 프로젝트 결정

## 확정된 방향

- 제품 원본은 [제품 명세 v1.2](../product/spec.md) 하나다. 기술·운영 결정은 [기술 설계](../product/technical-design.md)에서 관리한다.
- 프로젝트 선택 → 공통 공간 → 내 공간. 프로젝트 팀원은 전송된 본문까지 열람한다.
- Codex 초안을 사람이 검토하고 전송한다. 일반 인수인계 확인과 개발 계약 동의를 구분한다.
- PM은 필수 확인 또는 참조로 참여한다. 사람의 승인과 에이전트 조회는 별도다.
- 내부 4~5명 팀부터 검증하고 공개 서비스로 확장한다.
- Harness는 문서와 PowerShell 7 검사기로 시작한다. 자체 오케스트레이터는 만들지 않는다.

## 확정 기술·회원·운영 정책

- React + TypeScript, Node.js + NestJS + TypeScript와 기본 Express 어댑터.
- 직접 운영하는 PostgreSQL과 Prisma.
- Google·Discord 소셜 로그인 후 서비스 관리자 승인. 이메일 자동 병합 없이 로그인 상태에서 다른 제공자를 연결한다.
- 최초 서비스 관리자는 사용자 본인 계정을 명시 지정한다. 서비스 관리자가 이후 다른 승인 회원에게 관리자 권한을 부여한다.
- 승인 회원 누구나 프로젝트를 생성하고 생성자가 프로젝트 관리 담당자가 된다.
- 프로젝트별 배정 후 접근한다. 프로젝트 관리 담당자도 승인 회원을 자기 프로젝트에 추가·제외할 수 있다. 서비스 관리 권한과 프로젝트 관리 권한은 구분한다.
- GCP 서울 리전 asia-northeast3의 VM 한 대. 비용 최소화와 신규 무료 크레딧 활용을 기준으로 한다.
- Docker + Compose: 개발은 DB만 Docker, React·NestJS는 로컬. 운영은 웹 서버·API·DB를 Compose로 실행한다.
- DB 데이터와 첨부 원본은 VM 영구 디스크, 외부 백업은 하루 1회 Cloud Storage에 7일 보관. 운영 전 복구를 검증한다.
- 2026-09-21 기술 선택 당시 앱·Compose·인증·백업·배포의 구현과 검증은 아직 수행하지 않았다. 앱 기본 골격의 이후 진행은 아래 최신 기록을 따른다.

## 아직 결정하지 않은 사항

- CI/CD. 패키지 패치·빌드·UI·제품 테스트 명령 계약은 앱 기본 골격에서 고정·실행했으며 아래 최신 기록을 따른다.
- Codex 연결 방식 검증, Discord 알림 설치·권한과 로그인 미연결 사용자 처리.
- 도메인·GCP 프로젝트·VM 사양·최초 관리자 식별값·OAuth 앱 설정·백업 시각과 복구 절차.
- 가입 거절·계정 연결 해제·프로젝트 관리자 양도·첨부 제한 등 [남은 확인 사항](../product/technical-design.md).

미결정 사항을 완료로 간주하지 않는다. 제품 코드 구현 전에 관련 기술 검증과 결정을 기록한다.

## 개발 환경 결정

- 초기 빈 저장소의 첫 구현은 worktree 기준 커밋이 없어 `harness/bootstrap` 작업 공간에서 시작했으며, 이후 아래 브랜치 운영 규칙으로 전환했다.
- 제품 명세와 Harness 설계는 저장소 내부로 이전했다. 외부 전달 폴더에는 원본 안내만 둔다.
- 검사기는 링크 파일 존재를 검사하며 웹 URL 응답, Markdown 앵커, 제품 동작을 검증하지 않는다.

## 브랜치 운영 — 2026-09-21 사용자 결정

- `feature/<기능명>`에서 작업하고 `develop`에 병합한 뒤 통합 테스트를 거쳐 최종적으로 `main`에 병합한다.
- 초기 `harness/bootstrap` 작업은 `feature/agent-harness`로 옮긴다. 빈 기준 커밋으로 `develop`을 먼저 만들고 실제 파일은 기능 브랜치에 커밋한다.
- 기본 브랜치는 `main`이다. 초기 설정을 바로잡아 `main`과 `develop`을 같은 빈 기준 커밋에 두고 GitHub 기본 브랜치를 `main`으로 설정했다. 실제 기능 변경은 `feature/agent-harness`에 유지한다.
- 브랜치 보호와 CI는 별도 설정 사항이며, 문서화만으로 강제 적용됐다고 간주하지 않는다.

## 이번 문서 반영의 선행 변경

- `feature/technical-design`은 `develop`에서 생성한 뒤 필요한 기존 `feature/agent-harness` 커밋을 fast-forward로 포함했다. Harness가 develop에 아직 병합되지 않았기 때문이다.
- 이번 작업으로 `main` 또는 `develop`에 병합하지 않는다. 기술 설계 변경 자체는 기존 Harness 이후의 문서 변경으로 검토한다.

## 앱 기본 골격 계획 — 2026-09-21

- [Spec Kit 계획](../../specs/001-app-bootstrap/plan.md)을 기준으로 구현한다.
- npm workspaces의 웹·API 두 앱, Vite, React와 MUI Material/Emotion을 선정했다.
- 사용자가 UI 라이브러리를 지금 선정하도록 요청했으며, MUI와 shadcn/ui 비교 근거는 기능 조사 기록에 둔다.
- Node24 LTS, TypeScript5.9, Nest12, Prisma7, PostgreSQL17 계열을 선택했다. 실제 패치·이미지 digest는 설치 검증 후 고정한다.
- 이 2026-09-21 계획 기록 시점에는 설계만 완료했고 앱 설치·실행·브랜치 병합·push를 수행하지 않았다.

## 앱 기본 골격 진행 상태 — 2026-09-26

- `feature/app-bootstrap`에서 React/MUI 웹, NestJS API, Prisma/PostgreSQL 개발 DB와 상태 진단·개발용 probe를 구현했다. 정확한 패키지 버전과 DB 이미지 digest는 package/lock 및 Compose에 고정했다.
- 제품 검사(build·typecheck·unit·실DB 통합·E2E)와 Harness 검사는 로컬에서 종료 코드 0으로 실행했다. 실제 팀원 한 명은 지원 도구가 준비된 새 사본에서 Quickstart만으로 시작 화면의 ready를 확인했다고 보고했다. 팀원 PC 원본 로그는 별도로 읽지 않았다.
- 기능 브랜치는 원격에 push했고 `develop` 대상 PR을 준비 중이다. 병합·운영 배포는 아직 하지 않았다. 로그인·권한·계약·첨부·외부 연동·GCP 백업과 복구는 후속 범위다.

## 인증 구현 결정 — 2026-09-26

- 서비스 세션은 PostgreSQL에 원문 대신 SHA-256 토큰 해시로 보관하고 7일 뒤 만료한다. 상태 변경 API는 세션에 결박된 CSRF 토큰을 요구한다. 매 보호 요청에서 현재 회원 상태를 다시 읽는다.
- OAuth 시도는 state 해시를 10분간 보관하고 원자적으로 한 번만 소비한다. 연결 저장 직전 세션 행을 잠가 로그아웃·만료를 다시 확인한다. Google ID 토큰의 서명·발급자·대상·만료·nonce를 확인하고, Discord는 code 교환 후 `identify` 신원 조회만 사용한다. 제공자 토큰은 DB에 저장하지 않는다.
- 로컬 OAuth callback은 웹 개발 서버의 `/api` 프록시를 통해 돌아오도록 `WEB_PORT`를 기준으로 만든다. 운영 공개 도메인과 HTTPS reverse proxy는 배포 작업에서 확정한다.
- Prisma CLI는 루트 스크립트가 사용하므로 루트 개발 의존성으로 둔다. npm workspace의 전이 의존성 override가 적용되도록 `deepmerge-ts` 8.0.2와 `mysql2` 3.24.4를 루트에서 고정했다. 이 조합은 로컬 생성·빌드·격리 DB 검증과 `npm audit` 경고 0건으로 확인했다.
- 인증 기능은 `feature/auth-onboarding`에서만 구현했다. 실제 Google·Discord OAuth 앱 자격 증명 시험과 운영 배포는 미완료다.
