# 인증 API와 화면 계약

기본 경로는 /api이며 모든 응답은 비밀값과 외부 제공자 토큰을 제외한다. 경로 이름은 앱 골격의 기존 라우팅과 충돌하면 의미를 유지한 채 계획에서 조정한다.

| 동작 | 경로 | 정상 결과 | 실패·권한 |
|---|---|---|---|
| 현재 회원 | GET /api/auth/me | 비로그인: 401; 로그인: id, status, isServiceAdmin, linkedProviders | 세션 만료: 401 |
| 로그인 시작 | GET /api/auth/google/start, /api/auth/discord/start | 일회용 시도 생성 후 제공자 승인 화면으로 이동 | 잘못된 제공자: 404 |
| 로그인 콜백 | GET /api/auth/google/callback, /api/auth/discord/callback | 검증·세션 재발급 후 pending 또는 프로젝트 선택으로 이동 | state/nonce/토큰 검증 실패: 로그인 실패 화면, 계정 변경 없음 |
| 연결 시작 | POST /api/auth/links/google/start, /api/auth/links/discord/start | 로그인한 회원에 묶인 일회용 시도 생성 및 이동 주소 제공 | 비로그인: 401; CSRF 실패: 403 |
| 제공자 연결 확인 | GET /api/auth/links/google/callback, /api/auth/links/discord/callback | 같은 내부 회원에 연결 후 설정 화면 이동 | 타인 연결 충돌: 409; 시작 세션 불일치: 403 |
| 로그아웃 | POST /api/auth/logout | 세션 무효화, 204 | CSRF 실패: 403 |
| 대기 목록 | GET /api/admin/pending-users | id, 표시 이름, 제공자, 요청 시각 | 관리자 아닌 회원: 403 |
| 가입 승인 | POST /api/admin/users/:id/approve | 대상·처리자·시각, 중복 재시도는 기존 결과 | 관리자 아닌 회원: 403; 대상 없음: 404 |
| 관리자 권한 부여 | POST /api/admin/users/:id/grant-admin | 대상·처리자·시각, 중복 재시도는 기존 결과 | 관리자 아닌 회원: 403; 미승인 대상: 409 |

화면: /login은 제공자 선택과 실패 안내, /pending은 대기 상태와 로그아웃·연결 진입점, /admin/pending은 승인 목록, /projects는 승인 후 이동 자리이며 실제 프로젝트 목록은 후속 기능이다.

서버는 모든 보호 API에서 비로그인·대기·승인·관리자·프로젝트 배정을 각각 검사한다. 반환 상태가 401/403/409여도 다른 회원의 보호된 정보를 응답에 싣지 않는다.
