# 확정 계약을 자동 회신 근거로 사용하기

## 준비

- Node.js24, Docker Desktop과 승인된 A/B/C 프로젝트 멤버가 필요하다. [기본 실행](../001-app-bootstrap/quickstart.md), [계약 합의](../006-contract-agreement/quickstart.md), [변경·폐기](../007-contract-lifecycle/quickstart.md)를 따른다.
- 관리자 `/settings`에서 Upstage API 키를 설정하고 A의 프로젝트 MCP 연결을 발급한다. 키·토큰은 채팅, 문서, Git에 저장하지 않는다.
- 기존 프로젝트의 현재 확정 계약을 자동 탐색하므로 별도 근거 등록이나 migration 추가가 없다.

## 합의 → 사실 회신

1. A가 MCP `propose_contract`로 B에게 다음 본문을 제안한다. 필수 PM을 지정했다면 그 PM도 같은 버전에 동의해야 한다.

   ```text
   회원 식별자의 전달 규칙
   USER_ID_FORMAT: uuid-v4
   ```

2. A·B·필수 PM이 웹에서 해당 버전에 각각 동의한다. 확정 본문은 현재 프로젝트 팀 전체에 공개된다.
3. A가 `send_request`로 B에게 새 요청을 보낸다. `verificationClaim`에는 정확히 `USER_ID_FORMAT: uuid-v4`를 입력하고 새 UUID의 `idempotencyKey`를 사용한다. 요청 본문은 A·B 전용이다.
4. 서버가 현재 유효한 같은 키의 계약과 B의 등록 파일을 검사한 뒤 Solar로 다시 확인한다. 정상 확인하면 팀 피드에 짧은 사실 회신 하나가 표시된다. 배경 처리 주기는 약10초이며 외부 호출 시간이 더해진다.
5. 자동 회신에는 계약 원문·확인 키 값·파일 경로가 복사되지 않는다. B의 ‘내용 확인 완료’는 별도 사람 동작이다.

## 변경과 실패 확인

- 변경 제안을 검토하거나 철회하는 동안 기존 확정본을 사용한다. 전원 동의로 새 버전이 확정되면 새 근거를 사용한다.
- 동일 키에 다른 값이 있거나 잘못된 형식의 줄이 있으면 B의 비공개 검토로 넘긴다. 자연어만 적힌 문장을 자동 구조화하지 않는다.
- 등록 파일은 기존 규칙을 유지한다. 파일에 키가 없거나 로컬 동기화가24시간을 넘기거나 dirty 상태이면 일치 계약이 있어도 자동 게시하지 않는다. 계약의 확정 나이에는24시간 제한이 없다.
- 폐기가 확정되면 현행 근거에서 제외한다. 이후 동일 claim의 새 요청은 다른 유효 근거가 없으면 ‘최신 근거가 부족합니다’로 끝난다.
- 최초·변경·폐기 확정 시 근거 문제로 대기하는 최신 요청과 실행 중 요청만 다시 확인한다. 이전 실행은 무효화되며 사람 처리·이미 게시된 회신·모델/키/권한 실패는 계약 이벤트만으로 재실행하지 않는다.
- 확인 중 계약 추가·변경·폐기가 발생하면 최신 집합을 다시 검사한다. 게시가 먼저 커밋된 경우 회신은 그 시점의 기록으로 남는다.

## 자동 검사

저장소 루트에서 실행한다. 통합/E2E는 별도 시험 DB를 생성·정리한다. 기존 개발·수동 시험 DB를 초기화하지 않는다.

```powershell
rtk proxy npm run build
rtk proxy npm run typecheck
rtk proxy npm test
rtk proxy npm run test:integration
rtk proxy npm run test:e2e
rtk proxy pwsh -NoProfile -File scripts/check-harness.ps1
rtk proxy pwsh -NoProfile -File scripts/test-harness.ps1
```

통합/E2E의 모델 확인은 fake runner다. 실제 Solar 호출, 사용자 계정·PC 종료 상태, 비공개 GitHub 및 운영 배포는 별도 실연동 시험이다. [검증 기록](validation.md)에서 실제 실행 결과와 한계를 확인한다.
