# Local Bootstrap Contracts

이 계약은 구현 예정이다. 업무 API와 공개 운영 인터페이스가 아니다.

## HTTP 진단

GET /api/health/ready
입력 없음. 쓰기 없음. Cache-Control: no-store.
개발 API는 127.0.0.1에만 바인딩하며 production에서는 시작을 거부한다.
Vite proxy를 통해 같은 origin으로 호출한다. 임의 origin에 CORS를 개방하지 않는다.

HTTP 200:
```json
{
  "status": "ready",
  "checkedAt": "2026-09-21T07:00:00.000Z",
  "service": "ok",
  "database": "ok",
  "code": "OK"
}
```

HTTP 503: 동일 필드를 사용하되 status=degraded.
database=unavailable/code=DATABASE_UNAVAILABLE 또는
database=schema_missing/code=SCHEMA_NOT_READY.
테이블이 비어 있는 것은 정상이며 존재하지 않는 경우에만 schema_missing이다.

서비스 무응답·proxy 오류·비JSON·필드 불일치는 클라이언트 unavailable로 판정한다.
정상 JSON의 HTTP 503은 service=ok/database 실패로 표시한다.
서버 응답 예산 5초, 클라이언트 전체 요청 제한 10초.
DB 연결/쿼리 제한과 리소스 반환을 검증하며 취소 후 작업 누적을 허용하지 않는다.
응답과 로그에는 고정 오류 코드·시각만 허용한다. 원시 예외를 그대로 기록하지 않는다.

## UI

HandOff / 개발 환경 / 서비스 상태 / 저장소 상태 / 확인 시각 / 다시 확인 버튼.
상태는 색과 함께 텍스트로 표시한다. 버튼은 키보드로 조작 가능하고 결과는 aria-live로 알린다.
확인 중임을 표시하며 새 요청이 이전 결과로 덮이지 않게 한다.
오류 시 설정 확인·DB 실행·다시 확인 중 해당하는 다음 행동을 안내한다.
DB 스키마 누락은 db:migrate 실행 안내, API 미접속은 API 프로세스 확인 안내를 제공한다.
가입·로그인·가짜 프로젝트·인수인계 메뉴는 이 화면에 제공하지 않는다.

## 환경 계약

루트 .env는 Git 제외. dev:init이 최초 한 번 개발 전용 값을 생성하고 기존 파일은 보존한다.
필수: NODE_ENV(development/test), DATABASE_URL, POSTGRES_USER,
POSTGRES_PASSWORD, POSTGRES_DB, API_PORT, WEB_PORT, DB_PORT.
DATABASE_URL은 생성 시 위 DB 설정에서 구성한다. 설정이 불일치하면 실행 전 오류로 알린다.
.env.example의 비밀번호는 자리표시자이며 복사만으로 준비 완료가 되었다고 가정하지 않는다.
브라우저 코드에 DATABASE_URL이나 POSTGRES_PASSWORD를 주입하지 않는다.
기본 포트 5173/3000/5432, 시험 환경 5174/3001/5433. 충돌 시 자동 증가하지 않는다.

## 개발 명령 계약

| 루트 npm 명령 | 동작 | 성공/실패 |
|---|---|---|
| dev:init | 최초 개발 .env 생성, 기존 파일 보존 | 0 / 1 |
| db:up | dev Compose DB 시작, ready까지 제한 시간 대기 | 0 / 1 |
| db:down | dev Compose 종료, volume 유지 | 0 / 1 |
| db:generate | Prisma client 생성 | 0 / 1 |
| db:migrate | 체크인된 migration 적용, 자동 reset 없음 | 0 / 1 |
| dev:web | Vite 시작, loopback·strictPort | 정상 실행 유지 / 1 |
| dev:api | tsc watch와 로컬 Node 실행 | 정상 실행 유지 / 1 |
| build | client 생성 후 웹·API 빌드 | 0 / 1 |
| typecheck | 양 workspace 타입 검사 | 0 / 1 |
| test | 웹 컴포넌트·API 단위·scripts/tests의 DB 비의존 테스트 전체 | 0 / 1 |
| test:integration | scripts/tests/database-setup.test.mjs 및 API health 계약·통합 테스트를 전용 시험 DB에서 실행 | 0 / 1 |
| test:e2e | 별도 시험 환경 정상·장애·복구·보존 확인 | 0 / 1 |
| verify:bootstrap | 실행 중 개발 환경 진단과 지정 probe 일치 검사 | 0 / 1 |
| probe -- create --id UUID --value TEXT | 검증 자료 생성 | 0 / 1 |
| probe -- verify --id UUID --value TEXT | 저장 내용 일치 확인 | 0 / 1 |
| probe -- cleanup --id UUID | 해당 검증 자료만 삭제 | 0 / 1 |

verify:bootstrap은 --id/--value를 필수로 받아 존재하지 않는 자료를 자동 생성하지 않는다.
초기 부팅 smoke와 '재시작 후에도 남아 있음'은 별도로 기록한다.
test:e2e는 test 전용 Compose project/volume에서 장애를 주입하고 finally에서 자원 정리한다.
cleanup 누락·검증 실패를 숨기지 않고 실패 항목·종료 코드를 출력한다.
운영/원격 DB나 허용하지 않은 DB 이름이면 probe·migration·검증 명령 모두 먼저 거부한다.


루트 test는 세 테스트 묶음을 모두 실행 대상으로 등록하고 하위 실패를 전달한다. 실DB 테스트는 test:integration으로 분리하여 이중 실행하지 않는다. 구현 시 테스트 발견 목록으로 누락을 확인한다.
