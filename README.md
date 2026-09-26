# HandOff

프로젝트별 개발 계약과 인수인계를 다루는 내부 웹서비스입니다. 현재는 로컬 개발용 웹·API·PostgreSQL 골격과 개발 환경 상태 화면까지 구현했습니다. 로그인, 프로젝트, 계약, 알림 기능은 아직 구현 전입니다.

## 로컬 시작

Windows PowerShell 7, Node.js 24.15 이상 25 미만(`.node-version`: 24.21.0), npm 10.9.2, Docker Desktop(Linux 컨테이너), Git이 필요합니다. 모든 명령은 저장소 루트에서 실행합니다. 자세한 순서와 충돌 대응은 [Quickstart](specs/001-app-bootstrap/quickstart.md)를 보세요.

```powershell
npm ci
npm run dev:init
npm run db:up
npm run db:generate
npm run db:migrate
```

`dev:init`은 처음에만 로컬 `.env`를 생성하며 기존 파일은 보존합니다. `.env`는 Git 제외 파일입니다. `.env.example`의 비밀번호는 자리표시자이므로 그대로 복사해 사용하지 마세요. 비밀번호나 실제 `DATABASE_URL`을 기록·공유하지 마세요.

준비 명령이 모두 성공하면 터미널 두 개를 더 열어 각각 저장소 루트에서 실행합니다.

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

기본 웹 주소는 http://127.0.0.1:5173 입니다. `상태 확인`은 실제 `GET /api/health/ready` 결과를 표시합니다. `준비 완료`는 현재 개발 DB 연결과 BootstrapProbe 테이블 조회가 성공했다는 뜻이며, 가입·계약 기능이나 데이터 복구 가능성을 뜻하지 않습니다.

자신이 시작한 API·웹은 각 터미널에서 `Ctrl+C`로 종료합니다. 자신이 소유한 개발 DB만 종료할 때 `npm run db:down`을 사용하며 Docker volume은 유지됩니다. 공유 중인 DB에는 이 명령을 실행하지 마세요.

## 현재 실행 가능한 검사

```powershell
npm run build
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
pwsh -NoProfile -File scripts/check-harness.ps1
pwsh -NoProfile -File scripts/test-harness.ps1
pwsh -NoProfile -File scripts/check-product.ps1
```

`npm test`는 DB 비의존 테스트입니다. `test:integration`은 먼저 `handoff-foundation-*` 시험 Compose 프로젝트·volume에서 빈 DB migration을 검사하고, 이어 `handoff-test-*` fixture에서 통합 검사를 수행합니다. `test:e2e`는 `handoff-test-*` fixture를 사용합니다. 각 실행기는 자신이 만든 시험 자원의 정리를 시도하고 실패를 보고합니다. 시험 포트 5433(DB), 3001(API), 5174(웹)가 비어 있어야 합니다. E2E에는 동일 probe의 웹·API·DB 재시작 3회 보존과 정상→DB 장애→복구 검증, 지정 ID 정리가 포함됩니다. 실행 순서와 자원 소유 조건은 Quickstart를 따르세요.

`check-harness.ps1` 기본 실행은 문서·링크 검사만 하고 `PRODUCT: NOT_RUN`을 출력합니다. `test-harness.ps1`은 검사기의 격리 fixture를 시험합니다. `check-product.ps1`은 build → typecheck → test → test:integration → test:e2e를 실행합니다. `check-harness.ps1 -RequireProduct`도 같은 제품 실행기를 호출합니다. 성공 범위는 앱 기본 골격이며 [R01~R25](docs/harness/checks.md)의 업무·운영 검증으로 확대 해석하지 않습니다.

## 후속 구현

Google·Discord 로그인, 서비스 가입 승인, 프로젝트 접근, 계약 동의, 알림·Codex 연동과 운영 배포·DB/첨부 백업·복구는 구현 전입니다. 개발용 보존 시험은 운영 백업·복구 검증을 대체하지 않습니다.

## 기술과 작업 문서

웹은 React·TypeScript, API는 NestJS·TypeScript(Express), DB는 PostgreSQL·Prisma를 사용합니다. 개발에서는 DB만 Docker로 실행합니다. 운영 VM·백업 정책은 설계이며 현재 배포된 서비스가 아닙니다.

- [제품 명세](docs/product/spec.md)
- [기술 설계](docs/product/technical-design.md)
- 로컬 실행 상세: `specs/001-app-bootstrap/quickstart.md`
- [에이전트 지침](AGENTS.md)
- [작업 절차](docs/harness/workflow.md)
- [검증 기준](docs/harness/checks.md)

기능 브랜치는 `develop`에서 분기하고 검증·리뷰 후 `develop`에 병합합니다. 통합 테스트 후에만 `main`에 반영합니다. 이 문서의 로컬 실행은 병합이나 배포를 뜻하지 않습니다.
