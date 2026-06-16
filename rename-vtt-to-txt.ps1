<#
Rename .vtt → .txt in YYYY-MM transcript folders

Usage:
  .\rename-vtt-to-txt.ps1 -RootPath "path/to/search"        # perform rename
  .\rename-vtt-to-txt.ps1 -RootPath "." -WhatIf            # preview only

Defaults:
  - RootPath defaults to current directory

Behavior:
  - Finds subfolders whose name matches YYYY-MM (e.g. 2026-06)
  - Renames files with extension .vtt (case-insensitive) to .txt
  - Preserves the rest of the filename exactly
  - Skips if destination already exists
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$RootPath = (Get-Location).Path,

    [Parameter(Mandatory=$false)]
    [switch]$WhatIf
)

Write-Verbose "RootPath: $RootPath"

if (-not (Test-Path -Path $RootPath)) {
    Write-Error "Root path not found: $RootPath"
    exit 1
}

$dirs = Get-ChildItem -Path $RootPath -Directory -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^[0-9]{4}-[0-9]{2}$' }

if (-not $dirs -or $dirs.Count -eq 0) {
    Write-Host "No YYYY-MM folders found under $RootPath"
    exit 0
}

$totalRenamed = 0
$totalSkipped = 0

foreach ($d in $dirs) {
    Write-Host "Scanning folder: $($d.FullName)"
    $files = Get-ChildItem -Path $d.FullName -File -Filter *.vtt -ErrorAction SilentlyContinue
    foreach ($f in $files) {
        $newName = [System.IO.Path]::ChangeExtension($f.Name, '.txt')
        $destPath = Join-Path -Path $f.DirectoryName -ChildPath $newName

        if (Test-Path -LiteralPath $destPath) {
            Write-Warning "Destination already exists, skipping: $destPath"
            $totalSkipped++
            continue
        }

        if ($WhatIf) {
            Write-Host "WhatIf: Rename '$($f.FullName)' -> '$newName'"
        }
        else {
            try {
                Rename-Item -LiteralPath $f.FullName -NewName $newName -ErrorAction Stop
                Write-Host "Renamed: $($f.FullName) -> $newName"
                $totalRenamed++
            }
            catch {
                Write-Warning "Failed to rename $($f.FullName): $($_.Exception.Message)"
                $totalSkipped++
            }
        }
    }
}

Write-Host "Done. Renamed: $totalRenamed, Skipped/Failed: $totalSkipped"
