# ============================================================
# Copyright (c) 2026 Virrata AB. All rights reserved.
# Executive Insights Pipeline (EIP) — Proprietary & Confidential
# Unauthorised use or distribution is strictly prohibited.
# ============================================================
<#
.SYNOPSIS
    Migrates EIP files from SharePoint to Cloudflare R2.

.DESCRIPTION
    One-time migration script. Enumerates transcript, summary, people, and log files
    from SharePoint via Graph API and uploads them to the eip-platform R2 bucket.
    Registers each transcript in D1 via the EIP API Worker.

.PARAMETER DryRun
    If set, lists files that would be migrated without uploading.

.PARAMETER FolderFilter
    Optional YYYY-MM folder filter (e.g. "2026-06"). Migrates all folders if omitted.

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
$apiWorkerBase   = "https://eip-api-worker.homeassistant-8d3.workers.dev"
$r2BucketName    = "eip-platform"
$spHostname      = "scanningpens.sharepoint.com"
$spSitePath      = "/sites/MeetingIntelligence"
$transcriptRoot  = "Meeting transcripts"  # root folder in SharePoint drive

$tenantId        = if ($env:GRAPH_TENANT_ID)    { $env:GRAPH_TENANT_ID }    else { "f9e144a5-228f-4e5a-86c4-2cc253376402" }
$clientId        = if ($env:GRAPH_CLIENT_ID)    { $env:GRAPH_CLIENT_ID }    else { throw "GRAPH_CLIENT_ID not set" }
$clientSecret    = if ($env:GRAPH_CLIENT_SECRET){ $env:GRAPH_CLIENT_SECRET } else { throw "GRAPH_CLIENT_SECRET not set" }

# ---------------------------------------------------------------
# AUTH
# ---------------------------------------------------------------
function Get-GraphToken {
    $body = @{
        grant_type    = "client_credentials"
        client_id     = $clientId
        client_secret = $clientSecret
        scope         = "https://graph.microsoft.com/.default"
    }
    $resp = Invoke-RestMethod -Method Post `
        -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" `
        -Body $body -ContentType "application/x-www-form-urlencoded"
    return @{ Authorization = "Bearer $($resp.access_token)" }
}

$authHeader = Get-GraphToken
Write-Host "Graph token acquired ✅"

# ---------------------------------------------------------------
# GET DRIVE
# ---------------------------------------------------------------
$siteUri  = "https://graph.microsoft.com/v1.0/sites/${spHostname}:${spSitePath}"
$site     = Invoke-RestMethod -Uri $siteUri -Headers $authHeader
$driveUri = "https://graph.microsoft.com/v1.0/sites/$($site.id)/drives"
$drives   = Invoke-RestMethod -Uri $driveUri -Headers $authHeader
$drive    = $drives.value | Where-Object { $_.name -eq "Documents" } | Select-Object -First 1
$driveId  = $drive.id
Write-Host "SharePoint drive: $($drive.name) ($driveId) ✅"

# ---------------------------------------------------------------
# ENUMERATE FOLDERS (YYYY-MM)
# ---------------------------------------------------------------
$rootUri  = "https://graph.microsoft.com/v1.0/drives/$driveId/root:/$transcriptRoot:/children"
$folders  = (Invoke-RestMethod -Uri $rootUri -Headers $authHeader).value |
            Where-Object { $_.folder -and ($FolderFilter -eq "" -or $_.name -eq $FolderFilter) }

Write-Host "Found $($folders.Count) folder(s) to migrate"

$totalUploaded = 0
$totalSkipped  = 0
$totalFailed   = 0

foreach ($folder in $folders) {
    $folderName = $folder.name   # e.g. "2026-07"
    Write-Host "`n📁 Processing folder: $folderName" -ForegroundColor Cyan

    # Get all files in this folder
    $filesUri = "https://graph.microsoft.com/v1.0/drives/$driveId/items/$($folder.id)/children"
    $files    = @()
    $nextLink = $filesUri
    do {
        $resp      = Invoke-RestMethod -Uri $nextLink -Headers $authHeader
        $files    += $resp.value | Where-Object { $_.file }
        $nextLink  = $resp.'@odata.nextLink'
    } while ($nextLink)

    Write-Host "  Found $($files.Count) file(s)"

    foreach ($file in $files) {
        $fileName = $file.name

        # Determine R2 key and file type
        $r2Key = $null
        $fileType = $null

        if ($fileName -match '\.(vtt|txt)$' -and $fileName -notmatch 'People|Summary|master|log') {
            $r2Key    = "transcripts/$folderName/$fileName"
            $fileType = "transcript"
        } elseif ($fileName -match 'People\.txt$') {
            $r2Key    = "people/$folderName/$fileName"
            $fileType = "people"
        } elseif ($fileName -match 'Summary\.txt$' -or $fileName -match '-summary\.txt$') {
            $r2Key    = "summaries/$folderName/$fileName"
            $fileType = "summary"
        } else {
            Write-Verbose "  Skipping: $fileName (not a target file type)"
            $totalSkipped++
            continue
        }

        if ($DryRun) {
            Write-Host "  [DRY RUN] Would upload: $fileName → r2://$r2Key" -ForegroundColor Yellow
            $totalUploaded++
            continue
        }

        try {
            # Download from SharePoint
            $downloadUri = "https://graph.microsoft.com/v1.0/drives/$driveId/items/$($file.id)/content"
            $tempFile    = [System.IO.Path]::GetTempFileName()
            Invoke-RestMethod -Uri $downloadUri -Headers $authHeader -OutFile $tempFile

            # Upload to R2 via wrangler
            $wranglerArgs = @("r2", "object", "put", "$r2BucketName/$r2Key", "--file", $tempFile)
            $result = & wrangler @wranglerArgs 2>&1
            Remove-Item $tempFile -Force

            if ($LASTEXITCODE -ne 0) { throw "Wrangler upload failed: $result" }

            Write-Host "  ✅ $fileName → r2://$r2Key"

            # Register transcript in D1
            if ($fileType -eq "transcript") {
                # Extract meeting_ref from filename (strip extension)
                $meetingRef  = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
                # Extract YYYY-MM-DD from folder name pattern
                $meetingDate = if ($folderName -match '(\d{4}-\d{2})') { "$($matches[1])-01" } else { $folderName }

                $body = @{
                    meeting_ref   = $meetingRef
                    meeting_date  = $meetingDate
                    source_system = "M365"
                    segment_count = 1
                    r2_key        = $r2Key
                } | ConvertTo-Json

                try {
                    Invoke-RestMethod -Method Post -Uri "$apiWorkerBase/transcripts" `
                        -Body $body -ContentType "application/json" | Out-Null
                    Write-Host "    → Registered in D1" -ForegroundColor Gray
                } catch {
                    Write-Warning "    D1 registration failed for $meetingRef: $_"
                }
            }

            $totalUploaded++
        } catch {
            Write-Warning "  ❌ Failed: $fileName — $_"
            $totalFailed++
        }
    }
}

# ---------------------------------------------------------------
# UPLOAD LOG FILES
# ---------------------------------------------------------------
Write-Host "`n📄 Uploading log files..." -ForegroundColor Cyan
$logFiles = @("master_log.json", "master_people_log.json", "master_log.txt", "master_people_log.txt")
$logFolderUri = "https://graph.microsoft.com/v1.0/drives/$driveId/root:/$transcriptRoot:/children"
$rootFiles = (Invoke-RestMethod -Uri $logFolderUri -Headers $authHeader).value | Where-Object { $_.file }

foreach ($logFile in $logFiles) {
    $spFile = $rootFiles | Where-Object { $_.name -eq $logFile }
    if (-not $spFile) { Write-Warning "  Not found on SharePoint: $logFile"; continue }

    $r2Key = "logs/$logFile"
    if ($DryRun) { Write-Host "  [DRY RUN] Would upload: $logFile → r2://$r2Key" -ForegroundColor Yellow; continue }

    try {
        $downloadUri = "https://graph.microsoft.com/v1.0/drives/$driveId/items/$($spFile.id)/content"
        $tempFile    = [System.IO.Path]::GetTempFileName()
        Invoke-RestMethod -Uri $downloadUri -Headers $authHeader -OutFile $tempFile
        & wrangler r2 object put "$r2BucketName/$r2Key" --file $tempFile 2>&1 | Out-Null
        Remove-Item $tempFile -Force
        Write-Host "  ✅ $logFile → r2://$r2Key"
        $totalUploaded++
    } catch {
        Write-Warning "  ❌ Failed: $logFile — $_"
        $totalFailed++
    }
}

# ---------------------------------------------------------------
# SUMMARY
# ---------------------------------------------------------------
Write-Host "`n=============================" -ForegroundColor Green
Write-Host "Migration complete$(if ($DryRun) { ' (DRY RUN)' })"
Write-Host "  Uploaded : $totalUploaded"
Write-Host "  Skipped  : $totalSkipped"
Write-Host "  Failed   : $totalFailed"
Write-Host "=============================" -ForegroundColor Green
