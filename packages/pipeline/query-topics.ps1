# ============================================================
# Copyright (c) 2026 Virrata AB. All rights reserved.
# Executive Insights Pipeline (EIP) — Proprietary & Confidential
# Unauthorised use or distribution is strictly prohibited.
# ============================================================

# query-topics.ps1
# Utility to query Topic Records based on EIP 1.2 Metadata

param(
    [string]$Path = "artifacts/topics",
    [string]$PrimaryOwner,
    [string]$ProcessGovernor,
    [string]$ResourceFunction,
    [string]$Capability
)

function Get-TopicMetadata {
    param([string]$FilePath)
    $content = Get-Content $FilePath
    $metadata = @{ File = $FilePath }
    
    foreach ($line in $content) {
        if ($line -match '^\# Topic Record:\s*(.*)$') { $metadata.Title = $matches[1].Trim() }
        elseif ($line -match '^\- \*\*PRIMARY_OWNER:\*\*\s*(.*)$') { $metadata.PrimaryOwner = $matches[1].Trim() }
        elseif ($line -match '^\- \*\*PROCESS_GOVERNOR:\*\*\s*(.*)$') { $metadata.ProcessGovernor = $matches[1].Trim() }
        elseif ($line -match '^\- \*\*CAPABILITY:\*\*\s*(.*)$') { $metadata.Capability = $matches[1].Trim() }
        elseif ($line -match '^\- \*\*RESOURCE_FUNCTIONS:\*\*\s*(.*)$') { 
            $metadata.ResourceFunctions = $matches[1].Split(',') | ForEach-Object { $_.Trim() } 
        }
    }
    return $metadata
}

if (-not (Test-Path $Path)) {
    Write-Warning "Path $Path not found."
    exit
}

$files = Get-ChildItem -Path $Path -Filter "*.md"
$results = foreach ($f in $files) { Get-TopicMetadata -FilePath $f.FullName }

$filtered = $results | Where-Object {
    ($PrimaryOwner -eq "" -or $null -eq $PrimaryOwner -or $_.PrimaryOwner -eq $PrimaryOwner) -and
    ($ProcessGovernor -eq "" -or $null -eq $ProcessGovernor -or $_.ProcessGovernor -eq $ProcessGovernor) -and
    ($Capability -eq "" -or $null -eq $Capability -or $_.Capability -eq $Capability) -and
    ($ResourceFunction -eq "" -or $null -eq $ResourceFunction -or ($_.ResourceFunctions -contains $ResourceFunction))
}

$filtered | Select-Object Title, PrimaryOwner, ProcessGovernor, Capability | Format-Table -AutoSize
