# HandOff

프로젝트별 개발 계약과 1:1 인수인계를 검토·확인하고 회신하는 내부 웹서비스를 준비한다.
현재 구현된 것은 **개발 Agent Harness**다. 앱, MCP, Discord 연동은 아직 없다.

## 만들고 있는 서비스

팀원이 각자 사용하는 Codex에서 인수인계 초안을 작성하고, 사람이 검토해 담당자에게 전달한다.
프로젝트 공통 공간에서 전송된 내용을 함께 확인하고, 개인 받은함에서 확인·동의·수정 요청을 처리하는 서비스다.

- 일반 인수인계는 수신 확인, API·데이터 구조 등의 개발 계약은 버전별 동의로 처리한다.
- 회신은 원래 송신자에게 연결되며, 필요하면 PM이 필수 확인 또는 참조로 참여한다.
- 현재 유효한 계약과 검토 중인 변경안을 구분한다.
- 디스코드는 도착·회신 알림 창구로 연결할 예정이다.

위 기능은 제품 계획이다. 현재 실행 가능한 범위는 아래 Harness 점검 도구다.

## 확정 기술 스택과 정책

| 영역 | 선택 |
|---|---|
| 프론트엔드 | React + TypeScript |
| 백엔드 | Node.js + NestJS + TypeScript, Express 어댑터 |
| DB·ORM | PostgreSQL 직접 운영 + Prisma |
| 인증 | Google·Discord 로그인, 가입 후 관리자 승인, 명시적 계정 연결 |
| 권한 | 프로젝트별 배정. 승인 회원은 생성 가능, 생성자가 프로젝트 관리 담당자 |
| 배포 | GCP 서울 asia-northeast3, VM 한 대, Docker Compose |
| 개발 환경 | DB만 Docker, React·NestJS는 로컬 실행 |
| 저장·백업 | VM 영구 디스크에 DB·첨부, 하루 1회 Cloud Storage 백업·7일 보관 |

프로젝트 관리 담당자는 승인 회원을 자기 프로젝트에 추가·제외할 수 있다. 서비스 가입 승인·관리자 권한 부여와는 별도다.
최초 서비스 관리자는 사용자 계정을 배포 시 명시 지정한다. 이메일이 같아도 Google·Discord 계정을 자동 합치지 않는다.

비용 최소화와 신규 무료 크레딧 활용을 기준으로 하며 실제 적용 여부·만료는 배포 전에 확인한다.
이 표는 선택한 설계이며 앱·Docker 설정·GCP 리소스가 이미 만들어졌다는 뜻은 아니다. 남은 결정과 구현 순서는 [기술 설계](docs/product/technical-design.md)를 참고한다.

## 브랜치 운영

```text
feature/<기능명> → develop → 통합 테스트 → main
```

- 새 기능은 `develop`을 기준으로 `feature/<기능명>` 브랜치에서 개발한다.
- 기능별 검증과 리뷰 후 `develop`에 병합한다. PR의 기본 대상은 `develop`이다.
- `develop`에 통합된 결과를 테스트하고, 최종 반영 시에만 `main`에 병합한다.
- `main`에 직접 push하거나 기능 브랜치를 바로 병합하지 않는다. 강제 push를 기본 작업 절차에 포함하지 않는다.
- 저장소 기본 브랜치는 `main`이다. `develop`은 `main`의 기준 커밋에서 출발하고, 기능 브랜치는 `develop`에서 분기한다.
- 최초 구성에서는 `main`과 `develop`이 같은 빈 기준 커밋을 가리키며 실제 Harness 변경은 `feature/agent-harness`에 있다. `main`에는 통합 테스트를 거친 결과만 최종 병합한다.
- 이 규칙은 팀 운영 지침이다. GitHub 브랜치 보호 설정과 자동 CI는 아직 구성하지 않았다.

## 시작

현재 Harness 실행에는 Git과 PowerShell 7이 필요하다. Harness의 추가 패키지 설치는 없다. 제품용 Node.js·Docker 버전과 실행 명령은 앱 구성 단계에서 별도로 등록한다.

최초 Harness가 `develop`에 병합되기 전에는 다음과 같이 기능 브랜치를 받는다.

```powershell
git clone --branch feature/agent-harness https://github.com/SaltyPie153/HandOff.git
cd HandOff
```

병합 후에는 `develop`을 기준으로 새 기능 브랜치를 만든다.

```powershell
git switch develop
git pull --ff-only origin develop
git switch -c feature/my-feature
```

```powershell
pwsh -NoProfile -File scripts/check-harness.ps1
pwsh -NoProfile -File scripts/test-harness.ps1
```

첫 명령은 지침·문서 연결·설정 검사, 두 번째는 격리된 테스트 자료에서 정상/실패 사례를 검증한다.
제품 테스트는 미설정이다. `check-harness.ps1 -RequireProduct`는 종료 코드 2를 반환한다.
스크립트는 사용자 입력 명령이나 외부 연동을 실행하지 않는다.

## 문서

- [에이전트 시작 지침](AGENTS.md)
- [제품 원본 명세](docs/product/spec.md)
- [기술 설계 및 운영 결정](docs/product/technical-design.md)
- [Harness 설계](docs/harness/design.md)
- [작업 절차](docs/harness/workflow.md)
- [검증 기준](docs/harness/checks.md)
- [작업 양식](docs/harness/task-template.md)
- [결정 기록](docs/harness/decisions.md)

새 작업에서는 이 저장소를 작업 디렉터리로 연다. Codex 지침 자동 로드는 새 작업에서 실제 읽힌 지침을 확인해야 한다.
AGENTS.md는 지침이며 권한 격리나 CI를 대신하지 않는다.

임시 메모와 테스트 자료는 `work/`에 남으며 Git으로 공유되지 않는다. 필요한 내용을 별도로 공유하고 더 이상 필요 없는 자료는 경로를 확인한 뒤 정리한다.
