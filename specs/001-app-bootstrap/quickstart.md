# Quickstart Validation: 앱 기본 골격

**상태: 구현 예정 검증 가이드. 아래 npm 명령·앱·Compose 파일은 아직 없다.**
구현 단계에서 이 명령 계약을 제공한 뒤 실제 결과를 기록한다.
현재 문서만 읽고 실행 성공·앱 완성을 주장하지 않는다.

## 준비

Windows, PowerShell7, 선택 버전의 Node24/npm, Docker Desktop Linux containers와 Git.
정확한 버전은 구현 시 고정 파일을 따른다. 저장소 루트에서 실행한다.
첫 설치만 다운로드가 필요하며 외부 로그인·Discord·GCP 계정은 필요하지 않다.
개발 포트가 비어 있어야 한다. 기존 .env를 덮어쓰지 않는다.

## 최초 실행

```powershell
npm ci
npm run dev:init
npm run db:up
npm run db:generate
npm run db:migrate
npm run build
```

각 단계가 실패하면 그 자리에서 중단하고 비밀값 없이 표시된 원인을 해결한다.
서로 다른 두 터미널에서 다음을 실행한다.

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

http://127.0.0.1:5173 에서 HandOff / 개발 환경 / 준비 완료를 확인한다.
포트를 변경했다면 설정된 주소를 따른다.
이 화면은 프로젝트 선택·로그인 기능이 아니다.

## 보존 확인

```powershell
$probeId = [guid]::NewGuid().ToString()
$probeValue = 'bootstrap-persistence-check'
npm run probe -- create --id $probeId --value $probeValue
npm run verify:bootstrap -- --id $probeId --value $probeValue
```

각 실행의 종료 코드를 확인한다. 정상에서는 0.
웹·API를 Ctrl+C로 종료하고 db:down → db:up을 수행한 뒤 API·웹을 다시 시작한다.
매회 같은 id/value로 verify:bootstrap을 실행하여 총3회 성공을 확인한다.
재시작 도중 create를 재실행하면 보존 증거가 되지 않는다.
volume 삭제·DB reset·자동 seed를 이 과정에 넣지 않는다.
실패·복구 확인이 모두 끝날 때까지 같은 probe를 유지한다.

## 실패·복구 확인

1. 같은 id/value로 verify:bootstrap이 exit0임을 먼저 확인한 뒤 DB를 db:down으로 중지한다. 화면 '다시 확인'은 10초 이내 DB 실패를 표시한다.
   API는 계속 응답한다. verify:bootstrap은 exit1이며 실패 항목이 DB 연결이어야 한다.
2. db:up으로 DB를 복구한다. 다시 확인하면 ready로 복귀하고 같은 id/value의 verify:bootstrap이 다시 exit0이어야 한다.
3. API를 종료한다. 다시 확인하면 서비스 실패/DB 확인 불가가 10초 이내 표시된다.
   API 재시작 후 다시 확인하면 복구된다.
4. 별도 시험 설정에서 필수 변수 누락·잘못된 URL·포트 충돌을 재현한다.
   변수 이름/원인만 표시하며 시험 비밀값·전체 URL은 출력되지 않아야 한다.
5. 시험 전용 빈 DB에서 migration 전에는 SCHEMA_NOT_READY,
   migration 후에는 ready임을 확인한다. 개발 DB를 지우지 않는다.
6. 느린 응답과 연속 확인을 시험하여 오래된 결과가 최신 상태를 덮지 않는지 확인한다.

## 자동 검증과 문서 검증

```powershell
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
pwsh -NoProfile -File scripts/check-harness.ps1
pwsh -NoProfile -File scripts/test-harness.ps1
```

test:integration/test:e2e는 시험 전용 설정·DB·포트를 준비하고 개발 환경과 분리한다.
[명령 계약](contracts/local-bootstrap.md)을 따른다.
Harness 결과는 별도로 기록한다. 제품 검증 미연결 상태의 NOT_CONFIGURED를 통과로 바꾸지 않는다.
실제 팀원 한 명이 새 사본에서 구두 도움 없이 실행하는 SC-001은 별도 수동 검증한다.

## 검증 자료 정리

정상 → 장애 → 복구 검증이 모두 끝나면 사용한 검증 자료만 정리한다.

```powershell
npm run probe -- cleanup --id $probeId
```

## 증거와 종료

work/001-app-bootstrap/에 사용 버전·명령·종료 코드·상태 확인 소요 시간·3회 보존 결과·
시험 비밀값 비노출 결과와 미검증 항목을 기록한다. 실제 비밀값은 기록에 남기지 않는다.
사용한 자기 프로세스만 종료하고 db:down으로 개발 DB를 멈춘다. volume은 보존한다.
