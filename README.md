# HandOff

프로젝트별 개발 계약과 인수인계를 다루는 내부 웹서비스입니다. 현재는 로컬 개발용 웹·API·PostgreSQL 골격과 개발 환경 상태 화면까지 구현했습니다. 로그인, 프로젝트, 계약, 알림 기능은 아직 구현 전입니다.

## 로컬 시작

Windows PowerShell 7, Node.js 24.15 이상 25 미만, npm 10.9.2, Docker Desktop(Linux 컨테이너), Git이 필요합니다. 모든 명령은 저장소 루트에서 실행합니다. 자세한 순서와 충돌 대응은 `specs/001-app-bootstrap/quickstart.md`를 보세요.

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

기본 웹 주소는 http://127.0.0.1:5173 입니다. 화면에 `상태 확인` 버튼은 있지만 요청 대상인 health API가 아직 없어 `확인 불가`로 표시될 수 있습니다. 이 버튼은 DB 준비 상태 검증으로 사용할 수 없습니다.

종료할 때는 API·웹을 실행한 각 터미널에서 `Ctrl+C`를 누른 뒤, 저장소 루트의 별도 터미널에서 `npm run db:down`을 실행합니다. 개발 DB의 Docker volume은 유지됩니다.

## 현재 실행 가능한 검사

```powershell
npm run build
npm run typecheck
npm test
pwsh -NoProfile -File scripts/check-harness.ps1
```

앞의 세 명령은 현재 코드의 빌드·타입·DB 비의존 테스트입니다. `check-harness.ps1`은 문서 링크 검사를 통과했지만 제품 전체 검증은 아닙니다. `test-harness.ps1`은 현재 격리 fixture가 기술 설계 문서의 링크 대상인 `specs/001-app-bootstrap` 파일을 복사하지 않아 실패합니다. 이는 제품 부트스트랩 실패를 뜻하지 않습니다.

## 구현 예정

US2/US3의 DB 상태 진단 API·화면, `npm run test:integration`, `npm run test:e2e`, `npm run verify:bootstrap`, `npm run probe -- ...`의 생성·확인·정리는 아직 사용할 수 없습니다. npm 스크립트 항목이 있어도 연결된 구현 파일과 검증 흐름은 없습니다. 로그인, 프로젝트 접근, 계약 동의, Discord·Codex 연동과 운영 배포·백업도 구현 예정입니다.

## 기술과 작업 문서

웹은 React·TypeScript, API는 NestJS·TypeScript(Express), DB는 PostgreSQL·Prisma를 사용합니다. 개발에서는 DB만 Docker로 실행합니다. 운영 VM·백업 정책은 설계이며 현재 배포된 서비스가 아닙니다.

- [제품 명세](docs/product/spec.md)
- [기술 설계](docs/product/technical-design.md)
- 로컬 실행 상세: `specs/001-app-bootstrap/quickstart.md`
- [에이전트 지침](AGENTS.md)
- [작업 절차](docs/harness/workflow.md)
- [검증 기준](docs/harness/checks.md)

기능 브랜치는 `develop`에서 분기하고 검증·리뷰 후 `develop`에 병합합니다. 통합 테스트 후에만 `main`에 반영합니다. 이 문서의 로컬 실행은 병합이나 배포를 뜻하지 않습니다.
