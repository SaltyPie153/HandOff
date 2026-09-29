# 계약 최초 합의 구현 검증 — 2026-09-29

## 구현 결과

- MCP 계약 제안·확정 전 재전송·개인 제안 조회·유효 계약 목록/본문 조회.
- 웹에서 A·B·필수 PM의 특정 버전 동의·비공개 수정 요청. 참조 PM은 열람만 가능.
- 마지막 필수 동의와 최초 확정·팀 공개 본문·알림의 원자적 저장.
- 버전별 참여 권한, 현재 승인·프로젝트 접근·MCP grant 검증, 사람 세션 저장 직전 재검사.
- 역할별 웹 화면·할 일·알림, 재시도 키와 작성 의견 보존, 독립된 본문 조회 감사.

## 실행 결과

Node.js24.19.0, Docker PostgreSQL17.11의 격리 시험 환경에서 실행했다. 모든 셸 명령은 `rtk proxy`를 사용했다. npm은 해당 Node24로 `C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js`를 실행했다.

| 명령 | 종료 코드 | 실제 결과 |
|---|---:|---|
| `npm ci` | 0 | 의존성 설치, audit0 |
| `npm run db:generate` | 0 | 신규 계약 Prisma 모델 생성 |
| `npm run db:migrate` | 0 | 작업 전용 빈 DB55439에0001~0009 적용 |
| `npm run build` | 0 | API·웹·MCP 전체 빌드 |
| `npm run typecheck` | 0 | 전체 타입 검사 |
| `npm test` | 0 | scripts23, API58, web54, MCP4 성공. API DB 의존30건은 이 명령에서 skip |
| `npm run test:integration` | 0 | 전용 PostgreSQL에서 신규 계약·세션 경합을 포함한 전체 통합검사 실행 |
| `npm run test:e2e` | 0 | 11개 성공. 계약 수정→새 버전→A/B 동의→PM 동의→C 공개 본문 포함 |
| `pwsh -NoProfile -File scripts/check-harness.ps1` | 0 | 문서14개·로컬 링크44개 통과. 제품 검사는 이 명령에서 NOT_RUN |
| `pwsh -NoProfile -File scripts/test-harness.ps1` | 0 | Harness fixture18개 통과 |
| `git diff --check` | 0 | 공백 오류 없음 |

최종 전체 재검증 로그는 Git 제외된 `work/contract-agreement/final-*.log`에 보관한다. 환경 파일·키·토큰은 커밋하지 않는다.

## 실패 재현과 수정

1. 정책·migration·저장소·조회·HTTP·MCP·웹 미구현 상태에서 해당 검사 실패를 확인한 뒤 구현했다. 새 버전 전송 후 이전 수정 요청 버전의 SUPERSEDED 전환과 제외 회원 응답404도 실패 재현 후 수정했다.
2. 첫 전체 E2E는10/11 성공했다. 기존 persistence 검사의 세 번째 재시작에서 `page.goto ... interrupted by another navigation`이 발생했다. Vite HMR은 서버 복구 시 자체 reload를 실행한다. 시험 탭을 재시작 전에 about:blank로 이동해 중복 탐색을 제거했고, 세 차례 DB/API/웹 재시작·probe 보존 검사를 그대로 유지했다. 최종 전체 E2E는11/11이다.
3. 독립 리뷰 Important1건: 계약 잠금 대기 중 세션 삭제·만료 후에도 동의가 저장될 수 있었다. 실제 DB lock 대기에 진입했음을 확인한 두 회귀 검사에서 실패를 재현했다. 서버 세션 식별자 전달·트랜잭션 내 세션 행 잠금·사용자/CSRF 결박/만료 검증을 추가한 뒤 두 검사와 전체 suite가 통과했다.

## 판단과 남은 한계

- 기존 실행 앱을 보존하려고 별도 관리형 worktree와 전용 DB를 사용했다. 원래9578의 문서 브랜치·미추적 outputs는 보존했다. 새 기능은 기존 수동 시험 앱에 자동 적용하지 않았다.
- 프로젝트 관례에 따라 작업 ledger를 `work/contract-agreement/resume.md`에 유지한다. work는 Git 제외되므로 공유 검증 근거는 이 문서와 커밋이다.
- persistence 검사는 HMR이 연결된 탭을 유지하는 상황을 검사하지 않는다. DB 보존·실제 재시작은 계속 검사하며 health 장애 검사가 별도로 있다.
- **Minor 후속 보강:** 기존 동의/재전송 경쟁 테스트가 두 호출 모두의 잠금 대기와 양쪽 승리 순서를 강제하지는 않는다. 결과 불변 조건과 코드 잠금은 검사했으며 알려진 제품 실패는 아니다. 새 세션 회귀 검사는 실제 lock 대기를 명시적으로 확인한다.
- 웹 번들513.81KB 경고가 있으나 빌드는 성공했다. 번들 분할은 이번 범위에서 변경하지 않았다.
- 실제 OAuth·Solar 호출, 운영 배포·백업 복구, 대규모 데이터 성능은 이번에 검증하지 않았다. 현재4~5명 팀 기능 검증을 해당 운영 검증으로 대신하지 않는다.
- 계약 확정 후 변경·철회·폐기·담당자 교체·첨부·Discord 알림·자동 판정 근거 연결은 후속 기능이다.

수동 확인은 [Quickstart](quickstart.md)를 따른다. Push·PR·merge·운영 배포는 이번 작업에서 실행하지 않았다.
