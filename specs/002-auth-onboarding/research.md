# 인증 기능 기술 조사

## 결정 1: 사용자 식별

- Decision: 내부 회원 ID를 기준으로 권한과 받은함을 묶고, Google의 검증된 sub 및 Discord의 검증된 사용자 id를 각각 제공자 계정 키로 저장한다.
- Rationale: 이메일·표시 이름은 고유하거나 영구적이라고 가정할 수 없다. 다른 제공자의 계정은 로그인 상태에서 명시적 재인증 후에만 연결한다.
- Alternatives considered: 이메일 자동 병합은 제품 불변 조건에 위배된다. 제공자별 별도 회원은 한 사람의 받은함을 나눈다.
- Sources: https://developers.google.com/identity/openid-connect/openid-connect ; https://docs.discord.com/developers/resources/user

## 결정 2: 외부 로그인

- Decision: Google은 백엔드 authorization-code OIDC 흐름에서 state와 nonce를 검증하고 ID 토큰의 서명·발급자·대상·만료·sub를 확인한다. Discord는 백엔드 authorization-code 흐름에서 state를 검증하고 최소 identify scope로 사용자 id를 조회한다. 연결 목적과 시작 회원을 일회용 시도 정보에 묶는다.
- Rationale: 브라우저가 제공한 이메일·ID를 신뢰하지 않고, 로그인과 연결 콜백의 문맥 혼동을 막는다.
- Alternatives considered: 암묵적 흐름과 브라우저 토큰 보관은 불필요하다. Discord 일반 OAuth 문서에서 PKCE 지원은 확인되지 않아 지원을 전제로 하지 않는다. Google은 지원 여부를 구현 시 검증하고 사용할 수 있다.
- Sources: https://developers.google.com/identity/openid-connect/openid-connect ; https://developers.google.com/identity/openid-connect/reference ; https://docs.discord.com/developers/topics/oauth2

## 결정 3: 세션과 접근 검사

- Decision: 백엔드에서 유효성을 확인할 수 있는 세션 식별자를 HttpOnly·Secure·SameSite=Lax 쿠키로 전달하고 운영 세션은 PostgreSQL에 영속화한다. 로그인 시 세션 식별자를 재발급하고 로그아웃 시 무효화한다. 보호 요청은 매번 저장된 현재 가입 상태와 프로젝트 배정을 검사한다. 상태 변경 요청에는 같은 출처 검증과 CSRF 방어를 둔다.
- Rationale: 승인 직전의 오래된 화면·세션이 새 요청의 접근 권한을 결정하지 않게 한다. 메모리 세션은 VM·컨테이너 재시작 후 유지되지 않는다.
- Alternatives considered: 모든 역할을 쿠키에 장기 캐시하는 방식은 승인·권한 변경의 즉시 반영에 불리하다. 외부 관리형 세션 서비스는 내부 소규모 팀의 운영 비용을 늘린다.
- Sources: https://docs.nestjs.com/techniques/session ; https://expressjs.com/en/resources/middleware/session/ ; https://docs.nestjs.com/security/csrf

## 결정 4: 동시성·감사

- Decision: 제공자와 제공자 사용자 ID의 복합 유일 제약으로 중복 회원을 방지한다. 최초 가입 충돌은 기존 연결을 다시 읽는다. 승인·관리자 권한 부여는 조건부 상태 변경과 감사 기록을 하나의 트랜잭션에서 저장한다.
- Rationale: 중복 콜백·동시 로그인·승인 재시도에서 결과가 한 번만 적용되어야 한다.
- Alternatives considered: 애플리케이션의 사전 조회만으로는 경합을 막을 수 없다.
- Sources: https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/indexes ; https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions

## 통합 전제

- 앱 골격의 Prisma 설정·Nest 앱·React 앱·실행 스크립트가 완성되기 전에는 독립 정책 코드와 계약 테스트까지만 실행한다.
- 실제 Google/Discord 애플리케이션 자격 증명과 redirect URI는 운영·시험 환경별로 별도 준비한다. 비밀값은 Git에 넣지 않는다.
- 운영 최초 관리자 계정 ID는 첫 로그인으로 대기 회원이 생성된 뒤 명시적 명령에서 지정한다. 지정되지 않은 상태에서는 관리자 기능을 열지 않는다.
