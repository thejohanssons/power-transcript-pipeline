# ============================================================
# Copyright (c) 2026 Virrata AB. All rights reserved.
# Executive Insights Pipeline (EIP) — Proprietary & Confidential
# Unauthorised use or distribution is strictly prohibited.
# ============================================================
<#
.SYNOPSIS
    Migrates historical topic records from master_log.json to D1 via EIP API Worker.

.DESCRIPTION
    One-time migration. Reads transcript_master_log.json (from SharePoint or local),
    iterates all meetings and their TopicRecords, and POSTs each to /topics.
    Occurrences are marked Processed (historical — skip agent review queue).

.PARAMETER MasterLogPath
    Path to local master_log.json. If omitted, downloads from SharePoint.

.PARAMETER DryRun
    If set, shows what would be migrated without calling the API.

.EXAMPLE
    ./migrate-topics-to-d1.ps1 -DryRun
    ./migrate-topics-to-d1.ps1 -MasterLogPath "./TranscriptExport/master_log.json"
    ./migrate-topics-to-d1.ps1
#>

[CmdletBinding()]
param(
    [string]$MasterLogPath = "",
    [switch]$DryRun
)

$apiWorkerBase = "https://eip-api-worker.homeassistant-8d3.workers.dev"
$spHostname    = "scanningpens.sharepoint.com"
$spSitePath    = "/sites/MeetingIntelligence"
$tenantId      = if ($env:GRAPH_TENANT_ID)    { $env:GRAPH_TENANT_ID }    else { "f9e144a5-228f-4e5a-86c4-2cc253376402" }
$clientId      = if ($env:GRAPH_CLIENT_ID)    { $env:GRAPH_CLIENT_ID }    else { throw "GRAPH_CLIENT_ID not set" }
$clientSecret  = if ($env:GRAPH_CLIENT_SECRET){ $env:GRAPH_CLIENT_SECRET } else { throw "GRAPH_CLIENT_SECRET not set" }

# ---------------------------------------------------------------
# LOAD MASTER LOG
# ---------------------------------------------------------------
$masterLog = $null

if ($MasterLogPath -and (Test-Path $MasterLogPath)) {
    Write-Host "Loading master log from local path: $MasterLogPath"
    $masterLog = Get-Content $MasterLogPath -Raw | ConvertFrom-Json
} else {
    Write-Host "Downloading master log from SharePoint..."
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

    $siteUri    = "https://graph.microsoft.com/v1.0/sites/${spHostname}:${spSitePath}"
    $site       = Invoke-RestMethod -Uri $siteUri -Headers $authHeader
    $driveUri   = "https://graph.microsoft.com/v1.0/sites/$($site.id)/drives"
    $drives     = Invoke-RestMethod -Uri $driveUri -Headers $authHeader
    $drive      = $drives.value | Where-Object { $_.name -eq "Documents" } | Select-Object -First 1
    $driveId    = $drive.id

    $logUri     = "https://graph.microsoft.com/v1.0/drives/$driveId/root:/Meeting transcripts/master_log.json:/content"
    $tempFile   = [System.IO.Path]::GetTempFileName()
    Invoke-RestMethod -Uri $logUri -Headers $authHeader -OutFile $tempFile
    $masterLog  = Get-Content $tempFile -Raw | ConvertFrom-Json
    Remove-Item $tempFile -Force
}

$meetings = $masterLog.Meetings
Write-Host "Loaded master log: $($meetings.Count) meetings ✅"

# ---------------------------------------------------------------
# MIGRATE
# ---------------------------------------------------------------
$totalTopics     = 0
$totalInserted   = 0
$totalUpdated    = 0
$totalFailed     = 0

foreach ($meeting in $meetings) {
    $meetingId   = $meeting.MeetingId
    $subject     = $meeting.Subject
    $eventDate   = $meeting.EventDate
    $meetingDate = try { (Get-Date $eventDate -Format "yyyy-MM-dd") } catch { $eventDate.ToString().Substring(0,10) }
    $context     = $meeting.Classification ?? $meeting.Mode ?? "Unknown"
    $organiser   = $meeting.Organiser ?? ""

    if (-not $meeting.TopicRecords -or $meeting.TopicRecords.Count -eq 0) { continue }

    Write-Host "`n📋 $meetingId ($($meeting.TopicRecords.Count) topics)" -ForegroundColor Cyan

    foreach ($tr in $meeting.TopicRecords) {
        $totalTopics++

        # Map topic record fields to API schema
        $topicName = $tr.Topic ?? $tr.TopicName ?? $tr.Label ?? "Unknown"
        $domain    = $tr.Domain ?? "Unknown"
        $category  = $tr.Category ?? "Insight"
        $priority  = $tr.EXECUTIVE_PRIORITY ?? $tr.Priority ?? "Medium"
        $owner     = if ($tr.Ownership) { $tr.Ownership.PRIMARY_OWNER } else { $null }
        $summary   = $tr.Summary ?? $tr.Content ?? ""
        $topicId   = $tr.TopicId ?? ($topicName.ToLower() -replace '[^a-z0-9\s-]','' -replace '\s+','-')

        if ($DryRun) {
            Write-Host "  [DRY RUN] $topicId | $domain | $category | $priority" -ForegroundColor Yellow
            continue
        }

        $body = @{
            topic_id     = $topicId
            topic_name   = $topicName
            domain       = $domain
            category     = $category
            priority     = $priority
            owner        = $owner
            summary      = $summary
            meeting_ref  = $meetingId
            meeting_date = $meetingDate
            context      = $context
            source       = "Transcript"
        } | ConvertTo-Json

        try {
            $resp = Invoke-RestMethod -Method Post -Uri "$apiWorkerBase/topics" `
                -Body $body -ContentType "application/json"

            # Mark the occurrence as Processed (historical — bypass agent queue)
            if ($resp.occurrence_id) {
                $patchBody = @{ status = "Approved"; user_notes = "Migrated from master_log.json" } | ConvertTo-Json
                Invoke-RestMethod -Method Patch -Uri "$apiWorkerBase/queue/$($resp.occurrence_id)" `
                    -Body $patchBody -ContentType "application/json" | Out-Null
            }

            if ($resp.is_new) { $totalInserted++; Write-Host "  ✅ NEW: $topicId" -ForegroundColor Green }
            else              { $totalUpdated++;  Write-Host "  🔄 UPD: $topicId" -ForegroundColor Gray }
        } catch {
            $totalFailed++
            Write-Warning "  ❌ Failed: $topicId — $_"
        }
    }

    # Register the transcript in D1
    if (-not $DryRun -and $meetingId) {
        $transcriptBody = @{
            meeting_ref   = $meetingId
            meeting_date  = $meetingDate
            source_system = "M365"
            segment_count = 1
        } | ConvertTo-Json
        try {
            Invoke-RestMethod -Method Post -Uri "$apiWorkerBase/transcripts" `
                -Body $transcriptBody -ContentType "application/json" | Out-Null
        } catch { Write-Verbose "Transcript already registered or failed: $_" }
    }
}

# ---------------------------------------------------------------
# SUMMARY
# ---------------------------------------------------------------
Write-Host "`n=============================" -ForegroundColor Green
Write-Host "Topics migration complete$(if ($DryRun) { ' (DRY RUN)' })"
Write-Host "  Total topics : $totalTopics"
Write-Host "  Inserted     : $totalInserted"
Write-Host "  Updated      : $totalUpdated"
Write-Host "  Failed       : $totalFailed"
Write-Host "=============================" -ForegroundColor Green
