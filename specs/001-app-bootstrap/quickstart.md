# 로컬 Quickstart: 앱 기본 골격

현재 실행 가능한 범위는 개발 DB, API·웹 프로세스, 실제 DB 상태 화면과 격리된 보존·장애 검증입니다. 아래 명령은 Windows PowerShell 7에서 **저장소 루트**를 현재 디렉터리로 두고 실행합니다. `.node-version`은 Node.js 24.21.0이고 허용 범위는 `>=24.15 <25`, npm은 10.9.2입니다. `node --version`으로 범위를 확인하고 Docker Desktop을 Linux 컨테이너 모드로 시작합니다. 최초 `npm ci`와 Playwright Chromium 설치에는 다운로드가 필요합니다. 외부 로그인·Discord·GCP 계정은 필요하지 않습니다.

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

`db:up`에서 `DB_COMMAND_FAILED: DOCKER_NOT_FOUND`가 나오면 현재 PowerShell에서 Docker CLI를 찾을 수 있는지 확인하세요. `DB_COMMAND_FAILED: DOCKER_UNAVAILABLE`이면 Docker Desktop의 Linux 엔진이 실행 중이고 접근 가능한지 확인하세요. 둘 다 비밀값을 표시하지 않는 진단이며, 다른 컨테이너를 임의로 종료하지 마세요.

준비 후 터미널 2와 3을 열고, 각각 저장소 루트에서 다음 명령을 실행한 채 둡니다.

터미널 2 — API:

```powershell
npm run dev:api
```

터미널 3 — 웹:

```powershell
npm run dev:web
```

기본 주소 http://127.0.0.1:5173 에서 `HandOff`와 `개발 환경` 화면을 엽니다. `상태 확인`을 누르면 웹이 `GET /api/health/ready`를 호출합니다. `준비 완료`는 해당 시점의 DB 연결과 BootstrapProbe 테이블 조회 성공이며, 장애 시 서비스·저장소 상태와 확인 시각을 구분해 표시합니다. 로그인·계약 기능이나 운영 복구 상태는 확인하지 않습니다. API와 웹은 `127.0.0.1`에서 실행되며 기본 포트는 각각 3000, 5173입니다. 개발 DB 포트는 5432입니다.

## 다시 시작하고 종료하기

평소 다시 시작할 때는 `npm ci`, `dev:init`, `db:generate`, `db:migrate`를 매번 반복할 필요가 없습니다. 코드·의존성·migration 변경에 따라 필요한 단계만 다시 수행하고 `npm run db:up` 다음 API·웹을 시작합니다.

종료 시 자신이 시작한 터미널 3(웹)과 터미널 2(API)에서 각각 `Ctrl+C`를 누르고 종료를 확인합니다. 자신이 소유한 개발 DB이고 다른 사용자가 쓰지 않는 것이 확인된 경우에만 저장소 루트의 터미널 1에서 실행합니다.

```powershell
npm run db:down
```

이 명령은 `handoff-dev` 개발 Compose 프로젝트를 내리고 DB volume을 보존합니다. 공유 중이거나 소유자가 불분명한 개발 DB는 계속 실행해 두세요. `docker compose down -v`, volume 삭제, DB reset은 일반 종료 절차에 포함되지 않습니다. 다른 프로세스나 컨테이너를 종료하지 마세요.

같은 PC의 여러 작업 사본은 현재 고정된 `handoff-dev` Compose 이름과 volume을 공유할 수 있습니다. 실행 전 기존 컨테이너의 작업 경로를 확인해 다른 사본이면 거부하지만, 확인 직후의 경합과 컨테이너 없이 volume만 남은 경우의 소유권은 완전히 판별하지 못합니다. 여러 사본에서 개발 DB를 동시에 다루지 말고, 소유자가 불분명하면 `db:up/down`을 실행하지 않은 채 팀과 확인하세요. 기존 volume을 임의로 삭제하거나 다른 사본으로 자동 이전하지 않습니다.

## 포트 충돌

API가 `DEV_API_FAILED: PORT_IN_USE: API_PORT`, 웹이 `DEV_WEB_FAILED: PORT_IN_USE: WEB_PORT`로 종료되면 각각 설정된 포트가 점유된 상태입니다. 웹과 API는 빈 다음 포트로 자동 이동하지 않습니다. DB 포트 충돌은 `npm run db:up`의 Docker 포트 바인딩 오류로 나타날 수 있습니다. `.env`의 세 포트가 서로 같으면 `PORT_COLLISION: PORT` 진단도 발생합니다.

현재 점유 포트와 PID는 다음 읽기 전용 명령으로 확인합니다. `.env`에서 포트를 바꾼 경우 숫자 목록도 맞춰 바꿉니다.

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000,5173,5432 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

점유자가 자신의 이전 개발 프로세스라면 해당 터미널에서 `Ctrl+C`로 종료합니다. 다른 용도의 프로세스라면 그대로 두고 `.env`의 `API_PORT`, `WEB_PORT` 또는 `DB_PORT`를 비어 있는 서로 다른 포트로 변경한 뒤 해당 서비스를 다시 시작합니다. DB 포트를 바꿀 때는 `DATABASE_URL`의 포트도 같은 값으로 맞춰야 합니다. 설정의 사용자·비밀번호·DB 이름도 서로 일치해야 하며, 기존 volume의 자격 증명을 임의로 바꾸면 접속이 실패할 수 있습니다. 바뀐 웹 주소는 새 `WEB_PORT`로 접속합니다.

## 현재 실행 가능한 검사

저장소 루트에서 필요할 때 실행합니다. `build`는 Prisma client를 생성하고 API·웹을 빌드합니다. `test`는 DB 비의존 스크립트·API·웹 테스트입니다. DB·브라우저 검사는 다음 절의 격리 시험 자원을 사용합니다.

```powershell
npm run build
npm run typecheck
npm test
pwsh -NoProfile -File scripts/check-harness.ps1
pwsh -NoProfile -File scripts/test-harness.ps1
```

`check-harness.ps1` 기본 실행은 문서·링크만 검사하고 `PRODUCT: NOT_RUN`을 출력합니다. `test-harness.ps1`은 검사기의 격리 fixture와 실패 코드 전파를 확인합니다. 두 명령의 성공만으로 제품 검사가 실행됐다고 기록하지 마세요.

## 격리 DB·브라우저 검증

Docker Desktop이 실행 중이고 127.0.0.1의 시험 포트 5433(DB), 3001(API), 5174(웹)가 비어 있는지 확인합니다. 개발 DB 5432와 별개입니다. 다른 사용자의 시험 환경이 포트를 점유했다면 그 자원을 중단하지 말고 이용 가능할 때 실행합니다. 처음 설치한 PC에서는 `npm ci` 후 아래 Chromium 설치도 수행합니다.

```powershell
npx playwright install chromium
Get-NetTCPConnection -State Listen -LocalPort 5433,3001,5174 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,OwningProcess
npm run test:integration
npm run test:e2e
```

포트 확인 명령에 listener가 표시되면 소유자를 확인하고 빈 포트에서만 시험합니다. `test:integration`은 먼저 `handoff-foundation-*` Compose project/volume의 빈 `handoff_test` DB에 초기 migration을 명시적으로 적용·재적용하고, 이어 `handoff-test-*` project/volume에서 나머지 통합 검사를 실행합니다. `test:e2e`는 별도의 `handoff-test-*` fixture를 만듭니다. 실행기는 설정·포트·DB 대상을 확인하고 자신이 만든 두 종류의 시험 자원을 종료 시 정리하려 시도하며, 정리 실패를 보고합니다. 기존 `handoff-dev` 컨테이너·volume을 내리거나 초기화하지 않습니다.

`test:integration`은 시험 DB 초기 migration과 health 계약·실DB, probe·검증 명령을 시험합니다. `test:e2e`에는 다음 [로컬 부트스트랩 계약](contracts/local-bootstrap.md)의 보존·장애 흐름이 포함됩니다.

1. 시험 DB에 무작위 UUID/value probe를 **한 번만** 생성합니다. 웹·API 종료 → 시험 DB의 일반 `down`/`up` → API·웹 재시작을 3회 반복하고 매회 화면 `준비 완료`와 동일 id/value의 `PROBE_VERIFIED`를 확인합니다. 반복 중 create·seed·reset·volume 삭제는 하지 않습니다.
2. 별도 시험 probe에서 `verify-bootstrap` 정상 종료 0(`DATABASE: OK`, `PROBE: OK`) → 시험 DB 중단 종료 1(`DATABASE: FAIL`) → 복구 후 종료 0을 확인합니다.
3. 전체 확인 뒤 해당 ID만 cleanup하고 대상 부재와 다른 sentinel probe의 존속을 확인한 뒤 sentinel도 정리합니다. 시험 fixture가 마지막에 자신이 만든 컨테이너·volume을 정리합니다.

한 번에 제품 골격 검사 전체를 실행하려면 `pwsh -NoProfile -File scripts/check-product.ps1`을 사용합니다. 순서는 build → typecheck → test → test:integration → test:e2e이며 하위 실패를 전달합니다. `pwsh -NoProfile -File scripts/check-harness.ps1 -RequireProduct`는 Harness 문서 검사 후 같은 제품 실행기를 호출합니다. 개발용 DB의 3회 보존은 운영 GCP 백업·첨부 복구 검증이 아닙니다. [R01~R25](../../docs/harness/checks.md)의 업무·운영 기준은 미구현/미검증입니다.
