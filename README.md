# HandOff

**개발팀의 인수인계와 개발 계약을 한곳에서 확인하고 합의하는 웹서비스입니다.**

디스코드 대화 속에 흩어진 인수인계와 API·데이터 구조 변경 사항을 프로젝트별로 모으고, 누가 어떤 버전을 확인했는지 추적합니다. Codex로 초안을 작성하고 사람이 검토·전송하는 흐름을 목표로 합니다.

## 주요 기능 · 개발 예정

- **프로젝트 공통 공간:** 팀원들이 전송된 인수인계 본문과 이력을 함께 확인합니다.
- **개인 받은함·보낸함:** 자신이 확인할 요청과 상대의 회신을 모아 봅니다.
- **1:1 인수인계:** 확인 또는 수정 요청을 원래 보낸 담당자에게 전달합니다.
- **개발 계약 관리:** API·데이터 구조의 확정본과 검토 중인 변경안을 구분하고, 필요하면 PM이 참여합니다.
- **Google·Discord 로그인:** 가입 승인과 프로젝트별 멤버 배정으로 접근을 관리합니다.
- **Codex·Discord 연동:** Codex 연결 가능성을 검증하고, Discord로 도착·회신 알림을 제공할 예정입니다.

## 기술 스택

| 영역 | 선택 |
|---|---|
| Frontend | React · TypeScript |
| Backend | Node.js · NestJS · Express · TypeScript |
| Database | PostgreSQL · Prisma |
| Deployment | GCP Compute Engine · Docker Compose |

## 현재 단계

제품 명세와 기술 설계를 정리하고, 개발용 Agent Harness를 구성했습니다. **웹서비스와 외부 연동은 아직 구현 전**입니다. 먼저 4~5명 내부 팀에서 검증한 뒤 공개 서비스로 확장할 계획입니다.

- [제품 명세와 기술 설계](https://github.com/SaltyPie153/HandOff/tree/feature/technical-design/docs/product)
- [Agent Harness와 개발 안내](https://github.com/SaltyPie153/HandOff/tree/feature/agent-harness)

## 브랜치 운영

`main`은 기본 브랜치이며, 기능 개발은 다음 순서로 진행합니다.

```text
feature/<기능명> → develop → 통합 테스트 → main
```

현재 main에는 프로젝트 소개만 두고, 기능 변경은 검증 후 최종 병합합니다.
