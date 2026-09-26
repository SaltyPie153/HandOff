#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$shell = Join-Path $PSHOME $(if ($IsWindows) { 'pwsh.exe' } else { 'pwsh' })
$testRoot = Join-Path $root ('work/harness-tests/' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$productCommands = @('run build','run typecheck','run test','run test:integration','run test:e2e')
$cases = @(
    @{Name='valid'; Code=0; Text='PRODUCT: NOT_RUN'},
    @{Name='missing-agent'; Code=1; Text='AGENTS.md'},
    @{Name='broken-link'; Code=1; Text='absent.md'},
    @{Name='titled-broken-link'; Code=1; Text='absent.md'},
    @{Name='invalid-json'; Code=1; Text='HARNESS: FAIL'},
    @{Name='missing-spec'; Code=1; Text='productSpec'},
    @{Name='missing-ignore'; Code=1; Text='/work/'},
    @{Name='product-pass'; Code=0; Text='PRODUCT: PASS'; Commands=$productCommands},
    @{Name='product-build-fail'; Code=13; Text='PRODUCT: FAIL'; FailStep='run build'; Commands=@('run build')},
    @{Name='product-typecheck-fail'; Code=14; Text='PRODUCT: FAIL'; FailStep='run typecheck'; Commands=$productCommands[0..1]},
    @{Name='product-test-fail'; Code=15; Text='PRODUCT: FAIL'; FailStep='run test'; Commands=$productCommands[0..2]},
    @{Name='product-integration-fail'; Code=16; Text='PRODUCT: FAIL'; FailStep='run test:integration'; Commands=$productCommands[0..3]},
    @{Name='product-e2e-fail'; Code=17; Text='PRODUCT: FAIL'; FailStep='run test:e2e'; Commands=$productCommands},
    @{Name='not-configured'; Code=2; Text='PRODUCT: NOT_CONFIGURED'},
    @{Name='space path different cwd'; Code=0; Text='HARNESS: PASS'},
    @{Name='outside-link'; Code=1; Text='outside'},
    @{Name='empty-required'; Code=1; Text='requiredFiles'},
    @{Name='string-flag'; Code=1; Text='productChecksConfigured'}
)
$failures = @()
foreach ($case in $cases) {
    $fixture = Join-Path $testRoot $case.Name
    New-Item -ItemType Directory -Path $fixture -Force | Out-Null
    foreach ($item in @('AGENTS.md','README.md','.gitignore','package.json','docs','scripts','specs')) {
        Copy-Item -LiteralPath (Join-Path $root $item) -Destination $fixture -Recurse
    }
    $manifestPath = Join-Path $fixture 'docs/harness/manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    switch ($case.Name) {
        'missing-agent' { Move-Item -LiteralPath (Join-Path $fixture 'AGENTS.md') -Destination (Join-Path $fixture 'agent-disabled.txt') }
        'broken-link' { Add-Content -LiteralPath (Join-Path $fixture 'README.md') -Value '[broken](absent.md)' }
        'titled-broken-link' { Add-Content -LiteralPath (Join-Path $fixture 'README.md') -Value '[broken](absent.md "Missing doc")' }
        'outside-link' { Add-Content -LiteralPath (Join-Path $fixture 'README.md') -Value '[outside](../outside.md)' }
        'invalid-json' { Set-Content -LiteralPath $manifestPath -Value '{bad' }
        'missing-spec' { $manifest.productSpec='missing.md'; $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath }
        'empty-required' { $manifest.requiredFiles=@(); $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath }
        'not-configured' { $manifest.productChecksConfigured=$false; $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath }
        'string-flag' { $manifest.productChecksConfigured='false'; $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath }
        'missing-ignore' { Get-Content -LiteralPath (Join-Path $fixture '.gitignore') | Where-Object { $_ -ne '/work/' } | Set-Content -LiteralPath (Join-Path $fixture '.gitignore.new'); Move-Item -LiteralPath (Join-Path $fixture '.gitignore.new') -Destination (Join-Path $fixture '.gitignore') -Force }
    }
    $arguments = @('-NoProfile','-File',(Join-Path $fixture 'scripts/check-harness.ps1'))
    $productCase = $case.Name -like 'product-*'
    if ($productCase -or $case.Name -eq 'valid') {
        $manifest.productChecksConfigured = $true
        $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath
    }
    if ($productCase -or $case.Name -eq 'not-configured') { $arguments += '-RequireProduct' }
    $originalPath = $env:PATH
    $originalLog = $env:FAKE_NPM_LOG
    $originalFailStep = $env:FAKE_FAIL_STEP
    $originalFailCode = $env:FAKE_FAIL_CODE
    if ($productCase) {
        $fakeBin = Join-Path $fixture 'fake-bin'
        New-Item -ItemType Directory -Path $fakeBin | Out-Null
        @'
$command = $args -join ' '
Add-Content -LiteralPath $env:FAKE_NPM_LOG -Value $command
if ($command -eq $env:FAKE_FAIL_STEP) { exit [int]$env:FAKE_FAIL_CODE }
exit 0
'@ | Set-Content -LiteralPath (Join-Path $fakeBin 'npm.ps1')
        $env:PATH = "$fakeBin$([IO.Path]::PathSeparator)$originalPath"
        $env:FAKE_NPM_LOG = Join-Path $fixture 'npm-commands.txt'
        $env:FAKE_FAIL_STEP = if ($case.ContainsKey('FailStep')) { $case.FailStep } else { '' }
        $env:FAKE_FAIL_CODE = [string]$case.Code
    }
    Push-Location $testRoot
    try {
        $output = (& $shell @arguments 2>&1 | Out-String)
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
        $env:PATH = $originalPath
        $env:FAKE_NPM_LOG = $originalLog
        $env:FAKE_FAIL_STEP = $originalFailStep
        $env:FAKE_FAIL_CODE = $originalFailCode
    }
    Set-Content -LiteralPath (Join-Path $fixture 'result.txt') -Value $output
    if ($code -ne $case.Code -or -not $output.Contains($case.Text)) {
        $failures += "$($case.Name): expected $($case.Code)/$($case.Text), got $code`n$output"
    } elseif ($productCase -and ((Get-Content -LiteralPath (Join-Path $fixture 'npm-commands.txt')) -join '|') -cne ($case.Commands -join '|')) {
        $failures += "$($case.Name): wrong npm command order"
    } else { Write-Output "PASS: $($case.Name)" }
}
if ($failures.Count) { $failures | Write-Output; exit 1 }
Write-Output "PASS: $($cases.Count) harness scenarios; fixtures: $testRoot"
exit 0
