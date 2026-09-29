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
| `npm run test --workspace @handoff/web` | 새 UI4건 실패 확인 후61/61 pass |
| `npm run build` | exit0 |
| `npm run typecheck` | exit0 |
| `npm test` | exit0: scripts23, API59 pass35 DB skip, web61, MCP5 |
| `npm run test:integration` | exit0: 시험 전용 실제 DB에서 신규 lifecycle 검사 포함 |
| `npm run test:e2e` | exit0: 12/12 pass. 신규 계약 변경→수정 요청→철회→연결 변경 확정→폐기→C 공개 이력 포함 |

전체 실행 로그: Git 제외된 `work/contract-agreement/lifecycle-*.log`. API의 DB 테스트 skip은 단위 명령에서만 발생하며 통합 runner에서 별도로 실행했다. 최종 독립 리뷰는 진행 전이다.

## 한계

- Vite 번들518.27KB 경고, 일부 Prisma/pg 조회에서 pg9 API deprecation 경고가 있으나 해당 검사들은 성공했다.
- 실제 사용자 OAuth, 실제 Solar 호출, 운영 배포·백업 복구, 대규모 성능은 이번 자동 검사에 포함하지 않는다.
- 담당자 교체·관리 종료·첨부·Discord 외부 알림·계약을 자동 판정 근거로 연결하는 기능은 후속 범위다.
- 사용자 DB에0010을 적용하지 않았고, 현재 수동 앱을 새 코드로 교체하지 않았다. push·PR·merge도 실행하지 않았다.
