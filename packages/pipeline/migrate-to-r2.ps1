# ============================================================
# Copyright (c) 2026 Virrata AB. All rights reserved.
# Executive Insights Pipeline (EIP) — Proprietary & Confidential
# Unauthorised use or distribution is strictly prohibited.
# ============================================================
<#
.SYNOPSIS
    Migrates EIP transcript files from SharePoint to Cloudflare R2.

.DESCRIPTION
    One-time migration. Sources:
    1. Petersplace site — Exec Intel Insights/Meeting transcripts/YYYY-MM/ (primary)
       Includes transcripts, summaries, people files, and log files.
    2. MeetingIntelligence site — Transcripts drive (HoD files only, not in Petersplace)

.PARAMETER DryRun
    Lists files that would be migrated without uploading.

.PARAMETER FolderFilter
    Optional YYYY-MM folder filter (e.g. "2026-07"). All folders if omitted.

.EXAMPLE
    ./migrate-to-r2.ps1 -DryRun
    ./migrate-to-r2.ps1 -FolderFilter "2026-07"
    ./migrate-to-r2.ps1
#>

[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$FolderFilter = ""
)

# ---------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------
$apiWorkerBase  = "https://eip-api-worker.homeassistant-8d3.workers.dev"
$r2BucketName   = "eip-platform"
$tenantId       = if ($env:GRAPH_TENANT_ID) { $env:GRAPH_TENANT_ID } else { "f9e144a5-228f-4e5a-86c4-2cc253376402" }
$clientId       = if ($env:GRAPH_CLIENT_ID) { $env:GRAPH_CLIENT_ID } else { throw "GRAPH_CLIENT_ID not set" }
$clientSecret   = if ($env:GRAPH_CLIENT_SECRET) { $env:GRAPH_CLIENT_SECRET } else { throw "GRAPH_CLIENT_SECRET not set" }

# Petersplace — primary source
$ppSitePath     = "/sites/Petersplace"
$ppTranscriptPath = "Exec Intel Insights/Meeting transcripts"

# MeetingIntelligence — HoD files only
$miSitePath     = "/sites/MeetingIntelligence"
$miDriveName    = "Transcripts"

# ---------------------------------------------------------------
# AUTH
# ---------------------------------------------------------------
$tokenBody = @{
    grant_type    = "client_credentials"
    client_id     = $clientId
    client_secret = $clientSecret
    scope         = "https://graph.microsoft.com/.default"
}
$tokenResp  = Invoke-RestMethod -Method Post `
    -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" `
    -Body $tokenBody -ContentType "application/x-www-form-urlencoded"
$authHeader = @{ Authorization = "Bearer $($tokenResp.access_token)" }
Write-Host "Graph token acquired ✅"

# ---------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------
$totalUploaded = 0
$totalSkipped  = 0
$totalFailed   = 0

function Upload-FileToR2 {
    param($File, $R2Key, $FileType, $FolderName, $DriveId, $Auth, $DryRun)

    if ($DryRun) {
        Write-Host "  [DRY RUN] $($File.name) → r2://$R2Key" -ForegroundColor Yellow
        return "uploaded"
    }

    try {
        $downloadUri = "https://graph.microsoft.com/v1.0/drives/$DriveId/items/$($File.id)/content"
        $tempFile    = [System.IO.Path]::GetTempFileName()
        Invoke-RestMethod -Uri $downloadUri -Headers $Auth -OutFile $tempFile

        $wranglerArgs = @("r2", "object", "put", "$($script:r2BucketName)/$R2Key", "--file", $tempFile, "--remote")
        $result = & wrangler @wranglerArgs 2>&1
        Remove-Item $tempFile -Force

        if ($LASTEXITCODE -ne 0) { throw "Wrangler error: $result" }

        Write-Host "  ✅ $($File.name) → r2://$R2Key"
        return "uploaded"
    } catch {
        Write-Warning "  ❌ Failed: $($File.name) — $_"
        return "failed"
    }
}

function Register-TranscriptInD1 {
    param($FileName, $R2Key, $MeetingDate)
    $meetingRef = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $body = @{
        meeting_ref   = $meetingRef
        meeting_date  = $MeetingDate
        source_system = "M365"
        segment_count = 1
        r2_key        = $R2Key
    } | ConvertTo-Json
    try {
        Invoke-RestMethod -Method Post -Uri "$($script:apiWorkerBase)/transcripts" `
            -Body $body -ContentType "application/json" | Out-Null
    } catch {
        Write-Verbose "    D1 registration skipped (may already exist): $_"
    }
}

function Get-DateFromFilename {
    param([string]$FileName)
    if ($FileName -match '(\d{4})-(\d{2})-(\d{2})') {
        return "$($matches[1])-$($matches[2])-$($matches[3])"
    } elseif ($FileName -match '(\d{4})(\d{2})(\d{2})') {
        return "$($matches[1])-$($matches[2])-$($matches[3])"
    }
    return $null
}

# ---------------------------------------------------------------
# SOURCE 1: PETERSPLACE — YYYY-MM folders
# ---------------------------------------------------------------
Write-Host "`n=== SOURCE 1: Petersplace ===" -ForegroundColor Magenta

$ppSite   = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/sites/scanningpens.sharepoint.com:$($ppSitePath)" -Headers $authHeader
$ppDrives = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/sites/$($ppSite.id)/drives" -Headers $authHeader
$ppDrive  = $ppDrives.value | Where-Object { $_.name -eq "Documents" } | Select-Object -First 1
$ppDriveId = $ppDrive.id
Write-Host "Drive: $($ppDrive.name) ($ppDriveId) ✅"

# Get YYYY-MM folders
$foldersUri = "https://graph.microsoft.com/v1.0/drives/$ppDriveId/root:/$($ppTranscriptPath):/children"
$folders = (Invoke-RestMethod -Uri $foldersUri -Headers $authHeader).value |
    Where-Object { $_.folder -and $_.name -match '^\d{4}-\d{2}$' -and ($FolderFilter -eq "" -or $_.name -eq $FolderFilter) }

Write-Host "Found $($folders.Count) YYYY-MM folder(s)"

# Get log files from root
$rootItems = (Invoke-RestMethod -Uri $foldersUri -Headers $authHeader).value | Where-Object { $_.file }

foreach ($folder in ($folders | Sort-Object name)) {
    $folderName = $folder.name
    Write-Host "`n📁 $folderName" -ForegroundColor Cyan

    $filesUri = "https://graph.microsoft.com/v1.0/drives/$ppDriveId/items/$($folder.id)/children"
    $files = @()
    $nextLink = $filesUri
    do {
        $resp     = Invoke-RestMethod -Uri $nextLink -Headers $authHeader
        $files   += $resp.value | Where-Object { $_.file }
        $nextLink = $resp.'@odata.nextLink'
    } while ($nextLink)

    Write-Host "  $($files.Count) files"

    foreach ($file in $files) {
        $name = $file.name

        # Skip non-transcript files and source_snapshot test entries
        if ($name -notmatch '\.(vtt|txt)$') { $totalSkipped++; continue }
        if ($name -match 'source_snapshot') { Write-Verbose "  Skipping source_snapshot: $name"; $totalSkipped++; continue }

        # Determine type and R2 key
        if ($name -match '-People\.txt$') {
            $r2Key   = "people/$folderName/$name"
            $type    = "people"
        } elseif ($name -match '-Summary\.txt$') {
            $r2Key   = "summaries/$folderName/$name"
            $type    = "summary"
        } else {
            $r2Key   = "transcripts/$folderName/$name"
            $type    = "transcript"
        }

        $result = Upload-FileToR2 -File $file -R2Key $r2Key -FileType $type -FolderName $folderName -DriveId $ppDriveId -Auth $authHeader -DryRun $DryRun

        if ($result -eq "uploaded") {
            $totalUploaded++
            if ($type -eq "transcript" -and -not $DryRun) {
                $meetingDate = Get-DateFromFilename -FileName $name
                if (-not $meetingDate) { $meetingDate = "$folderName-01" }
                Register-TranscriptInD1 -FileName $name -R2Key $r2Key -MeetingDate $meetingDate
            }
        } elseif ($result -eq "failed") { $totalFailed++ }
    }
}

# Upload log files from root
Write-Host "`n📄 Log files from Petersplace root..." -ForegroundColor Cyan
$logFiles = @("master_log.json", "master_people_log.json", "master_log.txt", "master_people_log.txt")
foreach ($logName in $logFiles) {
    $logFile = $rootItems | Where-Object { $_.name -eq $logName }
    if (-not $logFile) { Write-Warning "  Not found: $logName"; continue }
    $r2Key = "logs/$logName"
    $result = Upload-FileToR2 -File $logFile -R2Key $r2Key -FileType "log" -FolderName "logs" -DriveId $ppDriveId -Auth $authHeader -DryRun $DryRun
    if ($result -eq "uploaded") { $totalUploaded++ } elseif ($result -eq "failed") { $totalFailed++ }
}

# ---------------------------------------------------------------
# SOURCE 2: MEETINGINTELLIGENCE — HoD files only (not in Petersplace)
# ---------------------------------------------------------------
Write-Host "`n=== SOURCE 2: MeetingIntelligence (HoD files only) ===" -ForegroundColor Magenta

$miSite    = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/sites/scanningpens.sharepoint.com:$($miSitePath)" -Headers $authHeader
$miDrives  = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/sites/$($miSite.id)/drives" -Headers $authHeader
$miDrive   = $miDrives.value | Where-Object { $_.name -eq $miDriveName } | Select-Object -First 1
$miDriveId = $miDrive.id
Write-Host "Drive: $($miDrive.name) ($miDriveId) ✅"

$miFiles = @()
$nextLink = "https://graph.microsoft.com/v1.0/drives/$miDriveId/root/children"
do {
    $resp     = Invoke-RestMethod -Uri $nextLink -Headers $authHeader
    $miFiles += $resp.value | Where-Object { $_.file -and $_.name -match '^HoD_' }
    $nextLink = $resp.'@odata.nextLink'
} while ($nextLink)

Write-Host "Found $($miFiles.Count) HoD file(s)"

foreach ($file in $miFiles) {
    $name    = $file.name
    if ($FolderFilter -ne "" -and $name -notmatch $FolderFilter) { $totalSkipped++; continue }
    $r2Key   = "transcripts/$name"
    $result  = Upload-FileToR2 -File $file -R2Key $r2Key -FileType "transcript" -FolderName "" -DriveId $miDriveId -Auth $authHeader -DryRun $DryRun
    if ($result -eq "uploaded") {
        $totalUploaded++
        if (-not $DryRun) {
            $meetingDate = Get-DateFromFilename -FileName $name
            if ($meetingDate) { Register-TranscriptInD1 -FileName $name -R2Key $r2Key -MeetingDate $meetingDate }
        }
    } elseif ($result -eq "failed") { $totalFailed++ }
}

# ---------------------------------------------------------------
# SUMMARY
# ---------------------------------------------------------------
Write-Host "`n=============================" -ForegroundColor Green
Write-Host "R2 Migration complete$(if ($DryRun) { ' (DRY RUN)' })"
Write-Host "  Uploaded : $totalUploaded"
Write-Host "  Skipped  : $totalSkipped"
Write-Host "  Failed   : $totalFailed"
Write-Host "=============================" -ForegroundColor Green
