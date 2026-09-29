# 계약 변경·철회·폐기 검증 — 2026-09-30

## 구현 범위

- 원래 A의 MCP 변경·폐기 제안, 최초 제안 철회 후 같은 계약의 연결 제안.
- A의 웹 세션·CSRF로 사유 포함 철회, 사람 전원 동의에 의한 현행 본문 교체·폐기.
- 한 계약의 OPEN 제안 제한, 기준 확정본·권한·세션 재검사, 재시도 중복 방지.
- 공개 확정 이력과 비공개 검토 이력 분리, 폐기 후 현재 body/version=null, 과거 본문 보존.
- 웹 철회 사유·키 보존과409 재확인, 폐기 동의·기준 확정본·과거 이력 표시.

## 실행 근거

Node.js24.19.0, Docker PostgreSQL의 격리 시험 환경. 원래 수동 앱·DB와 사용자 변경은 보존했다. 모든 셸 명령은 `rtk proxy`, npm은 Node24 helper로 실행했다.

| 명령 | 결과 |
|---|---|
| `npm run db:generate` | exit0 |
| `npm run db:migrate` | exit0, 전용 시험 DB55439에0010 적용 |
| lifecycle policy/migration DB 검사 | 미구현 실패 확인 후2/2 pass, skip0 |
| lifecycle/agreement/session DB 검사 | 7/7 pass, skip0 |
| lifecycle/access DB 검사 | 2/2 pass, skip0 |
| contract HTTP DB 검사 | 새 route404 실패 확인 후1/1 pass |
| `npm run test --workspace @handoff/mcp` | 새 tool 미노출 실패 확인 후5/5 pass |
| `npm run test --workspace @handoff/web` | 새 UI4건 실패 확인 후61/61 pass. 최종 리뷰 회귀3건 추가 후64/64 pass |
| `npm run build` | exit0 |
| `npm run typecheck` | exit0 |
| `npm test` | exit0: scripts23, API59 pass35 DB skip, web64, MCP5 |
| `npm run test:integration` | exit0: 시험 전용 실제 DB에서 신규 lifecycle 검사 포함 |
| `npm run test:e2e` | exit0: 12/12 pass. 신규 계약 변경→수정 요청→철회→연결 변경 확정→폐기→C 공개 이력 포함 |

전체 실행 로그: Git 제외된 `work/contract-agreement/lifecycle-*.log`. API의 DB 테스트 skip은 단위 명령에서만 발생하며 통합 runner에서 별도로 실행했다.

## 독립 리뷰와 수정

- 리뷰는 상태 전환·권한·이전의 Critical/Important 결함을 보고하지 않았고, 화면 누락2건을 Minor로 보고했다. 승인된 검토 흐름의 누락으로 판단해 두 건 모두 보완했다.
- 계약 상세에 OPEN 제안의 존재 표시가 없었다. DB/API 회귀와 웹2개에서 실패를 확인한 뒤 공개 상태 표시와 최신 버전 참여자만의 링크를 추가했다. 비참여자의 openProposalId는 null이다.
- 받은함에서 같은 계약의 신규·변경·폐기 버전1이 모두 같은 이름으로 보였다. 웹 회귀 실패 후 제안 종류·전송 시각·제안 ID를 표시했다.
- 보완 후 전체 build·typecheck·test·integration은 exit0이며, 아래 시험 순서 보완 후 최종 E2E도12/12, exit0이다. 남겨둔 리뷰 지적은 없다.
- 리뷰 수정 후 전체 재검증에서 build·typecheck·test·integration은 성공했지만 기존 `handoff.spec.ts`의 MCP 철회 직후 요청 검사에서 `Expected:401, Received:403`으로 E2E11/12가 됐다. 클릭은 비동기 철회 완료를 보장하지 않으며, 요청 입구의 토큰 검사 후 철회가 저장되면 저장 직전 grant 검사가403으로 차단한다. 실제 DELETE 성공 응답을 기다린 뒤 기존401 검사를 수행하도록 시험 순서를 수정했다. 거부 기준을 완화하거나 제품 권한 코드를 변경하지 않았다.

## 구현 판단 기록

- Windows와 프로젝트 관례에 맞춰 기존 work ledger·Node24 helper를 재사용했다. 별도 skill bash ledger를 만들지 않아 자동 task 집계 대신 직접 명령·커밋 근거를 기록했다.
- 공개 본문 조회는 계약 SHARE 잠금을 먼저 잡는다. 변경·폐기와 조회 사이의 상태 혼합을 막는 대신 해당 계약 쓰기가 조회 완료까지 잠깐 대기할 수 있다.
- 외래키 일부는 Prisma navigation 대신 SQL 제약으로 유지한다. 향후 Prisma diff 작성 시 수동 제약을 보존해야 한다.
- 리뷰어는 suite를 다시 실행하지 않았으며 실제 검증은 구현 세션에서 실행했다. 리뷰 이후 문서의 오래된 검증 범위 문구는 작성자가 정정하고 Harness로 링크를 확인했다.
- MCP 철회 E2E는 완료 응답을 기다린 뒤 차단을 확인한다. 철회와 동시 전송 경합은 해당 E2E 범위에서 제외되며 저장 직전 grant 검사 등은 별도 API 검사가 맡는다.
- 실제 외부 인증·모델·운영 환경은 미검증으로 남긴다. 담당자 교체·관리 종료·자동 근거 연결은 승인 범위 밖이며, 참여자가 권한을 잃은 경우의 관리 복구 기능은 후속 작업이다.

## 한계

- 최종 Vite 번들518.80KB 경고, 일부 Prisma/pg 조회에서 pg9 API deprecation 경고가 있으나 해당 검사들은 성공했다.
- 실제 사용자 OAuth, 실제 Solar 호출, 운영 배포·백업 복구, 대규모 성능은 이번 자동 검사에 포함하지 않는다.
- 담당자 교체·관리 종료·첨부·Discord 외부 알림·계약을 자동 판정 근거로 연결하는 기능은 후속 범위다.
- 원본 사용자 DB와 기존 수동 앱은 보존했다. 아래 별도 복사본에만 0009·0010을 적용해 수동 확인했다. 운영 배포와 병합은 별도다.

## 실제 계정 수동 확인 — 2026-09-30

기존 수동 시험 DB를 별도 로컬 DB로 복제하고 웹 5580·API 3310에서 실행했다. 복제·마이그레이션은 exit0, `/dev/health` HTTP200, `/api/health/ready`는 service/database 모두 ok였다. 원본 DB·기존 앱·시험용 단위 DB는 유지했다. 공급자 키는 복사하지 않았다.

아래 UI 항목은 사용자가 A·B·C 계정 창에서 직접 수행하고 정상이라고 보고한 결과다. MCP 조회 결과도 사용자가 별도 Codex 대화에서 실행해 전달했으며, 이 세션의 직접 도구 실행으로 오인하지 않는다.

| 확인 항목 | 결과 |
|---|---|
| 새 MCP 연결·프로젝트 조회·계약 제안 도구 노출 | 정상 |
| 검토 중 A·B 본문 표시, 비참여 C 직접 주소 차단 | 정상 |
| 최초 A만 동의 시 미확정, B 동의 후 확정·C 본문 공개 | 정상 |
| B 수정 요청 → A 사유 포함 철회 | 정상 |
| 철회 후 C 기존 유효 본문 유지, 수정 의견·철회 사유 비공개 | 정상 |
| 연결된 새 변경 제안에서 A만 동의 시 기존 유지 | 정상 |
| B 동의 후 UUID v4 본문으로 교체, 이전 확정본 이력 유지 | 정상 |
| 폐기 제안에 A만 동의 시 유효 유지, B 동의 후 폐기 | 정상 |
| C에게 폐기 사유·과거 확정 이력 표시 | 정상 |
| MCP 활성 계약 목록에서 제외 | 정상, 시험 목록 `[]` |
| MCP 폐기 조회 | `status=RETIRED`, `body=null`, `version=null`, `lastConfirmed` 보존 |

필수 PM 참여·권한 상실·동시 요청은 이번 수동 시나리오에 포함하지 않았다. 관련 자동 검사와 실제 사람의 수동 확인 범위를 구분한다. 새 OAuth 인증·Solar 호출·운영 환경은 이 결과로 검증되지 않는다.
