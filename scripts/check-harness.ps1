#Requires -Version 7.0
param([switch]$RequireProduct)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$comparison = if ($IsWindows) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }

function Resolve-LocalFile([string]$Base, [string]$Relative, [string]$Label) {
    if ([string]::IsNullOrWhiteSpace($Relative) -or [IO.Path]::IsPathRooted($Relative)) {
        throw "$Label must be a relative file path: $Relative"
    }
    $full = [IO.Path]::GetFullPath((Join-Path $Base $Relative))
    if (-not $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, $comparison)) {
        throw "$Label points outside project: $Relative"
    }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "$Label missing file: $Relative" }
    return $full
}

try {
    $manifestPath = Join-Path $root 'docs/harness/manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable
    if ($manifest -isnot [System.Collections.IDictionary]) { throw 'manifest must be an object' }
    if ($manifest.version -isnot [long] -and $manifest.version -isnot [int]) { throw 'version must be integer 1' }
    if ($manifest.version -ne 1) { throw 'unsupported manifest version' }
    if ($manifest.productSpec -isnot [string] -or $manifest.productSpec -ne 'docs/product/spec.md') {
        throw 'productSpec must be docs/product/spec.md'
    }
    if ($manifest.requiredFiles -isnot [array] -or $manifest.requiredFiles.Count -eq 0) {
        throw 'requiredFiles must be a nonempty array'
    }
    if ($manifest.productChecksConfigured -isnot [bool] -or $manifest.productChecksConfigured) {
        throw 'productChecksConfigured must be false until a real product runner is implemented'
    }
    $files = @()
    foreach ($relative in $manifest.requiredFiles) {
        if ($relative -isnot [string]) { throw 'requiredFiles entries must be strings' }
        $files += Resolve-LocalFile $root $relative 'requiredFiles'
    }
    $null = Resolve-LocalFile $root $manifest.productSpec 'productSpec'
    foreach ($required in @('AGENTS.md','README.md','.gitignore','docs/product/spec.md','scripts/check-harness.ps1','scripts/test-harness.ps1')) {
        if ($manifest.requiredFiles -cnotcontains $required) { throw "requiredFiles must include $required" }
    }
    $ignore = Get-Content -LiteralPath (Join-Path $root '.gitignore')
    foreach ($rule in @('/work/','.env','.env.*','!.env.example')) {
        if ($ignore -cnotcontains $rule) { throw ".gitignore missing rule: $rule" }
    }
    $linkCount = 0
    foreach ($file in $files | Where-Object { [IO.Path]::GetExtension($_) -eq '.md' } | Select-Object -Unique) {
        $fence = $null
        foreach ($line in Get-Content -LiteralPath $file) {
            if ($line -match '^\s*(`{3,}|~{3,})') {
                $marker = $Matches[1]
                if ($null -eq $fence) { $fence = $marker }
                elseif ($marker[0] -eq $fence[0] -and $marker.Length -ge $fence.Length) { $fence = $null }
                continue
            }
            if ($null -ne $fence) { continue }
            foreach ($match in [regex]::Matches($line, '\[[^\]]*\]\((?<target><[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|''[^'']*''|\([^)]*\)))?\s*\)')) {
                $target = $match.Groups['target'].Value.Trim('<','>')
                if ($target -match '^https?://' -or $target.StartsWith('#')) { continue }
                $target = [Uri]::UnescapeDataString(($target -split '#', 2)[0])
                $null = Resolve-LocalFile (Split-Path $file -Parent) $target "link in $file"
                $linkCount++
            }
        }
    }
    Write-Output "HARNESS: PASS ($($files.Count) files, $linkCount local links)"
    Write-Output 'PRODUCT: NOT_CONFIGURED'
    if ($RequireProduct) { exit 2 }
    exit 0
} catch {
    Write-Output ('HARNESS: FAIL - ' + $_.Exception.Message)
    exit 1
}
