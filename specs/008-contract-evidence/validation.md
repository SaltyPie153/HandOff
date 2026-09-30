# 확정 계약 근거 연결 검증

기준일: 2026-09-30. 작업 브랜치 `feature/contract-evidence`, develop 기준 `d4a78ed`.
Node.js24.19.0, PostgreSQL17 Docker의 disposable Compose 시험 환경을 사용했다. 기존 수동 앱·DB와 비밀 파일을 보존했다.

## 실행한 검증

모든 셸은 `rtk proxy`로 실행했다. 이 PC의 ignored `work/contract-evidence/node24.ps1`은 번들 Node24를 선택하며 `run-npm.mjs`는 npm CLI의 원래 종료 코드와 로그를 기록한다.

| 명령/범위 | 실제 결과 |
|---|---|
| `npm ci`, `node scripts/dev-init.mjs`, `npm run db:generate` | 종료0. 새 작업공간에서만 설치·로컬 설정·Prisma 생성. 개발 DB up/migrate 미실행 |
| 공용 파서·판정·Solar 입력 RED→GREEN | 모듈 부재, 모호한 같은 키 줄의 잘못된 AUTO_REPLY, 들여쓰기 입력 불일치 재현 후 해결 |
| `node work/contract-evidence/run-db.mjs apps/api/tests/contract-evidence.integration.test.mjs` | 종료0, 실제 DB3/3. 현재 버전/프로젝트/충돌/만료/정합성 실패/감사 분리 |
| worker·게시 경합 및 기존 계약/세션/버전 회귀 | 종료0, 실제 DB23/23. 실제 PG lock wait의 양방향 순서, 파일-only·동시 worker·권한·lease·키·사람 회신 |
| requeue·worker·게시 경합 순차 실행 | 종료0, 실제 DB22/22. 확정 이벤트, 이전 실행 무효화, 사람 종료 경합 양방향, 구버전·모델/권한 실패 제외 |
| `npm run test --workspace @handoff/web` | 종료0,67/67. 최초/변경 도움말 표시·폐기 미표시 |
| `node node_modules/@playwright/test/cli.js test tests/e2e/contract-evidence.spec.ts` | 종료0,1/1. A/B 웹 합의→MCP 요청→C 최소 회신→폐기 뒤 B 비공개 검토 |

| `npm run build` | 종료0. API·웹·MCP 빌드 |
| `npm run typecheck` | 종료0. 세 workspace 타입 검사 |
| `npm test` | 종료0. scripts23, API63통과/DB59skip, 웹67, MCP5통과 |
| `npm run test:integration` | 종료0. 시험 DB migration·API 실행 및 모든 등록 통합 파일·probe 검사 |
| `npm run test:e2e` | 종료0.13/13(1.8분), 새 계약 근거 흐름 포함 |
| `pwsh -NoProfile -File scripts/check-harness.ps1` | 종료0,14필수 파일·56로컬 링크 PASS. PRODUCT: NOT_RUN(제품 검증은 위 별도 실행) |
| `pwsh -NoProfile -File scripts/test-harness.ps1` | 종료0,18격리 시나리오 PASS |
| `git diff --check` | 종료0 |

전체 명령은 `rtk proxy powershell -NoProfile -File work/contract-evidence/node24.ps1 work/contract-evidence/run-npm.mjs run,build run,typecheck test run,test:integration run,test:e2e`로 순차 실행했다. 로그는 ignored work 디렉터리에 있으며 비밀 값은 포함하지 않는다.

## 실패와 처리

- Docker Linux engine이 정지해 초기 fixture의 DB_UP/CLEANUP이 실패했다. Docker Desktop을 숨김 실행해 준비를 확인한 뒤 새 시험 DB에서 재실행했다.
- raw Node에 기존 TS source 테스트를 전달해 `ERR_MODULE_NOT_FOUND`가 발생했다. 컴파일된 dist 테스트 경로로 실행해 통과했다.
- 기존 경합 시험은 두 계약 행 잠금 대기를 기대했다. 새 순서의 첫 계약 행·후속 프로젝트 advisory 대기를 각각 실제로 관측하도록 수정해 통과했다.
- focused helper가 여러 파일을 동시에 실행해 전역 worker 큐에서 시험 간섭1건이 발생했다. 단독8/8과 정식 runner의 순차 실행을 확인하고 helper를 같은 순서로 맞춰22/22 통과했다. 동일 시험 안의 동시 worker 검사는 유지했다.
- 의도한 RED 실패는 구현 누락을 입증한 검사다. 해결되지 않은 제품 실패로 보고하지 않는다.

## 한계와 미검증

- 단위 명령의 DB skip은 실DB 통과와 구분한다. 위 DB 결과는 실제 migration이 적용된 격리 DB에서 skip0이다.
- E2E는 실제 브라우저·웹·API·DB를 사용하지만 Solar 결과는 주입 모의다. 새 기능의 실제 Upstage 키·모델 호출은 실행하지 않았다.
- 수동 A/B/C 계정 검증, PC 종료·장시간 운영, 비공개 GitHub 자격, GCP 배포·백업·복구는 미실행이다.
- 공개 API·DB schema·공급자·키 보관 방식 변경 없음. push·PR·merge·운영 배포는 이 검증에 포함되지 않는다.
