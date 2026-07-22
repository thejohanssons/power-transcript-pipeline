# ============================================================
# Copyright (c) 2026 Virrata AB. All rights reserved.
# Executive Insights Pipeline (EIP) — Proprietary & Confidential
# Unauthorised use or distribution is strictly prohibited.
# ============================================================
<#
.SYNOPSIS
    Migrates historical meeting participants from master_people_log.json to D1.

.DESCRIPTION
    One-time migration. Reads master_people_log.json (from SharePoint or local),
    iterates all entries and their PeopleResolved arrays, looks up display name
    and role from people_config.json, then POSTs to /participants.

.PARAMETER PeopleLogPath
    Path to local master_people_log.json. Downloads from SharePoint if omitted.

.PARAMETER PeopleConfigPath
    Path to people_config.json. Defaults to ../../config/people_config.json.

.PARAMETER DryRun
    If set, shows what would be migrated without calling the API.

.EXAMPLE
    ./migrate-people-to-d1.ps1 -DryRun
    ./migrate-people-to-d1.ps1 -PeopleLogPath "./TranscriptExport/master_people_log.json"
    ./migrate-people-to-d1.ps1
#>

[CmdletBinding()]
param(
    [string]$PeopleLogPath    = "",
    [string]$PeopleConfigPath = "",
    [switch]$DryRun
)

$apiWorkerBase = "https://eip-api-worker.homeassistant-8d3.workers.dev"
$spHostname    = "scanningpens.sharepoint.com"
$spSitePath    = "/sites/MeetingIntelligence"
$tenantId      = if ($env:GRAPH_TENANT_ID)    { $env:GRAPH_TENANT_ID }    else { "f9e144a5-228f-4e5a-86c4-2cc253376402" }
$clientId      = if ($env:GRAPH_CLIENT_ID)    { $env:GRAPH_CLIENT_ID }    else { throw "GRAPH_CLIENT_ID not set" }
$clientSecret  = if ($env:GRAPH_CLIENT_SECRET){ $env:GRAPH_CLIENT_SECRET } else { throw "GRAPH_CLIENT_SECRET not set" }

# ---------------------------------------------------------------
# LOAD PEOPLE CONFIG (for display name + role lookup)
# ---------------------------------------------------------------
$scriptDir = $PSScriptRoot
if (-not $PeopleConfigPath) {
    $PeopleConfigPath = if (Test-Path (Join-Path $scriptDir "../../config/people_config.json")) {
        (Resolve-Path (Join-Path $scriptDir "../../config/people_config.json")).Path
    } else {
        Join-Path $scriptDir "config/people_config.json"
    }
}

$peopleConfig = $null
if (Test-Path $PeopleConfigPath) {
    $peopleConfig = (Get-Content $PeopleConfigPath -Raw | ConvertFrom-Json).people
    Write-Host "People config loaded: $($peopleConfig.Count) people ✅"
} else {
    Write-Warning "people_config.json not found at $PeopleConfigPath — display names and roles will be null"
}

function Get-PersonInfo {
    param([string]$PersonId)
    if (-not $peopleConfig) { return @{ display_name = $null; role = $null } }
    $p = $peopleConfig | Where-Object { $_.id -eq $PersonId } | Select-Object -First 1
    if (-not $p) { return @{ display_name = $null; role = $null } }
    return @{
        display_name = $p.display_name ?? $p.name ?? $null
        role         = $p.role ?? $p.title ?? $null
    }
}

# ---------------------------------------------------------------
# GET GRAPH TOKEN
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
# LOAD PEOPLE LOG
# ---------------------------------------------------------------
$peopleLog = $null

if ($PeopleLogPath -and (Test-Path $PeopleLogPath)) {
    Write-Host "Loading people log from: $PeopleLogPath"
    $peopleLog = Get-Content $PeopleLogPath -Raw | ConvertFrom-Json
} else {
    Write-Host "Downloading master_people_log.json from SharePoint..."
    $siteUri   = "https://graph.microsoft.com/v1.0/sites/${spHostname}:${spSitePath}"
    $site      = Invoke-RestMethod -Uri $siteUri -Headers $authHeader
    $driveUri  = "https://graph.microsoft.com/v1.0/sites/$($site.id)/drives"
    $drives    = Invoke-RestMethod -Uri $driveUri -Headers $authHeader
    $drive     = $drives.value | Where-Object { $_.name -eq "Documents" } | Select-Object -First 1
    $driveId   = $drive.id

    $logUri    = "https://graph.microsoft.com/v1.0/drives/$driveId/root:/Meeting transcripts/master_people_log.json:/content"
    $tempFile  = [System.IO.Path]::GetTempFileName()
    Invoke-RestMethod -Uri $logUri -Headers $authHeader -OutFile $tempFile
    $peopleLog = Get-Content $tempFile -Raw | ConvertFrom-Json
    Remove-Item $tempFile -Force
}

$entries = $peopleLog.Entries
Write-Host "Loaded people log: $($entries.Count) meeting entries ✅"

# ---------------------------------------------------------------
# MIGRATE
# ---------------------------------------------------------------
$totalMeetings  = 0
$totalInserted  = 0
$totalFailed    = 0

foreach ($entry in $entries) {
    $meetingId = $entry.MeetingId
    $subject   = $entry.Subject
    $eventDate = $entry.EventDate

    $meetingDate = try { (Get-Date $eventDate -Format "yyyy-MM-dd") } catch { $eventDate.ToString().Substring(0,10) }

    $people = $entry.PeopleResolved
    if (-not $people -or $people.Count -eq 0) {
        Write-Verbose "  Skipping $meetingId — no PeopleResolved"
        continue
    }

    $totalMeetings++
    Write-Host "`n👥 $meetingId ($($people.Count) participants)" -ForegroundColor Cyan

    if ($DryRun) {
        foreach ($p in $people) {
            $info = Get-PersonInfo -PersonId $p
            Write-Host "  [DRY RUN] $p | $($info.display_name) | $($info.role)" -ForegroundColor Yellow
        }
        continue
    }

    # Build participants array
    $participants = @()
    foreach ($personId in $people) {
        $info = Get-PersonInfo -PersonId $personId
        $participants += @{
            person_id    = $personId
            display_name = $info.display_name
            role         = $info.role
            was_organiser = $false
        }
    }

    $body = @{
        meeting_ref  = $meetingId
        meeting_date = $meetingDate
        participants = $participants
        source       = "PeopleLog"
    } | ConvertTo-Json -Depth 5

    try {
        $resp = Invoke-RestMethod -Method Post -Uri "$apiWorkerBase/participants" `
            -Body $body -ContentType "application/json"
        $totalInserted += $resp.inserted
        Write-Host "  ✅ Inserted: $($resp.inserted) | Skipped: $($resp.skipped)"
    } catch {
        $totalFailed++
        Write-Warning "  ❌ Failed: $meetingId — $_"
    }
}

# ---------------------------------------------------------------
# SUMMARY
# ---------------------------------------------------------------
Write-Host "`n=============================" -ForegroundColor Green
Write-Host "People migration complete$(if ($DryRun) { ' (DRY RUN)' })"
Write-Host "  Meetings processed : $totalMeetings"
Write-Host "  Participants added : $totalInserted"
Write-Host "  Failed meetings    : $totalFailed"
Write-Host "=============================" -ForegroundColor Green
