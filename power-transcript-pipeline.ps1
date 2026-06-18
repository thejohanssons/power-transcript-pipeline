<#
Transcript Pipeline (REST-based)

Notes:
- Uses Invoke-RestMethod instead of Microsoft.Graph SDK to avoid assembly conflicts in Azure Functions.
- Preserves all meeting processing logic and date parsing from user version.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [object]$FromDate,
    
    [Parameter(Mandatory=$false)]
    [object]$ToDate
)

# =========================
# DATE PARSING (Restoring your logic)
# =========================

if ($FromDate) {
    if ($FromDate -isnot [datetime]) { $FromDate = [datetime]::Parse($FromDate) }
} else {
    $FromDate = (Get-Date).AddDays(-1).Date
}

if ($ToDate) {
    if ($ToDate -isnot [datetime]) { $ToDate = [datetime]::Parse($ToDate) }
} else {
    $ToDate = Get-Date
}

if ($ToDate.TimeOfDay -eq [TimeSpan]::Zero) {
    $ToDate = $ToDate.Date.AddDays(1).AddTicks(-1)
}

Write-Output "FromDate resolved to: $FromDate"
Write-Output "ToDate resolved to: $ToDate"

$runId = Get-Date -Format "yyyyMMdd_HHmmss"

# =========================
# CONFIG
# =========================

$tenantId     = "f9e144a5-228f-4e5a-86c4-2cc253376402"
$clientId     = "9cfcadb2-27c0-41e5-8c6e-c1305c4827e2"
$clientSecret = $env:GRAPH_CLIENT_SECRET

if (-not $clientSecret) {
    throw "GRAPH_CLIENT_SECRET environment variable is not set"
}

$calendarUserUpn = "peter@empoweringtech.com"
# Use temporary directory for cloud compatibility (Function App file system is often read-only)
# On Linux Azure Functions, /tmp is the guaranteed writable location.
$tempRoot = if ($null -ne $env:TEMP) { $env:TEMP } elseif ($IsLinux) { "/tmp" } else { $PSScriptRoot }
$outDir = Join-Path $tempRoot "TranscriptExport"

if (-not (Test-Path $outDir)) {
    $null = New-Item -ItemType Directory -Path $outDir -Force
}

Write-Output "Local working directory: $outDir"

$spHostname             = "scanningpens.sharepoint.com"
$spSiteServerRelPath    = "/sites/Petersplace"
$spTranscriptRootFolder = "/Exec Intel Insights/Meeting transcripts"
$spRunLogsFolderName    = "_DO_NOT_PRIORITISE_Run logs"

# =========================
# REST AUTH HELPER
# =========================
$rulesPath = Join-Path $PSScriptRoot "classification_rules.json"
$rules = Get-Content -Path $rulesPath | ConvertFrom-Json

function Get-MeetingClassification {
    param($type, $organiser, $transcriptContent)

    # 1. TYPE (fast heuristic)
    if ($rules.TypeRules.CEO -contains $type) {
        return @{ classification = "CEO"; confidence = "High"; source = "rule" }
    }
    if ($rules.TypeRules.CPO -contains $type) {
        return @{ classification = "CPO"; confidence = "High"; source = "rule" }
    }

    # 2. ORGANISER (disambiguation)
    if ($type -eq "Work" -or $type -eq "Ad-Hoc" -or $type -eq "Compliance") {
        if ($rules.OrganiserRules.CEO -contains $organiser) {
            return @{ classification = "CEO"; confidence = "High"; source = "rule" }
        }
        if ($rules.OrganiserRules.CPO -contains $organiser) {
            return @{ classification = "CPO"; confidence = "High"; source = "rule" }
        }
    }

    # 3. TRANSCRIPT (LLM pre-analysis)
    if ($transcriptContent -and $rules.LLMConfig.Endpoint) {
        try {
            $llmBody = @{
                model = $rules.LLMConfig.Model
                messages = @(
                    @{ role = "system"; content = $rules.LLMConfig.Prompt },
                    @{ role = "user"; content = "Transcript to classify:`n`n$transcriptContent" }
                )
                temperature = 0
            } | ConvertTo-Json -Depth 10
            
            $llmKey = if ($env:FOUNDRY_API_KEY) { $env:FOUNDRY_API_KEY } else { $rules.LLMConfig.ApiKey }
            $headers = @{ "api-key" = $llmKey }
            
            # Construct the Azure-specific deployment URL if it looks like an Azure host
            $fullUri = if ($rules.LLMConfig.Endpoint -match "openai.azure.com") {
                # Azure OpenAI format: {endpoint}/openai/deployments/{model}/chat/completions?api-version=...
                $base = $rules.LLMConfig.Endpoint -replace "/openai/v1/?$", ""
                "$base/openai/deployments/$($rules.LLMConfig.Model)/chat/completions?api-version=2024-02-15-preview"
            } else {
                "$($rules.LLMConfig.Endpoint)/chat/completions"
            }
            
            $response = try {
                Invoke-RestMethod -Method Post -Uri $fullUri -Headers $headers -Body $llmBody -ContentType "application/json"
            } catch {
                # Fallback to standard Authorization header if api-key fails
                $headers = @{ "Authorization" = "Bearer $llmKey" }
                Invoke-RestMethod -Method Post -Uri $fullUri -Headers $headers -Body $llmBody -ContentType "application/json"
            }
            
            $rawContent = $response.choices[0].message.content
            # The LLM might wrap the JSON in Markdown backticks
            $sanitizedContent = $rawContent -replace "(?s)^.*?\{", "{" -replace "\}.*?$", "}"
            $resultJson = $sanitizedContent | ConvertFrom-Json
            
            return @{ 
                classification = $resultJson.classification; 
                confidence     = $resultJson.confidence; 
                source         = "llm" 
            }
        } catch {
            Write-Warning "LLM Classification failed: $_"
        }
    }

    # Default if everything fails
    return @{ classification = "CEO"; confidence = "Low"; source = "default" }
}

# =========================

function Get-GraphToken {
    $body = @{
        client_id     = $clientId
        client_secret = $clientSecret
        scope         = "https://graph.microsoft.com/.default"
        grant_type    = "client_credentials"
    }
    $tokenResponse = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" -Body $body
    return $tokenResponse.access_token
}

$accessToken = Get-GraphToken
$authHeader = @{ Authorization = "Bearer $accessToken" }
Write-Host "Connected to Microsoft Graph (REST) ✅"

# =========================
# HELPERS
# =========================

function Get-OrganiserIdFromJoinUrl {
    param([string]$JoinUrl)
    $decoded = [System.Net.WebUtility]::UrlDecode($JoinUrl)
    if ($decoded -match '"Oid":"([^"]+)"') { return $matches[1] }
    return $null
}

function Ensure-DriveFolder {
    param($DriveId, $FolderPath)
    $currentItem = "root"
    $segments = $FolderPath -split "/" | Where-Object { $_ -and $_.Trim() -ne "" }
    foreach ($seg in $segments) {
        $uri = "https://graph.microsoft.com/v1.0/drives/$DriveId/items/$currentItem/children"
        $children = Invoke-RestMethod -Method Get -Uri $uri -Headers $authHeader
        $exists = $children.value | Where-Object { $_.name -eq $seg -and $_.folder }
        if ($exists) {
            $currentItem = $exists.id
        } else {
            $body = @{ name = $seg; folder = @{}; "@microsoft.graph.conflictBehavior" = "rename" } | ConvertTo-Json
            $new = Invoke-RestMethod -Method Post -Uri $uri -Headers $authHeader -Body $body -ContentType "application/json"
            $currentItem = $new.id
        }
    }
    return $currentItem
}

function Upload-FileToSharePoint {
    param($DriveId, $FolderId, $FilePath)
    $fileName = [System.IO.Path]::GetFileName($FilePath)
    $uploadUri = "https://graph.microsoft.com/v1.0/drives/$DriveId/items/$FolderId`:/$fileName`:/content"
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    return Invoke-RestMethod -Method Put -Uri $uploadUri -Headers $authHeader -Body $bytes -ContentType "application/octet-stream"
}

# =========================
# RESOLVE SHAREPOINT
# =========================

$siteUri = "https://graph.microsoft.com/v1.0/sites/$($spHostname):$spSiteServerRelPath"
$site = Invoke-RestMethod -Method Get -Uri $siteUri -Headers $authHeader
Write-Host "Resolved SharePoint site ✅"

$driveUri = "https://graph.microsoft.com/v1.0/sites/$($site.id)/drive"
$drive = Invoke-RestMethod -Method Get -Uri $driveUri -Headers $authHeader
$driveId = $drive.id
Write-Host "Resolved SharePoint drive ✅"

$runLogsFolderPath = "$spTranscriptRootFolder/$spRunLogsFolderName"
$runLogsFolderId = Ensure-DriveFolder -DriveId $driveId -FolderPath $runLogsFolderPath
Write-Host "Run logs folder ready ✅"

# =========================
# FETCH CALENDAR
# =========================

Write-Host "Fetching calendar events..."
$startStr = $FromDate.ToString("yyyy-MM-ddTHH:mm:ssZ")
$endStr = $ToDate.ToString("yyyy-MM-ddTHH:mm:ssZ")
$calUri = "https://graph.microsoft.com/v1.0/users/$calendarUserUpn/calendarView?startDateTime=$startStr&endDateTime=$endStr&`$top=999"
$eventsResponse = Invoke-RestMethod -Method Get -Uri $calUri -Headers $authHeader
$events = $eventsResponse.value

# Filter only relevant completed Teams meetings
$events = $events | Where-Object {
    $_.isOnlineMeeting -eq $true -and
    $_.onlineMeeting -and
    $_.onlineMeeting.joinUrl -and
    $_.isCancelled -eq $false -and
    $_.subject -notmatch '^Canceled:' -and
    [datetime]$_.end.dateTime -lt (Get-Date)
}

$eventCount = ($events | Measure-Object).Count
Write-Host ("Meetings found: " + $eventCount + " ✅")

# Fallback: include events where user is listed as an attendee
$filterEnd = $ToDate.ToString("yyyy-MM-ddTHH:mm:ssZ")
$attendeeUri = "https://graph.microsoft.com/v1.0/users/$calendarUserUpn/events?`$top=999&`$filter=isOnlineMeeting eq true and end/dateTime lt '$filterEnd' and attendees/any(a:a/emailAddress/address eq '$calendarUserUpn')"

try {
    $attendeeResp = Invoke-RestMethod -Method Get -Uri $attendeeUri -Headers $authHeader
    $attendeeEvents = $attendeeResp.value
} catch {
    $attendeeEvents = @()
}

if ($attendeeEvents -and $attendeeEvents.Count -gt 0) {
    $map = @{}
    foreach ($e in $events) { if ($e.id) { $map[$e.id] = $e } }
    foreach ($e in $attendeeEvents) { if ($e.id -and -not $map.ContainsKey($e.id)) { $map[$e.id] = $e } }
    $events = $map.Values
}

# =========================
# PROCESS MEETINGS
# =========================

$log = @()

foreach ($calendarEvent in $events) {
    $subject   = $calendarEvent.subject
    $joinUrl   = $calendarEvent.onlineMeeting.joinUrl
    $organiser = $calendarEvent.organizer.emailAddress.address
    $start     = $calendarEvent.start.dateTime

    Write-Host ("Processing: " + $subject)

    # --- Determine Type and Priority based on Subject ---
    $meetingType = "Work"
    $priority    = "normal"

    if ($subject -match "ExCo") {
        $meetingType = "ExCo"
        $priority    = "high"
    } elseif ($subject -match "Payment" -or $subject -match "Finance") {
        $meetingType = "Finance"
    } elseif ($subject -match "Sales") {
        $meetingType = "Sales"
    } elseif ($subject -match "Market" -or $subject -match "Marketing") {
        $meetingType = "Marketing"
    } elseif ($subject -match "Education") {
        $meetingType = "Education"
    } elseif ($subject -match "NPI" -or $subject -match "Stage") {
        $meetingType = "Product Management"
    }

    $eventDateFolder = (Get-Date $start -Format "yyyy-MM")
    $eventFolderPath = "$spTranscriptRootFolder/$eventDateFolder"
    $eventFolderId = Ensure-DriveFolder -DriveId $driveId -FolderPath $eventFolderPath

    $organiserId = Get-OrganiserIdFromJoinUrl -JoinUrl $joinUrl

    if (-not $organiserId) {
        $log += [pscustomobject]@{
            RunId         = $runId
            Subject       = $subject
            EventDate     = $start
            Status        = "error"
            Type          = $meetingType
            Priority      = $priority
            AgentState    = "error"
            LastProcessed = $null
            RetryCount    = 0
            File          = $null
        }
        continue
    }

    try {
        $encUrl = [System.Net.WebUtility]::UrlEncode($joinUrl)
        $meetingUri = "https://graph.microsoft.com/v1.0/users/$organiserId/onlineMeetings?`$filter=JoinWebUrl%20eq%20'$encUrl'"
        $meeting = Invoke-RestMethod -Method Get -Uri $meetingUri -Headers $authHeader

        if (-not $meeting.value -or $meeting.value.Count -eq 0) { continue }

        $meetingId = $meeting.value[0].id
        $transcriptsUri = "https://graph.microsoft.com/v1.0/users/$organiserId/onlineMeetings/$meetingId/transcripts"
        $transcripts = Invoke-RestMethod -Method Get -Uri $transcriptsUri -Headers $authHeader

        $eventDate = (Get-Date $start).Date
        $transcriptsForThisEvent = @($transcripts.value | Where-Object { 
            $_.createdDateTime -and ([datetime]$_.createdDateTime).Date -eq $eventDate 
        })

        if (-not $transcriptsForThisEvent -or $transcriptsForThisEvent.Count -eq 0) {
            $isChannelCandidate = $joinUrl -match "threadId"
            
            # --- CLASSIFICATION LOGIC (without transcript) ---
            $cls = Get-MeetingClassification -type $meetingType -organiser $organiser -transcriptContent $null

            $log += [pscustomobject]@{
                RunId                    = $runId
                Subject                  = $subject
                Organiser                = $organiser
                EventDate                = $start
                Status                   = if ($isChannelCandidate) { "no_transcript_channel_candidate" } else { "no_transcript" }
                Type                     = $meetingType
                Priority                 = $priority
                Classification           = $cls.classification
                ClassificationConfidence = $cls.confidence
                ClassificationSource     = $cls.source
                AgentState               = "skipped"
                LastProcessed            = $null
                RetryCount               = 0
                File                     = $null
            }
            continue
        }

        foreach ($t in $transcriptsForThisEvent) {
            $transcriptId = $t.id
            $cleanSubject = $subject -replace '[^a-zA-Z0-9\s-]', '' -replace '\s+', '_'
            $timestamp = (Get-Date $start -Format "yyyy-MM-dd_HHmm")
            $localFile = Join-Path $outDir "$timestamp-$cleanSubject.txt"

            $contentUri = "https://graph.microsoft.com/v1.0/users/$organiserId/onlineMeetings/$meetingId/transcripts/$transcriptId/content"
            
            $content = Invoke-RestMethod -Method Get -Uri $contentUri -Headers $authHeader

            # --- METADATA ENHANCEMENT ---
            $datePart = (Get-Date $start -Format "yyyy-MM-dd_HHmm")
            $slugSubject = ($subject -replace '[^a-zA-Z0-9]', '_').ToLower()
            $mId = "$datePart`_$slugSubject"
            $masterLogUrl = "https://scanningpens.sharepoint.com/sites/Petersplace/Shared%20Documents/Exec%20Intel%20Insights/Meeting%20transcripts/master_log.txt"

            # --- CLASSIFICATION LOGIC ---
            $cls = Get-MeetingClassification -type $meetingType -organiser $organiser -transcriptContent $content

            $header = @"
---
MEETING ID: $mId
SUBJECT: $subject
ORGANISER: $organiserId
EVENT DATE: $start
TYPE: $meetingType
PRIORITY: $priority
CLASSIFICATION: $($cls.classification)
CLASSIFICATION_CONFIDENCE: $($cls.confidence)
CLASSIFICATION_SOURCE: $($cls.source)
STATUS: success
BACK-LINK (MASTER LOG): $masterLogUrl
---

"@
            # Prepend header to content
            $contentWithHeader = $header + $content
            $contentWithHeader | Out-File -FilePath $localFile -Encoding utf8

            $uploaded = Upload-FileToSharePoint -DriveId $driveId -FolderId $eventFolderId -FilePath $localFile
            
            # Update SharePoint Columns (Drives API doesn't support custom columns directly, must hit the List Item)
            try {
                $fieldsUri = "https://graph.microsoft.com/v1.0/drives/$driveId/items/$($uploaded.id)/listitem/fields"
                $fieldData = @{
                    "MeetingID"      = $mId
                    "Category"       = $meetingType
                    "Priority"       = $priority
                    "Classification" = $cls.classification
                }
                Invoke-RestMethod -Method Patch -Uri $fieldsUri -Headers $authHeader -Body ($fieldData | ConvertTo-Json) -ContentType "application/json" | Out-Null
            } catch {
                Write-Warning "Could not update SharePoint columns for $($uploaded.name). Ensure the columns 'MeetingID', 'Category', 'Priority', and 'Classification' exist in the library."
            }

            $log += [pscustomobject]@{
                RunId                    = $runId
                Subject                  = $subject
                Organiser                = $organiser
                EventDate                = $start
                Status                   = "success"
                Type                     = $meetingType
                Priority                 = $priority
                Classification           = $cls.classification
                ClassificationConfidence = $cls.confidence
                ClassificationSource     = $cls.source
                AgentState               = "pending"
                LastProcessed            = $null
                RetryCount               = 0
                File                     = $uploaded.webUrl
            }
        }
    }
    catch {
        $log += [pscustomobject]@{
            RunId                    = $runId
            Subject                  = $subject
            Organiser                = $organiser
            EventDate                = $start
            Status                   = "error"
            Type                     = $meetingType
            Priority                 = $priority
            Classification           = "CEO"
            ClassificationConfidence = "Low"
            ClassificationSource     = "error"
            AgentState               = "error"
            LastProcessed            = $null
            RetryCount               = 0
            File                     = $null
        }
    }
}

# =========================
# SAVE LOGS
# =========================

Write-Host "Saving run logs..."
$csvPath  = Join-Path $outDir "transcript_log_$runId.csv"
$jsonPath = Join-Path $outDir "transcript_log_$runId.json"

if ($log -and $log.Count -gt 0) {
    $log | Export-Csv -Path $csvPath
    $log | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath
} else {
    "RunId,Subject,EventDate,Status,Type,Priority,AgentState,LastProcessed,RetryCount,File" | Out-File -FilePath $csvPath -Encoding utf8
    '[]' | Set-Content -Path $jsonPath -Encoding utf8
}

if ($runLogsFolderId) {
    Upload-FileToSharePoint -DriveId $driveId -FolderId $runLogsFolderId -FilePath $csvPath | Out-Null
    Upload-FileToSharePoint -DriveId $driveId -FolderId $runLogsFolderId -FilePath $jsonPath | Out-Null
    Write-Host "Run logs uploaded ✅"
}

# =========================
# MAINTAIN MASTER LOG
# =========================

Write-Host "Updating Master Log..."
$masterLogFileName = "master_log.json"
$masterLogLocalPath = Join-Path $outDir $masterLogFileName

# 1. Resolve Root Folder ID (where master_log.json lives)
$rootFolderId = Ensure-DriveFolder -DriveId $driveId -FolderPath $spTranscriptRootFolder

# 2. Download existing Master Log if it exists
$masterLogData = @{ Meetings = @() }
try {
    $existingFileUri = "https://graph.microsoft.com/v1.0/drives/$driveId/items/$rootFolderId`:/$masterLogFileName"
    $existingFile = Invoke-RestMethod -Method Get -Uri $existingFileUri -Headers $authHeader
    
    $downloadUri = "https://graph.microsoft.com/v1.0/drives/$driveId/items/$($existingFile.id)/content"
    $masterLogData = Invoke-RestMethod -Method Get -Uri $downloadUri -Headers $authHeader
} catch {
    Write-Host "No existing Master Log found. Starting fresh."
}

# 3. Merge current run results into Master Log
$now = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
foreach ($runEntry in $log) {
    # Generate unique ID: yyyy-MM-dd_HHmm_slugified_subject
    $datePart = (Get-Date $runEntry.EventDate -Format "yyyy-MM-dd_HHmm")
    $slugSubject = ($runEntry.Subject -replace '[^a-zA-Z0-9]', '_').ToLower()
    $meetingId = "$datePart`_$slugSubject"

    $existingMatch = $masterLogData.Meetings | Where-Object { $_.MeetingId -eq $meetingId }

    $updatedEntry = @{
        MeetingId                = $meetingId
        Subject                  = $runEntry.Subject
        Organiser                = $runEntry.Organiser # Using the property from the run log entry
        EventDate                = $runEntry.EventDate
        Type                     = $runEntry.Type
        Priority                 = $runEntry.Priority
        Classification           = $runEntry.Classification
        ClassificationConfidence = $runEntry.ClassificationConfidence
        ClassificationSource     = $runEntry.ClassificationSource
        HasTranscript            = ($runEntry.Status -eq "success")
        TranscriptFile           = $runEntry.File
        Status                   = $runEntry.Status
        AgentState               = if ($existingMatch) { $existingMatch.AgentState } else { $runEntry.AgentState }
        LastProcessed            = if ($existingMatch) { $existingMatch.LastProcessed } else { $null }
        RetryCount               = if ($existingMatch) { $existingMatch.RetryCount } else { 0 }
        LastRunId                = $runId
        LastUpdated              = $now
    }

    if ($existingMatch) {
        # Update in place
        $idx = [array]::IndexOf($masterLogData.Meetings, $existingMatch)
        $masterLogData.Meetings[$idx] = $updatedEntry
    } else {
        # Add new
        $masterLogData.Meetings += $updatedEntry
    }
}

# 4. Save and Upload updated Master Log (JSON for deduplication source)
$masterLogData | ConvertTo-Json -Depth 10 | Set-Content -Path $masterLogLocalPath -Encoding utf8
Upload-FileToSharePoint -DriveId $driveId -FolderId $rootFolderId -FilePath $masterLogLocalPath | Out-Null

# 5. Generate and Upload Human-Readable Master Log (.txt)
$masterLogTxtName = "master_log.txt"
$masterLogTxtLocalPath = Join-Path $outDir $masterLogTxtName

$txtContent = @()
foreach ($m in ($masterLogData.Meetings | Sort-Object EventDate -Descending)) {
    $txtContent += "MEETING ID: $($m.MeetingId)"
    $txtContent += "SUBJECT: $($m.Subject)"
    $txtContent += "ORGANISER: $($m.Organiser)"
    $txtContent += "EVENT DATE: $($m.EventDate)"
    $txtContent += "TYPE: $($m.Type)"
    $txtContent += "PRIORITY: $($m.Priority)"
    $txtContent += "CLASSIFICATION: $($m.Classification)"
    $txtContent += "CLASSIFICATION_CONFIDENCE: $($m.ClassificationConfidence)"
    $txtContent += "CLASSIFICATION_SOURCE: $($m.ClassificationSource)"
    $txtContent += "STATUS: $($m.Status)"
    $txtContent += "AGENT STATE: $($m.AgentState)"
    $txtContent += "HAS TRANSCRIPT: $($m.HasTranscript)"
    $txtContent += "TRANSCRIPT FILE: $($m.TranscriptFile)"
    $txtContent += "LAST UPDATED: $($m.LastUpdated)"
    $txtContent += "" # Blank line separator
}

$txtContent | Out-File -FilePath $masterLogTxtLocalPath -Encoding utf8
Upload-FileToSharePoint -DriveId $driveId -FolderId $rootFolderId -FilePath $masterLogTxtLocalPath | Out-Null

Write-Host "Master Log (.json and .txt) updated and uploaded ✅"

Write-Host "Done ✅"

# Clean up local temporary files (for cloud maintenance)
if (Test-Path $outDir) {
    Remove-Item -Path $outDir -Recurse -Force
    Write-Host "Local temp folder cleaned up ✅"
}
