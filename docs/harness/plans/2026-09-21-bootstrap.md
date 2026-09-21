# HandOff Agent Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution, or superpowers:subagent-driven-development if the user selects delegated execution. Follow the checkboxes below in order.

**Goal:** HandOff 저장소에 프로젝트 전용 에이전트 지침과 실제로 실행 가능한 Harness 점검 도구를 구축한다.

**Architecture:** AGENTS.md는 짧은 진입점이며 제품 원본 명세와 필요한 작업 문서를 연결한다. PowerShell 검사기는 프로젝트 루트와 필수 문서를 확인하고, 제품 테스트 미설정을 Harness 성공과 구분한다. 임시 재개 기록은 Git에서 제외한다.

**Tech Stack:** Markdown, JSON, PowerShell 7, Git. 애플리케이션 기술 스택은 선택하지 않는다. 추가 패키지 설치는 필요하지 않다.

**Spec:** [Harness 설계안](../design.md), [제품 명세 v1.1](../../product/spec.md).

**Execution root:** 저장소 루트 (`AGENTS.md`가 있는 폴더). 로컬 저장소는 2026-09-21에 `C:/Users/SaltyPie/Desktop/HandOff`로 이전했다.

**구현 전 상태 기록:** 원격 `https://github.com/SaltyPie153/HandOff.git`의 빈 로컬 clone. main에는 아직 커밋이 없다. PowerShell 7과 Git이 설치돼 있다. 실행 계획 검토 전이며 Harness 구현은 시작하지 않았다.

## Global Constraints

- 제품 코드·MCP 서버·Discord 연동·배포는 범위에서 제외한다.
- 모델·전역 Codex 설정·설치 플러그인은 변경하지 않는다.
- 제품 검증을 ‘미설정’으로 표시하고, 실제 실행 없이 성공을 주장하지 않는다.
- 초안 비공개, 버전별 동의, 현재 유효 계약 유지, 사람 동의와 에이전트 조회 구분을 지침에 포함한다.
- 일회성 작업 기록은 `work/<task-id>/resume.md`에 갱신한다. Git으로 동료 PC에 전달되지 않는다는 한계를 명시한다.
- git push, 원격 설정 변경, 애플리케이션 스택 설치를 실행하지 않는다.
- 기존 설계 작성 이후 저장소가 생겼으므로 원본 명세의 기준 경로를 저장소 내부로 이전한다. 상위 outputs 문서는 이전본 안내만 남겨 독립된 명세 두 개를 관리하지 않는다.

## Review Focus

1. 다른 cwd와 공백이 있는 경로에서도 점검이 동일하게 동작해야 한다 — Task 2의 다른 작업 폴더 시나리오.
2. 링크 텍스트만 맞고 대상 파일이 없는 문서를 통과시키지 않아야 한다 — Task 2의 깨진 링크 시나리오.
3. 제품 테스트가 없는데 Harness 성공을 제품 성공으로 오해하지 않아야 한다 — Task 2의 기본 모드와 RequireProduct 비교.
4. 변경 중인 사용자 파일과 로컬 기록을 삭제하거나 덮어쓰지 않아야 한다 — Task 1 사전 파일 확인 및 Task 2 별도 fixture 사용.
5. 링크와 지침이 서로 다른 제품 명세를 원본으로 가리키지 않아야 한다 — Task 1 명세 이전과 Task 2 필수 경로 검사.

## Task 1: 프로젝트 지침과 원본 문서 구성

**Files:**

- Create: `AGENTS.md`, `README.md`, `.gitignore`.
- Create: `docs/product/spec.md`, `docs/harness/design.md`.
- Create: `docs/harness/workflow.md`, `docs/harness/checks.md`, `docs/harness/task-template.md`, `docs/harness/decisions.md`.
- Create: `docs/harness/manifest.json`, `docs/harness/plans/2026-09-21-bootstrap.md`.
- Modify: 상위 `outputs/product-spec-v1.md`, `outputs/agent-harness-design.md` — 이전 안내와 저장소 원본 링크.

**Interfaces:** 제품 원본은 `docs/product/spec.md` 하나다. AGENTS.md에서 문서를 상대 Markdown 링크로 참조한다. manifest는 검사기의 파일 목록과 원본 경로를 정의한다.

- [x] **Step 1: 변경 전 확인**

```powershell
git status --short --branch
git remote -v
Get-ChildItem -Force
```

새 사용자 파일이 있으면 읽고 보존한다. 빈 저장소라 초기 worktree 분리가 불가능한 점을 기록한다. 커밋 없는 저장소에 가짜 기준 SHA를 만들지 않는다.

- [x] **Step 2: 승인된 문서 이전**

현재 제품 명세 전체를 `docs/product/spec.md`에 이전한다. Harness 설계를 `docs/harness/design.md`에 넣고 ‘저장소 없음’ 문구를 현재 상태로 갱신한다. 본 계획도 계획 디렉터리에 넣고 상대 링크를 조정한다. 원본 내용의 누락 여부를 비교한 후 상위 outputs에는 이전 안내를 남긴다.

- [x] **Step 3: AGENTS.md 작성**

다음 순서와 내용을 포함해 100줄 이내로 작성한다.

1. 프로젝트 목적: 4~5명 내부 팀용 개발 계약·인수인계 웹서비스.
2. 시작: `docs/product/spec.md`, `docs/harness/decisions.md`, 관련 코드와 `git status` 확인.
3. 해당 작업에만 `workflow.md`, `checks.md`, `task-template.md`를 읽도록 연결.
4. 핵심 불변 조건: 프로젝트 접근 권한, 초안 비공개, 전송 버전 불변, 동일 버전 동의, 폐기 계약 제외, 사람이 최종 전송·승인, Codex 조회와 승인 분리.
5. 실행: `pwsh -NoProfile -File scripts/check-harness.ps1`, 필요 시 `-RequireProduct`.
6. 명령 실행 여부·종료 코드·미검증 사항을 구분해 보고. 없는 테스트를 통과로 기록하지 않음.
7. 로컬 재개 메모는 `work/<task-id>/resume.md`. 서비스가 아직 없으므로 팀 간 자동 인계가 구현됐다고 쓰지 않음.
8. 사용자 변경 보존. 전역 설정·외부 통신·제품 승인 행위는 이 파일만으로 권한이 생기지 않음.

- [x] **Step 4: 작업 문서 작성**

`workflow.md`: 요구사항 확인 → 수용 조건과 변경 범위 정리 → 관련 변경 구현 → 실제 검증 → 리뷰 및 수정 → 결과 보고. 새 세션에서는 재개 메모의 상태를 git·실제 파일·검증 결과와 대조한다.

`checks.md`: 제품 명세 14장의 19개 기준을 R01~R19로 연결하고 구현 전 상태를 전부 ‘미구현/미검증’으로 표시한다. 코드가 생기면 관련 테스트 경로와 실제 명령을 추가한다. 체크리스트 자체를 테스트 통과로 취급하지 않는다.

`task-template.md` 필드: 작업 ID, 목적, 관련 요구사항 ID, 변경 허용 범위, 수용 조건, 진행 상태, 변경 파일, 실행 명령·종료 코드·결과, 남은 문제, 다음 한 단계. 비밀값·대화 원문을 기록하지 않는다.

`decisions.md`: 승인된 제품 방향과 Harness 범위, 미결정인 앱 스택·인증·호스팅·Codex 연결 방식을 구분한다. Harness가 앱 기술 선택을 대신하지 않는다고 명시한다.

`README.md`: 프로젝트 목적, 현재 단계, PowerShell 7/Git 전제, 점검 명령, 제품 검증 없음, 문서 위치와 시작 절차.

- [x] **Step 5: 제외 규칙과 manifest 작성**

`.gitignore`:

```gitignore
/work/
.env
.env.*
!.env.example
*.log
```

`docs/harness/manifest.json`:

```json
{
  "version": 1,
  "productSpec": "docs/product/spec.md",
  "requiredFiles": [
    "AGENTS.md", "README.md", ".gitignore",
    "docs/product/spec.md", "docs/harness/design.md",
    "docs/harness/workflow.md", "docs/harness/checks.md",
    "docs/harness/task-template.md", "docs/harness/decisions.md",
    "docs/harness/plans/2026-09-21-bootstrap.md",
    "scripts/check-harness.ps1", "scripts/test-harness.ps1"
  ],
  "productChecksConfigured": false
}
```

- [x] **Step 6: 문서 일관성 확인**

AGENTS.md, manifest, README가 같은 제품 원본을 가리키는지 확인한다. 문서 링크는 저장소 안의 상대 경로로 통일하고 원격 URL만 예외로 둔다. 임시 인계 로그를 추적 파일로 만들지 않는다.

## Task 2: 검사기와 실패 시나리오 검증

**Files:** Create `scripts/check-harness.ps1`, `scripts/test-harness.ps1`.

**Interfaces:**

```powershell
# 검사기
param([switch]$RequireProduct)
# default root = parent of $PSScriptRoot; caller cwd is not used
# exit 0: Harness checks pass, product explicitly NOT_CONFIGURED
# exit 1: missing file/link, invalid manifest, missing ignore rules
# exit 2: Harness passes but -RequireProduct requested without runnable product checks
```

첫 버전의 productChecksConfigured는 false만 허용한다. true로 바꾸는 것만으로 제품 검증을 통과시킬 수 없으며 아직 실행기가 없는 true는 구성 오류로 거부한다. 스택 도입 시 명령 실행·실패 전파 테스트와 함께 확장한다.

- [x] **Step 1: 실제 프로세스 단위 실패 테스트 작성**

`test-harness.ps1`는 `$PSHOME/pwsh.exe`를 사용해 검사기를 별도 프로세스로 실행한다. 실행 환경이 Unix이면 `pwsh` 바이너리를 선택한다. 테스트용 구조는 `work/harness-tests/<guid>/`에 만든다. 대상 검사기가 없으면 실패해야 한다.

시나리오별로 독립 fixture를 구성한다. 원본 파일을 삭제하거나 조작하지 않는다. 같은 저장소 이름이 있는 다른 디렉터리를 재사용하지 않는다.

```powershell
function Assert-Exit($Expected, $Actual, $Name) {
    if ($Expected -ne $Actual) {
        throw "$Name expected exit $Expected, got $Actual"
    }
}
# 각 fixture에서 검사기 실행 직후 $LASTEXITCODE를 캡처한다.
# 실패 fixture에서 예상된 비정상 종료는 테스트 성공 조건이다.
```

필수 시나리오와 기대 결과:

| fixture | 기대 종료 코드 |
|---|---|
| 정상 구성 | 0, 출력에 PRODUCT: NOT_CONFIGURED |
| AGENTS.md 제거 | 1 |
| 존재하지 않는 로컬 문서 링크 추가 | 1 |
| manifest JSON 손상 | 1 |
| productSpec를 없는 파일로 변경 | 1 |
| .gitignore에서 /work/ 제거 | 1 |
| 정상 구성에 -RequireProduct | 2 |
| productChecksConfigured=true | 1 |
| 공백 있는 fixture 경로 + 다른 cwd에서 실행 | 0 |

- [x] **Step 2: 검사기 부재로 실패하는지 확인**

```powershell
pwsh -NoProfile -File scripts/test-harness.ps1
```

검사기가 아직 없어 실패해야 한다. 실패 이유가 문법 오류라면 테스트를 고친 뒤 다시 실행한다.

- [x] **Step 3: 검사기 구현**

핵심 뼈대:

```powershell
param([switch]$RequireProduct)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
try {
    $manifestPath = Join-Path $root 'docs/harness/manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    # requiredFiles, productSpec, version=1, productChecksConfigured=false 검증
    # 각 requiredFiles에 Test-Path -LiteralPath ... -PathType Leaf 적용
    # Markdown 링크는 해당 문서 디렉터리를 기준으로 존재 여부 검사
    # .gitignore의 /work/, .env, .env.*, !.env.example 규칙 검사
    Write-Output 'HARNESS: PASS'
    Write-Output 'PRODUCT: NOT_CONFIGURED'
    if ($RequireProduct) { exit 2 }
    exit 0
} catch {
    Write-Output ('HARNESS: FAIL - ' + $_.Exception.Message)
    exit 1
}
```

구현 시 위 주석 위치에 다음 검사를 실제 코드로 채운다. manifest 필드 누락·잘못된 타입·빈 requiredFiles를 구성 오류로 거부한다. 상대 경로를 정규화하고 저장소 밖을 가리키는 로컬 필수 파일과 링크를 거부한다. HTTP(S) 링크와 같은 문서의 #anchor는 파일 존재 검사에서 제외한다. 링크의 #fragment는 경로 검사 전에 제거한다. 코드 블록 안의 예시 링크는 검사하지 않는다. 원격 URL 유효성이나 Markdown anchor 존재까지 검사한다고 주장하지 않는다.

- [x] **Step 4: 검증 실행**

```powershell
pwsh -NoProfile -File scripts/test-harness.ps1
pwsh -NoProfile -File scripts/check-harness.ps1
pwsh -NoProfile -File scripts/check-harness.ps1 -RequireProduct
git check-ignore work/probe.txt .env .env.local
git check-ignore .env.example
```

기대: fixture 검증 전체 성공; 기본 점검 0; RequireProduct 2; 임시·비밀 파일 제외; .env.example은 제외되지 않음. 검사 결과는 Harness 검증에만 해당한다.

## Task 3: 통합 리뷰와 전달

**Files:** Create 상위 `outputs/agent-harness-guide.md`.

- [x] **Step 1:** 실행한 명령·결과·미검증 사항을 기록한다. 테스트 로그는 `work/`에 보관한다.
- [x] **Step 2:** 코드 리뷰 절차로 검사기의 거짓 성공, 잘못된 경로 처리, 명세 중복을 확인한다. 리뷰에서 중요한 결함을 찾으면 수정하고 관련 검증만 재실행한다.
- [x] **Step 3:** `git diff --check`, `git status --short`로 문서와 스크립트 변경·제외 상태를 확인한다. 미추적 파일은 별도로 검사한다. 원격 push는 하지 않는다.
- [x] **Step 4:** 사용 가이드를 작성한다. 저장소 위치, 최초 점검 명령, 작업 시작·종료 방법, 제품 코드 미구현, Codex 자동 지침 로드의 수동 확인 방법을 포함한다.
- [x] **Step 5:** 실제로 만든 파일과 점검 결과를 사용자에게 전달한다. 새로운 Codex 세션에서 자동 지침 로딩을 검증하지 않았다면 ‘미검증’으로 보고한다.

## 실행 방식

권장: 현재 세션에서 직접 구현하고 마지막에 독립 리뷰. 문서와 검사기가 같은 경로 규약을 공유하므로 작업별 구현 에이전트로 나눌 이점이 작다. 사용자가 병렬 구현을 선택하면 작업 간 인터페이스와 수정 파일을 분리해 진행한다.

## 완료 조건

저장소 내 AGENTS.md부터 제품 원본과 작업 규칙을 찾을 수 있고, 검사기 정상·실패 시나리오가 모두 기대대로 동작해야 한다. 제품 테스트·자동 인계·MCP·Discord 연결을 구현한 것으로 보고하지 않는다.
