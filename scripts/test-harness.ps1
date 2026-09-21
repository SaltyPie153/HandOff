#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$shell = Join-Path $PSHOME $(if ($IsWindows) { 'pwsh.exe' } else { 'pwsh' })
$testRoot = Join-Path $root ('work/harness-tests/' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$cases = @(
    @{Name='valid'; Code=0; Text='PRODUCT: NOT_CONFIGURED'},
    @{Name='missing-agent'; Code=1; Text='AGENTS.md'},
    @{Name='broken-link'; Code=1; Text='absent.md'},
    @{Name='titled-broken-link'; Code=1; Text='absent.md'},
    @{Name='invalid-json'; Code=1; Text='HARNESS: FAIL'},
    @{Name='missing-spec'; Code=1; Text='productSpec'},
    @{Name='missing-ignore'; Code=1; Text='/work/'},
    @{Name='require-product'; Code=2; Text='PRODUCT: NOT_CONFIGURED'},
    @{Name='fake-product'; Code=1; Text='productChecksConfigured'},
    @{Name='space path different cwd'; Code=0; Text='HARNESS: PASS'},
    @{Name='outside-link'; Code=1; Text='outside'},
    @{Name='empty-required'; Code=1; Text='requiredFiles'},
    @{Name='string-flag'; Code=1; Text='productChecksConfigured'}
)
$failures = @()
foreach ($case in $cases) {
    $fixture = Join-Path $testRoot $case.Name
    New-Item -ItemType Directory -Path $fixture -Force | Out-Null
    foreach ($item in @('AGENTS.md','README.md','.gitignore','docs','scripts')) {
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
        'fake-product' { $manifest.productChecksConfigured=$true; $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath }
        'string-flag' { $manifest.productChecksConfigured='false'; $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath }
        'missing-ignore' { Get-Content -LiteralPath (Join-Path $fixture '.gitignore') | Where-Object { $_ -ne '/work/' } | Set-Content -LiteralPath (Join-Path $fixture '.gitignore.new'); Move-Item -LiteralPath (Join-Path $fixture '.gitignore.new') -Destination (Join-Path $fixture '.gitignore') -Force }
    }
    $arguments = @('-NoProfile','-File',(Join-Path $fixture 'scripts/check-harness.ps1'))
    if ($case.Name -eq 'require-product') { $arguments += '-RequireProduct' }
    Push-Location $testRoot
    try {
        $output = (& $shell @arguments 2>&1 | Out-String)
        $code = $LASTEXITCODE
    } finally { Pop-Location }
    Set-Content -LiteralPath (Join-Path $fixture 'result.txt') -Value $output
    if ($code -ne $case.Code -or -not $output.Contains($case.Text)) {
        $failures += "$($case.Name): expected $($case.Code)/$($case.Text), got $code`n$output"
    } else { Write-Output "PASS: $($case.Name)" }
}
if ($failures.Count) { $failures | Write-Output; exit 1 }
Write-Output "PASS: $($cases.Count) harness scenarios; fixtures: $testRoot"
exit 0
