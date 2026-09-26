#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$steps = @('build', 'typecheck', 'test', 'test:integration', 'test:e2e')
$failureCode = 0
$failureStep = ''

Push-Location $root
try {
    foreach ($step in $steps) {
        Write-Output "PRODUCT: RUN npm run $step"
        & npm run $step
        $code = $LASTEXITCODE
        if ($code -ne 0) {
            $failureCode = $code
            $failureStep = $step
            break
        }
    }
} catch {
    $failureCode = 1
    $failureStep = $step
    Write-Output ('PRODUCT: ERROR - ' + $_.Exception.Message)
} finally {
    Pop-Location
}

if ($failureCode -ne 0) {
    Write-Output "PRODUCT: FAIL (npm run $failureStep, exit $failureCode)"
    exit $failureCode
}
Write-Output 'PRODUCT: PASS'
exit 0
