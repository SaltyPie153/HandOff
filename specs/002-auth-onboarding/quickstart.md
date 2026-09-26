# 인증 기능 검증 안내

## 선행 조건

1. `feature/auth-onboarding`에는 앱 골격이 병합되어 있다. Node 24와 Docker를 준비하고 저장소 루트에서 `npm ci`, `npm run dev:init`, `npm run db:up`, `npm run db:migrate`를 실행한다.
2. Google와 Discord에 별도 OAuth 앱을 만들고 로컬 callback URI를 등록한다. Google은 `http://127.0.0.1:5173/api/auth/google/callback`과 `/api/auth/links/google/callback`, Discord는 같은 경로의 `discord` 버전을 사용한다. `.env`에 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`을 추가한다. 비밀값은 저장소에 커밋하지 않는다.
3. `npm run dev:api`와 `npm run dev:web`을 별도 터미널에서 실행하고 `http://127.0.0.1:5173/`을 연다. 개발 연결 상태 화면은 `/dev/health`에 있다.
4. 실제 최초 관리자로 사용할 계정으로 한 번 로그인해 승인 대기 화면을 연다. 회원 ID는 운영자가 DB의 `users`와 `provider_identities`를 확인해 검증한다. 검증한 UUID를 `npm run build` 후 `node --env-file=.env scripts/bootstrap-admin.mjs <회원-UUID>`에 명시한다. 첫 가입자 자동 승격은 없다. 이 명령은 이미 관리자가 지정된 경우 실패한다.

## 자동 검증

- `npm test`: 정책·제공자·OAuth 시도·API 단위 테스트와 웹 컴포넌트 테스트.
- `npm run test:integration`: 격리된 PostgreSQL에서 제공자 계정 동시 가입, 연결 충돌, 승인/감사 기록, 일회용 시도, 세션 회전, HTTP 권한·CSRF를 확인한다.
- `npm run test:e2e`: Playwright Chromium을 설치한 뒤 로그인 화면→대기→관리자 승인→프로젝트 선택을 브라우저에서 확인한다. 실제 제공자 응답은 이 시험에 포함되지 않는다.
- 실제 제공자 시험: Google와 Discord 각각 시험 계정으로 callback과 연결을 별도로 점검한다.

## 완료 판정

R20·R23·R24의 이 기능 범위를 입증해야 한다. 프로젝트 목록·본문·첨부와 Discord 알림은 후속 기능의 검증 대상이다. 실제 Google/Discord OAuth 앱 자격 증명이 없으면 자동 검증과 실연동 미검증을 구분해 기록한다. 운영 환경의 공개 도메인과 HTTPS reverse proxy 설정은 별도 배포 작업에서 확정한다.
