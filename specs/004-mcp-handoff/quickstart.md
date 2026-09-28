# MCP 요청 연결

1. Node.js 24에서 루트 `npm ci`와 `npm run build`를 실행한다.
2. 승인된 프로젝트의 `/settings`에서 프로젝트별 MCP 연결을 발급한다. 토큰은 발급 시 한 번만 표시된다.
3. Codex의 MCP 설정에서 stdio 명령을 `node <저장소 절대경로>/apps/mcp/dist/src/index.js`로 지정한다. 해당 프로세스 환경에 `HANDOFF_API_ORIGIN`(개발: `http://127.0.0.1:3000`)과 `HANDOFF_MCP_TOKEN`을 설정한다. 토큰을 설정 파일이나 저장소에 평문으로 커밋하지 않는다.
4. Codex에서 `list_my_projects`로 프로젝트 범위를 확인한다. `send_request`는 수신자 ID, 팀 공개 제목, 당사자 전용 본문, 재시도에 재사용할 `idempotencyKey`를 요구한다. `get_my_request`는 본인이 당사자인 요청만 읽는다.
5. 연결을 끊으려면 웹 설정에서 해당 MCP 연결을 철회한다. 프로젝트에서 제외되거나 가입 승인이 취소돼도 서버가 다음 호출을 차단한다.

MCP 도구에는 사람의 인수인계 확인 완료나 계약 동의 기능이 없다. 토큰과 요청 비공개 본문을 채팅, 로그, Git에 올리지 않는다.
