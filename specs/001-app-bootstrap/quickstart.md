# 로컬 Quickstart: 앱 기본 골격

현재 실행 가능한 범위는 개발 DB, API·웹 프로세스, 기본 상태 화면입니다. 아래 명령은 Windows PowerShell 7에서 **저장소 루트**를 현재 디렉터리로 두고 실행합니다. Node.js는 `>=24.15 <25`, npm은 10.9.2를 사용하며 Docker Desktop을 Linux 컨테이너 모드로 시작합니다. 최초 `npm ci`에는 패키지 다운로드가 필요합니다. 외부 로그인·Discord·GCP 계정은 필요하지 않습니다.

## 준비와 첫 실행

터미널 1에서 순서대로 실행하고, 실패한 단계가 있으면 원인을 해결한 뒤 다시 진행합니다.

```powershell
npm ci
npm run dev:init
npm run db:up
npm run db:generate
npm run db:migrate
```

`dev:init`은 로컬 `.env`가 없을 때만 무작위 DB 비밀번호를 담아 생성하고 기존 파일은 보존합니다. `.env`는 Git 제외 파일이며 `.env.example`의 비밀번호는 자리표시자입니다. 실제 비밀번호·토큰·`DATABASE_URL`은 문서, 로그, 이슈에 붙여 넣지 마세요. `db:up`은 개발용 Compose DB가 준비될 때까지 기다립니다. `db:migrate`는 저장소의 기존 migration을 적용하며 DB를 초기화하지 않습니다.

준비 후 터미널 2와 3을 열고, 각각 저장소 루트에서 다음 명령을 실행한 채 둡니다.

터미널 2 — API:

```powershell
npm run dev:api
```

터미널 3 — 웹:

```powershell
npm run dev:web
```

기본 주소 http://127.0.0.1:5173 에서 `HandOff`와 `개발 환경` 화면을 엽니다. `상태 확인` 버튼의 요청 대상 `/api/health/ready`는 아직 구현되지 않아, API가 실행 중이어도 `확인 불가`로 표시될 수 있습니다. 이 화면으로 DB·스키마 상태를 검증하지 마세요. API와 웹은 `127.0.0.1`에서 실행되며 기본 포트는 각각 3000, 5173입니다. DB 포트는 5432입니다.

## 다시 시작하고 종료하기

평소 다시 시작할 때는 `npm ci`, `dev:init`, `db:generate`, `db:migrate`를 매번 반복할 필요가 없습니다. 코드·의존성·migration 변경에 따라 필요한 단계만 다시 수행하고 `npm run db:up` 다음 API·웹을 시작합니다.

종료 시 터미널 3(웹)과 터미널 2(API)에서 각각 `Ctrl+C`를 누르고 종료를 확인합니다. 그다음 저장소 루트의 터미널 1에서 실행합니다.

```powershell
npm run db:down
```

이 명령은 `handoff-dev` 개발 Compose 프로젝트를 내리고 DB volume을 보존합니다. `docker compose down -v`, volume 삭제, DB reset은 일반 종료 절차에 포함되지 않습니다. 다른 프로세스나 컨테이너를 종료하지 마세요.

## 포트 충돌

API가 `DEV_API_FAILED: PORT_IN_USE: API_PORT`, 웹이 `DEV_WEB_FAILED: PORT_IN_USE: WEB_PORT`로 종료되면 각각 설정된 포트가 점유된 상태입니다. 웹과 API는 빈 다음 포트로 자동 이동하지 않습니다. DB 포트 충돌은 `npm run db:up`의 Docker 포트 바인딩 오류로 나타날 수 있습니다. `.env`의 세 포트가 서로 같으면 `PORT_COLLISION: PORT` 진단도 발생합니다.

현재 점유 포트와 PID는 다음 읽기 전용 명령으로 확인합니다. `.env`에서 포트를 바꾼 경우 숫자 목록도 맞춰 바꿉니다.

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000,5173,5432 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

점유자가 자신의 이전 개발 프로세스라면 해당 터미널에서 `Ctrl+C`로 종료합니다. 다른 용도의 프로세스라면 그대로 두고 `.env`의 `API_PORT`, `WEB_PORT` 또는 `DB_PORT`를 비어 있는 서로 다른 포트로 변경한 뒤 해당 서비스를 다시 시작합니다. DB 포트를 바꿀 때는 `DATABASE_URL`의 포트도 같은 값으로 맞춰야 합니다. 설정의 사용자·비밀번호·DB 이름도 서로 일치해야 하며, 기존 volume의 자격 증명을 임의로 바꾸면 접속이 실패할 수 있습니다. 바뀐 웹 주소는 새 `WEB_PORT`로 접속합니다.

## 현재 실행 가능한 검사

저장소 루트에서 필요할 때 실행합니다. `build`는 Prisma client를 생성하고 API·웹을 빌드합니다. `test`는 현재 DB 비의존 스크립트·API·웹 테스트입니다.

```powershell
npm run build
npm run typecheck
npm test
pwsh -NoProfile -File scripts/check-harness.ps1
```

Harness 문서 검사와 앱 빌드·단위 테스트의 범위를 구분해 기록합니다. `test-harness.ps1`은 현재 격리 fixture가 `docs/product/technical-design.md`에서 참조하는 `specs/001-app-bootstrap` 파일을 복사하지 않아 실패하며, 통과한 부트스트랩 검사로 기록할 수 없습니다. 이 fixture 문제는 제품 부트스트랩 실패를 뜻하지 않습니다. 현재 통과 검사만으로 실제 DB 연결, 장애 복구, 보존성 또는 제품 기능 완료를 주장할 수 없습니다.

## 구현 예정: US2/US3 검증

다음은 [로컬 부트스트랩 계약](contracts/local-bootstrap.md)에 정의된 후속 범위이며 **현재 실행 절차가 아닙니다**.

- DB·스키마를 검사하고 고정 오류 코드를 반환하는 `/api/health/ready` 및 그 결과를 표시하는 화면, 재확인·타임아웃·장애 복구 흐름
- `npm run test:integration`: 전용 시험 DB 기반 API·DB 통합 검사
- `npm run test:e2e`: 전용 시험 환경의 브라우저 정상·장애·복구 검사
- `npm run verify:bootstrap -- --id ... --value ...`: 보존성 검증
- `npm run probe -- create|verify|cleanup ...`: 검증 자료 생성·확인·정리

이 npm 스크립트 이름은 `package.json`에 있지만 연결할 구현 파일이나 완성된 시험 흐름이 아직 없습니다. 따라서 이전 초안에 적힌 3회 보존 확인, DB 중단 중 10초 내 장애 표시, 재시작 복구, probe cleanup 명령은 지금 실행·성공을 기록하지 않습니다. 해당 구현이 추가되면 별도 시험 DB와 검증 증거를 준비해 이 문서를 갱신합니다.
