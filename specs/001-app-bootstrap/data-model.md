# Data Model: 개발 진단과 보존 확인

## BootstrapProbe — 개발 DB의 검증 전용 자료

| 필드 | 타입/제약 | 의미 |
|---|---|---|
| id | UUID, primary key | 실행별 고유 검증 ID |
| value | 문자열, 1~128자 | 임의 비민감 검증 값 |
| createdAt | UTC timestamp, 필수 | 최초 저장 시각 |

관계 없음. 회원·프로젝트·계약 테이블을 이 기능에서 생성하지 않는다.
Prisma 초기 migration으로 만든다. 계정·첨부·실제 인수인계 데이터 저장을 금지한다.
기존 id에 같은 value를 쓰면 기존 결과를 반환하고 다른 값이면 충돌로 실패한다.
verify는 지정 id와 기대 value의 일치를 확인한다. cleanup은 지정 id 한 건만 지운다.
재시작 시 생성·삭제·migration을 자동 실행하지 않는다.

상태: absent → created → verified(원본 변화 없음) → deleted.
불일치/연결 실패는 별도 검증 실패이며 저장 값을 수정하여 성공시키지 않는다.

개발 도구는 NODE_ENV=development/test, loopback host, DB 이름
handoff_dev 또는 handoff_test만 허용한다. 환경 guard는 파괴 작업에 앞서 적용한다.
시험 DB와 개발 DB는 별도 volume·포트를 사용하고 E2E가 개발 volume을 종료하지 않도록 구분한다.

## HealthSnapshot — 저장하지 않는 현재 확인 결과

- checkedAt: 서버 UTC ISO8601.
- status: ready | degraded.
- service: ok.
- database: ok | unavailable | schema_missing.
- code: OK | DATABASE_UNAVAILABLE | SCHEMA_NOT_READY.
- 값·행 개수·접속 정보·SQL 원문·stack trace는 포함하지 않는다.
- 캐시하지 않으며 매 확인마다 실제 연결과 테이블 읽기를 수행한다.

## 화면 상태 — 메모리 전용

idle → checking → ready/degraded/unavailable.
재확인 시 이전 요청은 취소하고 증가하는 requestId를 부여한다.
최신 requestId의 결과만 반영한다. 화면에 이전 결과가 남는 경우 이전 확인 결과라고 명시한다.
서버 무응답 시 service=unavailable/database=unknown으로 클라이언트가 판정한다.
이 경우 서버 checkedAt을 조작하지 않고 클라이언트 시각을 '확인 시도 시각'으로 표시한다.
실패는 로그인 상태나 프로젝트 권한을 변경하지 않는다.
