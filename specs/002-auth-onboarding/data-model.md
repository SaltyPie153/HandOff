# 인증 데이터 모델

## User

- id: 불변 내부 UUID, 기본 키.
- status: PENDING 또는 APPROVED. 신규 회원은 PENDING.
- isServiceAdmin: 기본 false. 최초 관리자는 명시적 운영 명령, 이후 기존 관리자의 권한 부여로만 true.
- createdAt, approvedAt: UTC 시각. 승인 전 approvedAt 없음.
- 승인 상태·관리자 권한은 보호 요청마다 저장소에서 다시 읽는다.

## ProviderIdentity

- id: 내부 UUID.
- userId: User 참조.
- provider: GOOGLE 또는 DISCORD.
- providerSubject: 제공자가 검증한 불변 계정 식별자.
- displayName, email: 승인 대기 화면에 필요한 선택 정보. 권한·병합 키로 사용하지 않음.
- linkedAt: UTC 시각.
- 제약: (provider, providerSubject) 유일. 한 사용자에게 같은 제공자 계정 연결은 한 번만.
- 삭제·해제는 이번 기능에 포함하지 않음.

## AuthSession

- id 또는 안전한 토큰 해시: 세션 식별자. 원문 세션 비밀값을 로그에 남기지 않음.
- userId: User 참조.
- createdAt, expiresAt: UTC 시각.
- 로그아웃 시 삭제 또는 무효화, 로그인 시 새로운 식별자로 교체.
- 세션에 저장된 역할은 접근 결정의 원본이 아님.

## OAuthAttempt

- 일회용 시도 식별값·state 해시, 제공자, 목적 LOGIN/LINK, 시작 세션·회원 ID(연결일 때), 만료 시각.
- Google nonce·코드 검증 값은 필요한 경우 시도에 연결한다.
- 성공·실패·취소 시 소모하며 만료·재사용된 콜백을 거부한다.

## MembershipApproval 및 AdminGrant

- 각 기록은 대상 회원 ID, 처리 관리자 ID, 처리 시각을 보존한다.
- 승인 또는 관리자 부여의 상태 변경과 감사 기록은 원자적으로 저장한다.
- 승인 중복 요청은 추가 기록 없이 이미 처리됨을 반환한다.
- 최초 관리자 지정은 별도 초기 설정 기록으로 구분하며 첫 로그인 순서에 의존하지 않는다.

## 상태 전이와 권한

- 가입: 없음 → PENDING → APPROVED. 거절·비활성화·재가입은 후속 명세.
- 제공자 연결: 미연결 → 해당 회원에 연결. 타인 연결 상태에서는 변경 없음.
- 대기 회원: 자신의 상태·로그아웃·명시적 제공자 연결만. 업무 API는 모두 거부.
- 승인 회원: 프로젝트 생성 자격. 기존 프로젝트 자료는 별도 배정 필요.
- 서비스 관리자: 승인·관리자 권한 부여. 콘텐츠 접근은 프로젝트 배정이 있을 때만.
