# ============================================================
# Copyright (c) 2026 Virrata AB. All rights reserved.
# Executive Insights Pipeline (EIP) — Proprietary & Confidential
# Unauthorised use or distribution is strictly prohibited.
# ============================================================
<#
.SYNOPSIS
    Migrates Topic Record .md files from SharePoint to R2 (blob) and D1 (parsed).

.DESCRIPTION
    Reads all Topic Record .md files from Petersplace SharePoint site:
      Exec Intel Insights/Topic Records/YYYY-MM/[meeting-ref]/[file].md
    
    For each file:
    - Uploads to R2: topic-records/YYYY-MM/[meeting-ref]/[file].md
    - Parses metadata + content sections
    - Upserts to D1 topics table (specific named topic with fuzzy dedup via API)
    - Creates D1 topic_occurrences row with full intelligence fields

.PARAMETER DryRun
    Lists files without uploading or writing to D1.

.PARAMETER MonthFilter
    Optional YYYY-MM filter (e.g. "2026-07"). All months if omitted.

.EXAMPLE
    ./migrate-topic-records-to-d1.ps1 -DryRun
    ./migrate-topic-records-to-d1.ps1 -MonthFilter "2026-07"
    ./migrate-topic-records-to-d1.ps1
#>

[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$MonthFilter = ""
)

$apiWorkerBase = "https://eip-api-worker.homeassistant-8d3.workers.dev"
$r2BucketName  = "eip-platform"
$spHostname    = "scanningpens.sharepoint.com"
$ppSitePath    = "/sites/Petersplace"
$topicRecordsPath = "Exec Intel Insights/Topic Records"
$tenantId      = if ($env:GRAPH_TENANT_ID) { $env:GRAPH_TENANT_ID } else { "f9e144a5-228f-4e5a-86c4-2cc253376402" }
$clientId      = if ($env:GRAPH_CLIENT_ID) { $env:GRAPH_CLIENT_ID } else { throw "GRAPH_CLIENT_ID not set" }
$clientSecret  = if ($env:GRAPH_CLIENT_SECRET) { $env:GRAPH_CLIENT_SECRET } else { throw "GRAPH_CLIENT_SECRET not set" }

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
# GET DRIVE
# ---------------------------------------------------------------
$site    = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/sites/$($spHostname):$($ppSitePath)" -Headers $authHeader
$drives  = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/sites/$($site.id)/drives" -Headers $authHeader
$drive   = $drives.value | Where-Object { $_.name -eq "Documents" } | Select-Object -First 1
$driveId = $drive.id
Write-Host "Drive: $($drive.name) ✅"

# ---------------------------------------------------------------
# MARKDOWN PARSER
# ---------------------------------------------------------------
function Parse-TopicRecord {
    param([string]$Content, [string]$FileName)

    $result = @{
        title            = ""
        topic_family     = ""
        domain           = ""
        category         = ""
        priority         = "Medium"
        owner            = $null
        status           = "Open"
        trend            = "Stable"
        summary          = ""
        key_facts        = @()
        decisions        = @()
        actions          = @()
        risks            = @()
        next_steps       = @()
        retrieval_anchors = @{ people = @(); projects = @(); products = @(); systems = @() }
        meeting_ref      = ""
        meeting_date     = ""
        eip_validation   = ""
    }

    # Normalise line endings — use regex split to handle all variations (\r\n, \r, \n)
    $lines = [regex]::Split($Content, '\r\n|\r|\n')
    $currentSection = ""

    foreach ($line in $lines) {
        $line = $line.TrimEnd()

        # Metadata fields
        if ($line -match '^\*\*TITLE:\*\*\s*(.+)$')              { $result.title = $matches[1].Trim() }
        elseif ($line -match '^\*\*TOPIC_FAMILY:\*\*\s*(.+)$')    { $result.topic_family = $matches[1].Trim() }
        elseif ($line -match '^\*\*TOPIC:\*\*\s*(.+)$')          { if (-not $result.topic_family) { $result.topic_family = $matches[1].Trim() } }
        elseif ($line -match '^\*\*DOMAIN:\*\*\s*(.+)$')         { $result.domain = $matches[1].Trim() }
        elseif ($line -match '^\*\*CATEGORY:\*\*\s*(.+)$')       { $result.category = $matches[1].Trim() }
        elseif ($line -match '^\*\*EXECUTIVE_PRIORITY:\*\*\s*(.+)$') {
            $p = $matches[1].Trim()
            if ($p -notin @("Unknown","")) { $result.priority = $p }
        }
        elseif ($line -match '^\*\*PRIMARY_OWNER:\*\*\s*(.+)$')  { $result.owner = $matches[1].Trim() }
        elseif ($line -match '^\*\*STATUS:\*\*\s*(.+)$')         { if ($matches[1].Trim()) { $result.status = $matches[1].Trim() } }
        elseif ($line -match '^\*\*TRAJECTORY:\*\*\s*(.+)$')     {
            $t = $matches[1].Trim()
            $tMap = @{ "Improving" = "Resolving"; "Escalating" = "Escalating"; "Stable" = "Stable"; "Declining" = "Escalating"; "Resolving" = "Resolving" }
            if ($tMap.ContainsKey($t)) { $result.trend = $tMap[$t] }
        }
        elseif ($line -match '^\*\*DATE:\*\*\s*(.+)$') {
            $dateStr = $matches[1].Trim()
            try { $result.meeting_date = (Get-Date $dateStr -Format "yyyy-MM-dd") } catch { $result.meeting_date = $dateStr.Substring(0, [Math]::Min(10, $dateStr.Length)) }
        }
        elseif ($line -match '^\*\*SOURCE_MEETING:\*\*') {
            # Extract meeting ref from the filename pattern
            if ($FileName -match '^(.+?)--') { $result.meeting_ref = $matches[1] }
        }
        elseif ($line -match '^\*\*EIP_VALIDATION:\*\*\s*(.+)$') { $result.eip_validation = $matches[1].Trim() }

        # Retrieval anchors
        elseif ($line -match '^\*\*PEOPLE:\*\*\s*(.+)$') {
            $result.retrieval_anchors.people = @($matches[1].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne "None" })
        }
        elseif ($line -match '^\*\*PROJECTS:\*\*\s*(.+)$') {
            $result.retrieval_anchors.projects = @($matches[1].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne "None" })
        }
        elseif ($line -match '^\*\*PRODUCTS:\*\*\s*(.+)$') {
            $result.retrieval_anchors.products = @($matches[1].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne "None" })
        }
        elseif ($line -match '^\*\*SYSTEMS:\*\*\s*(.+)$') {
            $result.retrieval_anchors.systems = @($matches[1].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne "None" })
        }

        # Section detection
        elseif ($line -match '^## (.+)$') { $currentSection = $matches[1].Trim() }
        elseif ($line -match '^### (.+)$') { $currentSection = $matches[1].Trim() }

        # Content sections — bullet points
        elseif ($line -match '^-\s+"?(.+)"?$' -or $line -match '^- \*\*(.+)\*\*') {
            $item = $matches[1].Trim().Trim('"')
            switch -Wildcard ($currentSection) {
                "Key Facts"      { $result.key_facts    += $item }
                "Summary"        { } # handled below
                "Decisions"      { $result.decisions    += $item }
                "Actions"        { $result.actions      += $item }
                "Risks*"         { $result.risks        += $item }
                "Next Steps"     { $result.next_steps   += $item }
            }
        }

        # Summary — paragraph text (not a heading or bullet)
        elseif ($currentSection -eq "Summary" -and $line -and -not $line.StartsWith('#') -and -not $line.StartsWith('-') -and -not $line.StartsWith('*')) {
            $result.summary += $line + " "
        }
    }

    $result.summary = $result.summary.Trim()
    return $result
}

function Slugify {
    param([string]$Text)
    return ($Text.ToLower() -replace '[^a-z0-9\s-]','' -replace '\s+','-' -replace '-+','-').Trim('-')
}

# ---------------------------------------------------------------
# ENUMERATE MONTH FOLDERS
# ---------------------------------------------------------------
$monthsUri = "https://graph.microsoft.com/v1.0/drives/$driveId/root:/$($topicRecordsPath):/children"
$months    = (Invoke-RestMethod -Uri $monthsUri -Headers $authHeader).value |
             Where-Object { $_.folder -and $_.name -match '^\d{4}-\d{2}$' -and ($MonthFilter -eq "" -or $_.name -eq $MonthFilter) } |
             Sort-Object name

Write-Host "Found $($months.Count) month folder(s)"

$totalFiles     = 0
$totalUploaded  = 0
$totalTopicsNew = 0
$totalTopicsUpd = 0
$totalFailed    = 0

foreach ($month in $months) {
    $monthName = $month.name
    Write-Host "`n📅 $monthName" -ForegroundColor Magenta

    # Get meeting subfolders
    $meetingFolders = (Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/drives/$driveId/items/$($month.id)/children" -Headers $authHeader).value |
                      Where-Object { $_.folder }

    foreach ($meetingFolder in $meetingFolders) {
        $meetingRef = $meetingFolder.name
        Write-Host "  📋 $meetingRef" -ForegroundColor Cyan

        # Get .md files in this meeting folder
        $mdFiles = (Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/drives/$driveId/items/$($meetingFolder.id)/children" -Headers $authHeader).value |
                   Where-Object { $_.file -and $_.name -match '\.md$' }

        foreach ($file in $mdFiles) {
            $fileName = $file.name
            $r2Key    = "topic-records/$monthName/$meetingRef/$fileName"
            $totalFiles++

            if ($DryRun) {
                Write-Host "    [DRY RUN] $fileName → r2://$r2Key" -ForegroundColor Yellow
                continue
            }

            try {
                # 1. Download content
                $downloadUri = "https://graph.microsoft.com/v1.0/drives/$driveId/items/$($file.id)/content"
                $tempFile    = [System.IO.Path]::GetTempFileName() + ".md"
                Invoke-RestMethod -Uri $downloadUri -Headers $authHeader -OutFile $tempFile
                $mdContent   = [System.IO.File]::ReadAllText($tempFile, [System.Text.Encoding]::UTF8)

                # 2. Upload to R2
                & wrangler r2 object put "$r2BucketName/$r2Key" --file $tempFile 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "R2 upload failed" }
                $totalUploaded++

                Remove-Item $tempFile -Force

                # 3. Parse markdown
                $parsed = Parse-TopicRecord -Content $mdContent -FileName $fileName

                # Use title as the specific topic name; fall back to filename stem
                $fileNameStem = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
                $topicName = if ($parsed.title) {
                    $parsed.title
                } else {
                    # Extract readable name from filename: strip meeting prefix, replace hyphens
                    ($fileNameStem -replace '^.+?--','') -replace '-',' '
                }

                # Fall back domain/category from filename if parser missed them
                if (-not $parsed.domain -or $parsed.domain -eq "") {
                    $parsed.domain = ($fileNameStem -replace '^.+?-T\d+-','') -replace '-',' '
                }
                if (-not $parsed.category -or $parsed.category -eq "") {
                    $parsed.category = "Insight"  # safe default
                }

                $topicId   = Slugify -Text $topicName
                $meetingDate = if ($parsed.meeting_date) { $parsed.meeting_date } elseif ($meetingRef -match '(\d{4}-\d{2}-\d{2})') { $matches[1] } else { "$monthName-01" }
                $actualMeetingRef = if ($parsed.meeting_ref) { $parsed.meeting_ref } else { $meetingRef }

                # 4. POST /topics (upsert with fuzzy dedup)
                $topicBody = @{
                    topic_id     = $topicId
                    topic_name   = $topicName
                    domain       = $parsed.domain
                    category     = $parsed.category
                    priority     = $parsed.priority
                    owner        = $parsed.owner
                    summary      = $parsed.summary
                    meeting_ref  = $actualMeetingRef
                    meeting_date = $meetingDate
                    source       = "Transcript"
                    context      = "EIP"
                } | ConvertTo-Json

                $topicResp = Invoke-RestMethod -Method Post -Uri "$apiWorkerBase/topics" `
                    -Body $topicBody -ContentType "application/json"

                if ($topicResp.is_new) { $totalTopicsNew++ } else { $totalTopicsUpd++ }

                # 5. PATCH occurrence to mark as Approved (historical migration — bypass agent queue)
                if ($topicResp.occurrence_id) {
                    $patchBody = @{
                        status     = "Approved"
                        user_notes = "Migrated from Topic Record: $fileName"
                    } | ConvertTo-Json
                    try {
                        Invoke-RestMethod -Method Patch -Uri "$apiWorkerBase/queue/$($topicResp.occurrence_id)" `
                            -Body $patchBody -ContentType "application/json" | Out-Null
                    } catch {
                        Write-Verbose "    Queue patch failed (non-critical): $_"
                    }
                }

                $indicator = if ($topicResp.is_new) { "🆕" } else { "🔄" }
                Write-Host "    $indicator $topicName" -ForegroundColor $(if ($topicResp.is_new) { "Green" } else { "Gray" })

            } catch {
                $totalFailed++
                Write-Warning "    ❌ Failed: $fileName — $_"
            }
        }
    }
}

# ---------------------------------------------------------------
# SUMMARY
# ---------------------------------------------------------------
Write-Host "`n=============================" -ForegroundColor Green
Write-Host "Topic Records migration complete$(if ($DryRun) { ' (DRY RUN)' })"
Write-Host "  Files found    : $totalFiles"
Write-Host "  R2 uploaded    : $totalUploaded"
Write-Host "  Topics new     : $totalTopicsNew"
Write-Host "  Topics updated : $totalTopicsUpd"
Write-Host "  Failed         : $totalFailed"
Write-Host "=============================" -ForegroundColor Green
