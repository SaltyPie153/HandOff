# 개발 계약 최초 합의 확인

범위: MCP 제안 → 사람의 수정 요청 → 새 버전 → A·B·필수 PM 동의 → 팀 공개 확정 본문.
확정 후 변경·철회·폐기·담당자 교체, 첨부, Discord 알림, 자동 회신기의 계약 근거 연결은 후속 범위다.

## 준비

Node.js 24 (`>=24.15 <25`), Docker, 별도 시험 PostgreSQL을 사용한다. 기존 로컬 DB를 초기화하지 않는다.

```powershell
npm ci
npm run dev:init
npm run db:up
npm run db:generate
npm run db:migrate
npm run dev:api
# 다른 터미널
npm run dev:web
```

포트는 로컬 `.env`의 API_PORT·WEB_PORT·DB_PORT를 따른다. migration0009는 새 계약 테이블만 추가하고 기존 인수인계 확인을 계약 동의로 바꾸지 않는다. `.env`와 MCP 토큰을 공유하거나 커밋하지 않는다.

같은 프로젝트에 승인된 A(송신), B(수신), PM(필수), C(비참여)를 배정한다. 필요하면 별도 참조 PM을 추가한다. `/settings`에서 A의 프로젝트별 MCP 연결을 발급한다. 기존 [MCP 연결 안내](../004-mcp-handoff/quickstart.md)에 따라 새 `apps/mcp/dist/src/index.js`를 사용하고 실행 중인 API 주소를 지정한다.

## MCP 도구

- `propose_contract`: `projectId`, `recipientId`, `publicTitle`, `proposedBody`, `requiredPmIds`, `referencePmIds`, `idempotencyKey`.
- `revise_contract_proposal`: `proposalId`, `expectedVersion`, `proposedBody`, `requiredPmIds`, `referencePmIds`, `idempotencyKey`.
- `get_my_contract_proposal`: `proposalId`, 선택 `version`. 자신이 참여했던 버전만 조회한다.
- `list_active_contracts`: 현재 연결된 프로젝트의 확정 계약만 반환한다.
- `get_contract`: `contractId`. 확정 본문만 반환한다.

PM 배열은 빈 배열도 가능하며 각각 최대10명이다. A·B·필수·참조 역할은 겹칠 수 없다. 제목160자, 본문50,000자, 수정 의견10,000자, 키128자 이내다. 키는 최초 실행에 새 UUID를 만들고 네트워크 재시도에서는 같은 키와 같은 내용을 사용한다. 새로운 버전이나 다른 명령에는 새 키를 사용한다.

## 네 계정으로 확인

1. A의 MCP로 B를 수신자, PM을 필수 참여자로 제안한다. 반환되는 **contractId와 proposalId는 서로 다른 ID**다. 제안 전송만으로 동의가 생기지 않는다.
2. 각 창에서 프로젝트 룸 → **개발 계약·합의**로 이동한다. C는 미확정 제목만 보며 비공개 제안 직접 URL은 차단된다.
3. B의 **내 계약 검토·알림**에서 본문을 읽고 비공개 수정 의견을 작성해 **수정 요청**한다. A에게 수정 필요1이 표시되고 해당 버전의 추가 응답은 닫힌다.
4. A의 MCP로 현재 제안을 조회한 뒤 `revise_contract_proposal`을 실행한다. 같은 proposalId 아래 새 불변 버전이 생기며 이전 응답은 승계되지 않는다.
5. A와 B가 웹에서 각각 **이 버전에 동의**한다. 둘의 할 일은0이 되지만 PM이 응답하기 전에는 계약이 미확정이다. A도 별도의 사람 동의가 필요하다.
6. PM이 같은 버전에 동의한다. 참조자의 미응답은 조건이 아니다. 계약이 확정되며 C도 **확정 본문 보기**에서 동의한 텍스트 그대로 읽는다. 비공개 수정 의견·개인 동의 이력은 공개하지 않는다.
7. 새로고침 후 확정 상태·알림이 유지되는지 확인한다. 알림 읽음과 MCP 본문 조회는 동의가 아니다. 본문 조회는 회원·grant·버전·시각만 별도 감사 기록한다.
8. 과거 버전 응답과 확정 후 재전송은409다. 새 PM에게 과거 비공개 버전을 공개하지 않는다. 필수 참여자가 프로젝트 권한을 잃으면 응답·재전송·할 일을 차단하며 참조자 이탈은 검토를 막지 않는다.

전원 동의 시 본문 전체가 팀에 공개된다는 안내를 읽고 동의한다. 통신 오류·409 이후 작성 의견은 유지되며 최신 버전을 불러와도 자동 제출하지 않는다.

## 자동 검증

```powershell
npm run build
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
pwsh -NoProfile -File scripts/check-harness.ps1
pwsh -NoProfile -File scripts/test-harness.ps1
```

통합·E2E runner는 전용 DB와 포트를 사용하고 종료 시 시험 환경을 정리한다. 포트 충돌 시 실행 중인 사용자 환경을 종료하지 말고 원인을 확인한다. 일반 `npm test`에서 DB 의존 검사는 건너뛰며 `test:integration`이 실제 PostgreSQL 검증이다. 실제 OAuth·Solar 호출·운영 배포의 검증은 포함하지 않는다.
