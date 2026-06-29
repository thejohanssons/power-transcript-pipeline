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
    [object]$ToDate,

    [Parameter(Mandatory=$false)]
    [switch]$ForceRerun,

    # VTT direct-file mode: bypass calendar lookup and process a local .vtt file directly
    [Parameter(Mandatory=$false)]
    [string]$VttFile,

    [Parameter(Mandatory=$false)]
    [string]$Participant
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

$PIPELINE_VERSION = "2.0"
$TAXONOMY_VERSION = "1.0"
$MAPPING_RULES_VERSION = "1.0"
$ROLES_CONFIG_VERSION = "1.0"
$SENTIMENT_RULES_VERSION = "1.0"

# --- EIP CONFIG LOADING ---
$configDir = Join-Path $PSScriptRoot "config"
$taxonomy = if (Test-Path (Join-Path $configDir "taxonomy.json")) { Get-Content -Path (Join-Path $configDir "taxonomy.json") | ConvertFrom-Json } else { @{} }
$mappingRules = if (Test-Path (Join-Path $configDir "mapping_rules.json")) { Get-Content -Path (Join-Path $configDir "mapping_rules.json") | ConvertFrom-Json } else { @{ Rules = @() } }
$rolesConfig = if (Test-Path (Join-Path $configDir "roles_config.json")) { Get-Content -Path (Join-Path $configDir "roles_config.json") | ConvertFrom-Json } else { @{ Mappings = @(); TypeMappings = @{} } }
$sentimentRules = if (Test-Path (Join-Path $configDir "sentiment_rules.json")) { Get-Content -Path (Join-Path $configDir "sentiment_rules.json") | ConvertFrom-Json } else { @{ Positive = @(); Negative = @(); ResolutionPriority = @() } }
$pipelineConfig = if (Test-Path (Join-Path $PSScriptRoot "pipeline_config.json")) { Get-Content -Path (Join-Path $PSScriptRoot "pipeline_config.json") | ConvertFrom-Json } else { @{ enable_stable_topic_classification = $false } }
$peopleConfigPath = Join-Path $configDir "people_config.json"
$peopleConfig = if (Test-Path $peopleConfigPath) { Get-Content -Path $peopleConfigPath | ConvertFrom-Json } else { $null }
if ($peopleConfig) { Write-Host "People config loaded ($($peopleConfig.people.Count) people) ✅" } else { Write-Warning "people_config.json not found — people intelligence disabled" }

# =========================
# VTT HELPER: Strip WebVTT timestamps and cue markers, return clean transcript text
# =========================
function ConvertFrom-Vtt {
    param([string]$VttContent)

    $lines = $VttContent -split "`r?`n"
    $output = [System.Collections.Generic.List[string]]::new()
    $lastSpeaker = $null

    foreach ($line in $lines) {
        $trimmed = $line.Trim()

        # Skip header, blank lines, cue IDs, and timestamp lines
        if ($trimmed -eq "WEBVTT") { continue }
        if ($trimmed -eq "") { continue }
        if ($trimmed -match "^\d+$") { continue }  # cue index number
        if ($trimmed -match "^\d{2}:\d{2}[:\d{2}]*\s*-->\s*\d{2}:\d{2}") { continue }  # timestamp arrow
        if ($trimmed -match "^NOTE\s") { continue }  # NOTE blocks
        if ($trimmed -match "^STYLE\s*$") { continue }  # STYLE blocks

        # Detect "Speaker Name: dialogue" format and deduplicate consecutive same-speaker lines
        if ($trimmed -match "^([^:]+):\s+(.+)$") {
            $speaker  = $matches[1].Trim()
            $dialogue = $matches[2].Trim()
            if ($speaker -eq $lastSpeaker) {
                # Append to previous line instead of repeating speaker name
                $idx = $output.Count - 1
                if ($idx -ge 0) { $output[$idx] = $output[$idx] + " " + $dialogue; continue }
            }
            $lastSpeaker = $speaker
            $output.Add("$speaker`: $dialogue")
        } else {
            # Plain dialogue line without speaker prefix
            $lastSpeaker = $null
            $output.Add($trimmed)
        }
    }

    return ($output -join "`n")
}

function Assign-Mode {
    param($type, $organiser, $topicRecords)

    # 1. Deterministic Rule based on Roles Config (Organiser)
    $roleMatch = $rolesConfig.Mappings | Where-Object { $_.Email -eq $organiser }
    if ($roleMatch) {
        return @{ mode = $roleMatch.DefaultMode; source = "config_rule"; confidence = "High" }
    }

    # 2. Deterministic Rule based on Meeting Type
    if ($rolesConfig.TypeMappings.$type) {
        return @{ mode = $rolesConfig.TypeMappings.$type; source = "config_rule"; confidence = "High" }
    }

    # Task 5.1: Smart Mode Switch for "Work" meetings
    if ($type -eq "Work" -and $topicRecords) {
        $hasProductTopics = $topicRecords | Where-Object { $_.Domain -eq "Product" -or $_.Domain -eq "Execution" }
        if ($hasProductTopics) {
            return @{ mode = "CPO"; source = "smart_rule"; confidence = "Medium" }
        }
    }

    # Fallback
    return @{ mode = "CEO"; source = "default_fallback"; confidence = "Low" }
}

function Get-TopicSentiment {
    param($topicText)
    $txt = $topicText.ToLower()
    
    $isPos = $false
    $isNeg = $false

    foreach ($p in $sentimentRules.Positive) { if ($txt -match "\b$([regex]::Escape($p.ToLower()))\b") { $isPos = $true } }
    foreach ($n in $sentimentRules.Negative) { if ($txt -match "\b$([regex]::Escape($n.ToLower()))\b") { $isNeg = $true } }
    
    # Resolution Priority Logic (e.g., "fixed", "shipped")
    foreach ($r in $sentimentRules.ResolutionPriority) {
        if ($txt -match "\b$([regex]::Escape($r.ToLower()))\b") {
            return @{ Signal = "Positive"; Trajectory = "Improving" }
        }
    }

    if ($isPos -and -not $isNeg) { return @{ Signal = "Positive"; Trajectory = "Improving" } }
    if ($isNeg) { return @{ Signal = "Negative"; Trajectory = "Declining" } }
    
    return @{ Signal = "Neutral"; Trajectory = "Stable" }
}

function Classify-Topic {
    param($topicText)

    $cleanText = $topicText.ToLower()
    $bestMatch = $null
    $maxDensity = 0.0

    foreach ($rule in $mappingRules.Rules) {
        $hits = 0
        foreach ($keyword in $rule.Keywords) {
            $pattern = "\b" + [regex]::Escape($keyword.ToLower()) + "\b"
            if ($cleanText -match $pattern) { $hits++ }
        }

        if ($hits -gt 0) {
            # Basic density score (hits relative to keywords available)
            # This helps differentiate between topics with many keywords vs few
            $density = $hits / $rule.Keywords.Count
            if ($density -gt $maxDensity) {
                $maxDensity = $density
                $bestMatch = $rule.TopicId
            }
        }
    }

    if (-not $bestMatch) {
        # Task 2.2: Best-fit fallback logic
        # Fallback to Strategy (T15) if no keywords match, 
        # as it is the safest catch-all for executive discussion
        $bestMatch = "T15"
    }

    $topicInfo = $taxonomy.Topics.$bestMatch

    $contextHints = @()
    $ruleMatch = $mappingRules.Rules | Where-Object { $_.TopicId -eq $bestMatch } | Select-Object -First 1
    if ($ruleMatch -and $ruleMatch.PSObject.Properties.Name -contains 'CategoryHints' -and $ruleMatch.CategoryHints) {
        $contextHints = @($ruleMatch.CategoryHints)
    }

    return @{
        TopicId        = $bestMatch
        TopicName      = $topicInfo.Name
        Domain         = if ($topicInfo.PSObject.Properties.Name -contains 'Domain') { $topicInfo.Domain } else { $null }
        CategoryHints  = $contextHints
        Score          = $maxDensity
    }
}

function Select-Category {
    param(
        $CandidateCategories,
        [string]$SectionName,
        [string]$Signal,
        [string]$Trajectory,
        [string]$Label,
        [string]$Content
    )

    if (-not $CandidateCategories -or $CandidateCategories.Count -eq 0) { return $null }
    if ($CandidateCategories.Count -eq 1) { return $CandidateCategories[0] }

    $scores = @{}
    foreach ($c in $CandidateCategories) { $scores[$c] = 0 }

    $section = ($SectionName | ForEach-Object { $_.ToLower() })
    $labelText = "$Label`n$Content".ToLower()

    # 1. Section location (primary signal)
    switch -Regex ($section) {
        '^signals$' {
            if ($scores.ContainsKey('Opportunity')) { $scores['Opportunity'] += 2 }
            if ($scores.ContainsKey('Problem'))     { $scores['Problem'] += 2 }
            if ($scores.ContainsKey('Risk'))        { $scores['Risk'] += 2 }
        }
        '^decisions$' {
            if ($scores.ContainsKey('Governance'))  { $scores['Governance'] += 5 }
            if ($scores.ContainsKey('Strategy'))    { $scores['Strategy'] += 1 }
            if ($scores.ContainsKey('Execution'))   { $scores['Execution'] -= 1 }
        }
        '^actions$' {
            if ($scores.ContainsKey('Execution'))   { $scores['Execution'] += 4 }
        }
        '^next direction$' {
            if ($scores.ContainsKey('Strategy'))    { $scores['Strategy'] += 5 }
            if ($scores.ContainsKey('Execution'))   { $scores['Execution'] -= 1 }
        }
        '^risks / issues$' {
            if ($scores.ContainsKey('Risk'))        { $scores['Risk'] += 4 }
            if ($scores.ContainsKey('Problem'))     { $scores['Problem'] += 2 }
        }
        '^implications$' {
            if ($scores.ContainsKey('Strategy'))    { $scores['Strategy'] += 2 }
            if ($scores.ContainsKey('Risk'))        { $scores['Risk'] += 1 }
        }
        '^alignment$' {
            if ($scores.ContainsKey('Governance'))  { $scores['Governance'] += 2 }
            if ($scores.ContainsKey('Strategy'))    { $scores['Strategy'] += 2 }
        }
        '^trend / trajectory$' {
            if ($scores.ContainsKey('Learning'))    { $scores['Learning'] += 2 }
            if ($scores.ContainsKey('Strategy'))    { $scores['Strategy'] += 1 }
        }
    }

    # 2. Signal / trajectory (secondary signal)
    if ($Signal -eq 'Negative') {
        if ($scores.ContainsKey('Problem')) { $scores['Problem'] += 2 }
        if ($scores.ContainsKey('Risk'))    { $scores['Risk'] += 2 }
    }
    if ($Signal -eq 'Positive') {
        if ($scores.ContainsKey('Opportunity')) { $scores['Opportunity'] += 2 }
    }
    if ($Trajectory -eq 'Improving') {
        if ($scores.ContainsKey('Opportunity')) { $scores['Opportunity'] += 1 }
        if ($scores.ContainsKey('Learning'))    { $scores['Learning'] += 1 }
    }
    if ($Trajectory -eq 'Declining') {
        if ($scores.ContainsKey('Risk'))        { $scores['Risk'] += 1 }
        if ($scores.ContainsKey('Problem'))     { $scores['Problem'] += 1 }
    }

    # 3. Wording cues (supporting signal)
    if ($labelText -match 'blocked|delay|constraint|stalled|dependency|issue|problem|failure') {
        if ($scores.ContainsKey('Risk'))    { $scores['Risk'] += 2 }
        if ($scores.ContainsKey('Problem')) { $scores['Problem'] += 2 }
    }
    if ($labelText -match 'decision|approve|owner|governance|policy|compliance') {
        if ($scores.ContainsKey('Governance')) { $scores['Governance'] += 2 }
    }
    if ($labelText -match 'deliver|execute|implement|regression|build|milestone|rollout') {
        if ($scores.ContainsKey('Execution')) { $scores['Execution'] += 2 }
    }
    if ($labelText -match 'strategy|direction|priority|objective|alignment|positioning') {
        if ($scores.ContainsKey('Strategy')) { $scores['Strategy'] += 2 }
    }
    if ($labelText -match 'feedback|insight|learn|confidence|unknown') {
        if ($scores.ContainsKey('Learning')) { $scores['Learning'] += 2 }
    }
    if ($labelText -match 'growth|upside|opportunity|expansion|market fit|tam') {
        if ($scores.ContainsKey('Opportunity')) { $scores['Opportunity'] += 2 }
    }

    # Choose highest-scoring candidate; first in candidate order wins ties
    $best = $CandidateCategories[0]
    $bestScore = $scores[$best]
    foreach ($c in $CandidateCategories) {
        if ($scores[$c] -gt $bestScore) {
            $best = $c
            $bestScore = $scores[$c]
        }
    }
    return $best
}

function Enrich-Summary {
    param($summaryText, $meetingId, $historyRecords)

    if (-not $summaryText) { return @{ Summary = $null; Records = @() } }

    $sections = [regex]::Split($summaryText, '(?m)^\d+\.\s+')
    if ($sections.Count -le 1) { return @{ Summary = $summaryText; Records = @() } } 

    $sectionNames = @("Topics / Context", "Signals", "Decisions", "Actions", "Next Direction", "Risks / Issues", "Implications", "Alignment", "Trend / Trajectory")
    
    # --- PHASE 1: PARSING SECTIONS 2-9 ---
    $statementObjects = @()
    for ($sectionIndex = 2; $sectionIndex -lt $sections.Count; $sectionIndex++) {
        $sectionBody = $sections[$sectionIndex]
        if (-not $sectionBody.Trim()) { continue }
        $sectionName = if ($sectionIndex -le $sectionNames.Count) { $sectionNames[$sectionIndex - 1] } else { "Section $sectionIndex" }

        $defaultType = switch ($sectionName) {
            'Signals' { 'Status Update' }
            'Decisions' { 'Decision' }
            'Actions' { 'Action' }
            'Next Direction' { 'Next Direction' }
            'Risks / Issues' { 'Risk' }
            default { 'Discussion' }
        }

        $currentSubtype = $null
        foreach ($line in ($sectionBody -split "`n")) {
            $t = $line.Trim()
            if (-not $t) { continue }
            if ($t -match '^[-*]\s*(Positive|Negative|Unknowns|Decision|Rationale|Action|Owner|Deadline|Product|Delivery|Quality|Overall direction|Justification|Gaps / inconsistencies|Known risks|Emerging concerns):\s*$') {
                $currentSubtype = $matches[1]
                continue
            }
            if ($t -match '^[-*]\s+(.*)$') {
                $statementObjects += [pscustomobject]@{
                    SectionName = $sectionName
                    StatementType = $defaultType
                    StatementSubtype = $currentSubtype
                    Text = $matches[1].Trim()
                }
            }
        }
    }

    # --- PHASE 2: PARSING TOPIC REGISTRY (SECTION 1) ---
    $topicRecordsMap = @{}
    $topicSection = $sections[1]
    $blocks = [regex]::Split($topicSection, '(?m)^### Topic:\s+')
    
    foreach ($block in $blocks) {
        if (-not $block.Trim() -or $block -match '^\d+\.\s+') { continue }
        
        $lines = $block -split "`n"
        $label = $lines[0].Trim()
        $bullets = ($lines | Select-Object -Skip 1 | Where-Object { $_.Trim() -match '^\s*-\s+' }) -join "`n"
        if (-not $bullets.Trim()) { continue }

        $cls = & "Classify-Topic" ($label + "`n" + $bullets)
        
        # Aggregate Signal
        $posCount = 0; $negCount = 0
        foreach ($line in ($bullets -split "`n")) {
            if ($line -match "^\s*-\s+(.+)") {
                $sent = & "Get-TopicSentiment" $matches[1]
                if ($sent.Signal -eq "Positive") { $posCount++ }
                if ($sent.Signal -eq "Negative") { $negCount++ }
            }
        }
        $finalSignal = "Neutral"; $finalTrajectory = "Stable"
        if ($posCount -gt 0 -and $negCount -gt 0) { $finalSignal = "Mixed"; $finalTrajectory = "Stabilising / Improving" }
        elseif ($negCount -gt $posCount) { $finalSignal = "Negative"; $finalTrajectory = "Declining" }
        elseif ($posCount -gt $negCount) { $finalSignal = "Positive"; $finalTrajectory = "Improving" }

        # --- 3D SELECTION ---
        $selectedCategory = Select-Category -CandidateCategories $cls.CategoryHints -SectionName 'Topics / Context' -Signal $finalSignal -Trajectory $finalTrajectory -Label $label -Content $bullets
        $selectedContextType = 'Discussion' # Topic Registry default

        Write-Host "  [3D DIAG] Topic=$($cls.TopicId) / $($cls.TopicName) | Section=Topics / Context | Category=$selectedCategory | ContextType=$selectedContextType"

        $topicRecordsMap[$cls.TopicId] = [pscustomobject]@{
            RecordId      = $meetingId + "_" + $cls.TopicId
            TopicId       = $cls.TopicId
            TopicName     = $cls.TopicName
            DisplayLabel  = $label
            Category      = $selectedCategory
            ContextType   = $selectedContextType
            CategoryHints = $cls.CategoryHints
            Content       = $bullets
            Signal        = $finalSignal
            Trajectory    = $finalTrajectory
        }
    }

    # --- PHASE 3: ASSEMBLY ---
    $newTopicSection = ""
    foreach ($tid in ($topicRecordsMap.Keys | Sort-Object)) {
        $rec = $topicRecordsMap[$tid]
        $newTopicSection += "### Topic: " + $rec.DisplayLabel + "`n"
        $newTopicSection += "CATEGORY: " + $rec.Category + "`n"
        $newTopicSection += "CONTEXT_TYPE: " + $rec.ContextType + "`n"
        $newTopicSection += "TOPIC_ID: " + $rec.TopicId + "`n"
        $newTopicSection += "CANONICAL_TOPIC: " + $rec.TopicName + "`n"
        $newTopicSection += "SIGNAL: " + $rec.Signal + "`n"
        $newTopicSection += "TRAJECTORY: " + $rec.Trajectory + "`n"
        $newTopicSection += "Content:`n" + $rec.Content.Trim() + "`n`n"
    }

    $finalSummary = "1. Topics / Context`n" + $newTopicSection.Trim() + "`n`n"
    
    # Rebuild Sections 2-9
    for ($i = 2; $i -le 9; $i++) {
        $name = $sectionNames[$i-1]
        $stmts = $statementObjects | Where-Object { $_.SectionName -eq $name }
        if (-not $stmts) { continue }

        $finalSummary += "$i. $name`n`n"
        $groups = $stmts | Group-Object StatementSubtype
        foreach ($group in $groups) {
            $sublabel = if ($group.Name) { $group.Name } else { $stmts[0].StatementType }
            $finalSummary += "- ${sublabel}:`n"
            foreach ($s in $group.Group) {
                $sCls = & "Classify-Topic" $s.Text
                $finalSummary += "  - [$($sCls.TopicId)] $($s.Text)`n"
            }
            $finalSummary += "`n"
        }
    }

    # Trends & Persistence
    $topicRecords = $topicRecordsMap.Values | ForEach-Object { $_ }
    $trends = & "Get-StalledWork" $topicRecords $historyRecords
    if ($trends.Count -gt 0) {
        $finalSummary += "## TOPIC TRENDS & PERSISTENCE`n"
        foreach ($t in $trends) {
            $status = if ($t.IsStalled) { "Stalled" } else { $t.TrendType }
            $finalSummary += "- $($t.TopicName): $status (Last seen: $($t.LastSeen))`n"
        }
        $finalSummary += "`n"
    }

    # Record Footer
    $finalSummary += "## Topic Records (Internal)`n`n"
    foreach ($rec in $topicRecords) {
        $finalSummary += "[Record: $($rec.RecordId)]`n"
        $finalSummary += "CATEGORY: $($rec.Category)`n"
        $finalSummary += "CONTEXT_TYPE: $($rec.ContextType)`n"
        $finalSummary += "TOPIC_ID: $($rec.TopicId)`n"
        $finalSummary += "CANONICAL_TOPIC: $($rec.TopicName)`n"
        $finalSummary += "DISPLAY_LABEL: $($rec.DisplayLabel)`n"
        $finalSummary += "SIGNAL: $($rec.Signal)`n"
        $finalSummary += "TRAJECTORY: $($rec.Trajectory)`n"
        $finalSummary += "CONTENT:`n$($rec.Content.Trim())`n`n"
    }

    return @{ Summary = $finalSummary; Records = $topicRecords; Trends = $trends }
}

function Get-StalledWork {
    param($currentRecords, $historyRecords)

    if (-not $historyRecords -or $historyRecords.Count -eq 0) { return @() }

    $results = @()
    foreach ($curr in $currentRecords) {
        $pastMatches = $historyRecords | Where-Object { $_.TopicId -eq $curr.TopicId } | Sort-Object EventDate -Descending
        
        if ($pastMatches -and $pastMatches.Count -gt 0) {
            $lastMatch = $pastMatches[0]
            
            # 1. Detect Trajectory Shift
            $trendType = "Persistent"
            if ($curr.Signal -eq "Positive" -and $lastMatch.Signal -eq "Negative") { $trendType = "Improving" }
            if ($curr.Signal -eq "Negative" -and $lastMatch.Signal -eq "Positive") { $trendType = "Declining" }

            # 2. Add to results
            $results += [pscustomobject]@{
                TopicId     = $curr.TopicId
                TopicName   = $curr.TopicName
                TrendType   = $trendType
                CurrentText = $curr.Content
                LastSeen    = $lastMatch.EventDate
                LastText    = $lastMatch.Content
                IsStalled   = ($curr.Content -eq $lastMatch.Content)
            }
        }
    }
    return $results
}

# =========================
# LLM HELPER: Split transcript into overlapping chunks
# =========================
function Split-TranscriptIntoChunks {
    param(
        [string]$Text,
        [int]$ChunkSize = 32000,
        [int]$Overlap   = 500
    )
    $chunks = @()
    $start  = 0
    while ($start -lt $Text.Length) {
        $end    = [Math]::Min($start + $ChunkSize, $Text.Length)
        $chunks += $Text.Substring($start, $end - $start)
        if ($end -eq $Text.Length) { break }
        $start  = $end - $Overlap
    }
    return $chunks
}

# =========================
# LLM HELPER: Single LLM call — returns raw content string or $null on failure
# =========================
function Invoke-LLM {
    param(
        [string]$SystemPrompt,
        [string]$UserContent,
        [string]$FullUri,
        [hashtable]$Headers,
        [string]$Model,
        [int]$MaxTokens = 16000
    )
    $body = @{
        model    = $Model
        messages = @(
            @{ role = "system"; content = $SystemPrompt },
            @{ role = "user";   content = $UserContent  }
        )
        temperature           = 0
        max_completion_tokens = $MaxTokens
    } | ConvertTo-Json -Depth 10

    try {
        $response     = Invoke-RestMethod -Method Post -Uri $FullUri -Headers $Headers -Body $body
        $finishReason = $response.choices[0].finish_reason
        if ($finishReason -ne "stop") {
            Write-Warning "  [LLM DIAG] finish_reason=$finishReason — response may be truncated"
        }
        return $response.choices[0].message.content
    } catch {
        Write-Warning "  [LLM] Call failed: $_"
        return $null
    }
}

# =========================
# LLM HELPER: Parse and sanitise JSON from LLM response
# =========================
function ConvertFrom-LLMJson {
    param([string]$RawContent)
    # Strip markdown code fences
    $clean = $RawContent -replace "(?s)^\s*``````(?:json)?\s*", "" -replace "(?s)\s*``````\s*$", ""
    # Extract outermost JSON object
    if ($clean -match "(?s)(\{.*\})") { $clean = $matches[1] }
    try {
        return $clean | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Recover-LLMResult {
    param([string]$RawContent)

    $result = @{
        classification = $null
        confidence     = $null
        summary        = $null
    }

    if ($RawContent -match '"classification"\s*:\s*"([^"]+)"') {
        $result.classification = $matches[1]
    }

    if ($RawContent -match '"confidence"\s*:\s*"([^"]+)"') {
        $result.confidence = $matches[1]
    }

    # Aggressive salvage: find everything after the opening quote of the summary
    # Handles unterminated strings, unescaped quotes, and truncation.
    if ($RawContent -match '(?s)"summary"\s*:\s*"(.*)$') {
        $summary = $matches[1]
        
        # 1. Strip trailing JSON fragments and markdown fences
        $summary = $summary -replace '(?s)"\s*\}?.*?$', '' 
        $summary = $summary -replace '```json', ''
        $summary = $summary -replace '```', ''
        
        # 2. Convert escaped sequences to real characters
        $summary = $summary -replace '\\n', "`n"
        $summary = $summary -replace '\\r', ""
        $summary = $summary -replace '\\"', '"'
        $summary = $summary -replace '\\t', "`t"
        
        $result.summary = $summary.Trim()
    }

    return $result
}

# =========================
# PEOPLE INTELLIGENCE: Resolve speaker names against people_config.json
# =========================
function Resolve-People {
    param(
        [string[]]$Names,
        [object]$PeopleConfig
    )
    if (-not $PeopleConfig -or -not $Names -or $Names.Count -eq 0) { return @() }

    $resolved   = [System.Collections.Generic.List[object]]::new()
    $unresolved = [System.Collections.Generic.List[string]]::new()

    foreach ($name in ($Names | Where-Object { $_ -and $_.Trim() -ne "" } | Select-Object -Unique)) {
        $nameLower = $name.Trim().ToLower()
        $match = $PeopleConfig.people | Where-Object {
            ($_.canonical_name.ToLower() -eq $nameLower) -or
            ($_.aliases | Where-Object { $_.ToLower() -eq $nameLower })
        } | Select-Object -First 1

        if ($match) {
            $resolved.Add($match)
        } else {
            $unresolved.Add($name.Trim())
        }
    }

    if ($unresolved.Count -gt 0) {
        $recPath = Join-Path $PSScriptRoot "config/people_recommendations.json"
        $existing = if (Test-Path $recPath) { Get-Content $recPath | ConvertFrom-Json } else { [PSCustomObject]@{ unresolved = @() } }
        foreach ($u in $unresolved) {
            $found = $existing.unresolved | Where-Object { $_.name -eq $u }
            if (-not $found) {
                $existing.unresolved += [PSCustomObject]@{ name = $u; first_seen = (Get-Date -Format "yyyy-MM-dd"); count = 1 }
            } else {
                $found.count++
            }
        }
        $existing | ConvertTo-Json -Depth 5 | Set-Content -Path $recPath -Encoding utf8
        Write-Warning "  [PEOPLE] Unresolved names: $($unresolved -join ', ') — flagged to people_recommendations.json"
    }

    return $resolved.ToArray()
}

# =========================
# PEOPLE INTELLIGENCE: Extract speaker names from transcript text
# Returns array of distinct first-word speaker names found before ": " pattern
# =========================
function Get-TranscriptSpeakers {
    param([string]$TranscriptText)
    $speakers = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($line in ($TranscriptText -split "`n")) {
        if ($line -match "^([A-Z][a-zA-Z\s\-\.]{1,40}):\s") {
            $null = $speakers.Add($matches[1].Trim())
        }
    }
    return @($speakers)
}

# =========================
# PEOPLE INTELLIGENCE: LLM pass — extract per-person attribution
# =========================
function Get-PeopleIntelligence {
    param(
        [string]$TranscriptText,
        [string]$ChunkSummaries,
        [object[]]$ResolvedPeople,
        [object[]]$TopicRecords,
        [string]$MeetingId,
        [string]$Subject,
        [string]$FullUri,
        [hashtable]$Headers,
        [string]$Model
    )

    if (-not $ResolvedPeople -or $ResolvedPeople.Count -eq 0) { return $null }

    $peopleLines = $ResolvedPeople | ForEach-Object {
        "- $($_.canonical_name) | $($_.role) | $($_.org_id -replace 'org_','') | seniority=$($_.seniority_level) | authority=$($_.decision_authority -join ',')"
    }
    $peopleContext = $peopleLines -join "`n"

    $topicLines = if ($TopicRecords -and $TopicRecords.Count -gt 0) {
        ($TopicRecords | Group-Object TopicId | ForEach-Object { "$($_.Name): $($_.Group[0].TopicName)" }) -join ", "
    } else { "No topics detected" }

    $systemPromptLines = @(
        "You are an expert at extracting structured people intelligence from meeting transcripts and summaries.",
        "",
        "For each person listed, analyse the meeting content and produce a structured record.",
        "Use ONLY evidence from the transcript and summaries. Do not invent or infer beyond what is stated.",
        "",
        "For each person output this structure (repeat for each person, separated by ---):",
        "",
        "PERSON: [canonical name]",
        "ATTENDANCE: [Present | Discussed - not present | Expected - not present]",
        "EVIDENCE: [First-person | Third-person only]",
        "",
        "CONTRIBUTIONS:",
        "- [bullet per distinct contribution, or None observed]",
        "",
        "ACTIONS ASSIGNED TO THIS PERSON:",
        "- [action] [<- assigned by Name | TopicID | due date or no due date]",
        "- (or None)",
        "",
        "ACTIONS ASSIGNED BY THIS PERSON:",
        "- [action] [-> assigned to Name | TopicID | due date or no due date]",
        "- (or None)",
        "",
        "DECISIONS OWNED:",
        "- [decision] [TopicID]",
        "- (or None)",
        "",
        "RISKS RAISED:",
        "- [risk] [TopicID | HIGH/MEDIUM/LOW]",
        "- (or None)",
        "",
        "TOPICS REFERENCED: [comma-separated TopicIDs]",
        "STANCE: [TopicID=word e.g. T08=concerned | or None]",
        "",
        "SUMMARY: [one sentence - primary focus or contribution in this meeting]",
        "",
        "---",
        "",
        "Rules:",
        "- If ATTENDANCE is Discussed - not present or Expected - not present: EVIDENCE must be Third-person only. Leave CONTRIBUTIONS, DECISIONS OWNED, RISKS RAISED, STANCE as None.",
        "- Do not fabricate names, roles, or actions.",
        "- Use exact canonical names provided.",
        "- Topic IDs must come from the provided list only."
    )
    $systemPrompt = $systemPromptLines -join "`n"

    $safeTranscript = $TranscriptText.Substring(0, [Math]::Min($TranscriptText.Length, 40000))

    $userLines = @(
        "MEETING: $Subject ($MeetingId)",
        "",
        "KNOWN TOPIC IDs FOR THIS MEETING:",
        $topicLines,
        "",
        "KNOWN PARTICIPANTS (resolve against these only):",
        $peopleContext,
        "",
        "MEETING TRANSCRIPT SUMMARIES:",
        $ChunkSummaries,
        "",
        "FULL TRANSCRIPT (for evidence):",
        $safeTranscript
    )
    $userContent = $userLines -join "`n"

    Write-Host "  [PEOPLE] Running people intelligence extraction ($($ResolvedPeople.Count) people)..."
    $raw = Invoke-LLM -SystemPrompt $systemPrompt -UserContent $userContent `
                      -FullUri $FullUri -Headers $Headers -Model $Model -MaxTokens 8000
    return $raw
}

# =========================
# PEOPLE INTELLIGENCE: Format LLM output into *-People.txt file content
# =========================
function Format-PeopleFile {
    param(
        [string]$LLMOutput,
        [string]$MeetingId,
        [string]$Subject,
        [string]$EventDate,
        [string]$PipelineVersion
    )
    $headerLines = @(
        "MEETING ID: $MeetingId",
        "SUBJECT: $Subject",
        "EVENT DATE: $EventDate",
        "PIPELINE_VERSION: $PipelineVersion",
        "GENERATED: $([System.DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ssZ'))",
        "TYPE: People Intelligence",
        "---",
        ""
    )
    return ($headerLines -join "`n") + $LLMOutput.Trim()
}

# =========================
# PEOPLE INTELLIGENCE: Update master_people_log data structure
# =========================
function Update-MasterPeopleLog {
    param(
        [object]$MasterPeopleLogData,
        [string]$MeetingId,
        [string]$Subject,
        [string]$EventDate,
        [string]$PeopleFileUrl,
        [object[]]$ResolvedPeople
    )
    $now   = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
    $entry = [PSCustomObject]@{
        MeetingId      = $MeetingId
        Subject        = $Subject
        EventDate      = $EventDate
        PeopleFile     = $PeopleFileUrl
        PeopleResolved = @($ResolvedPeople | ForEach-Object { $_.id })
        GeneratedAt    = $now
    }
    $existing = $MasterPeopleLogData.Entries | Where-Object { $_.MeetingId -eq $MeetingId }
    if ($existing) {
        $idx = [array]::IndexOf($MasterPeopleLogData.Entries, $existing)
        $MasterPeopleLogData.Entries[$idx] = $entry
    } else {
        $MasterPeopleLogData.Entries += $entry
    }
    return $MasterPeopleLogData
}


function Get-MeetingClassification {
    param($type, $organiser, $transcriptContent)

    # --- Case 1: Transcript exists - Use LLM with map-reduce chunking ---
    if ($transcriptContent -and $rules.LLMConfig.Endpoint) {
        try {
            # --- Build shared LLM connection config ---
            $keySource     = if ($env:FOUNDRY_API_KEY) { "FOUNDRY_API_KEY" } elseif ($env:AZURE_OPENAI_API_KEY) { "AZURE_OPENAI_API_KEY" } else { "classification_rules.json" }
            $llmKey        = if ($env:FOUNDRY_API_KEY) { $env:FOUNDRY_API_KEY } elseif ($env:AZURE_OPENAI_API_KEY) { $env:AZURE_OPENAI_API_KEY } else { $rules.LLMConfig.ApiKey }
            $authMode      = if ($rules.LLMConfig.Endpoint -match "openai\.azure\.com") { "api-key" } else { "Bearer" }
            $llmHeaders    = if ($authMode -eq "api-key") {
                @{ "api-key" = $llmKey; "Content-Type" = "application/json" }
            } else {
                @{ "Authorization" = "Bearer $llmKey"; "Content-Type" = "application/json" }
            }
            $deploymentName = if ($rules.LLMConfig.DeploymentName) { $rules.LLMConfig.DeploymentName } else { $rules.LLMConfig.Model }
            $fullUri        = if ($rules.LLMConfig.Endpoint -match "openai\.azure\.com") {
                $base = $rules.LLMConfig.Endpoint -replace "/(openai/)?v\d[^/]*/?$", "" -replace "/$", ""
                "$base/openai/deployments/$deploymentName/chat/completions?api-version=2024-02-15-preview"
            } elseif ($rules.LLMConfig.Endpoint -match "/v1/?$") {
                "$($rules.LLMConfig.Endpoint -replace '/$', '')/chat/completions"
            } else {
                "$($rules.LLMConfig.Endpoint -replace '/$', '')/chat/completions"
            }

            Write-Host "  [LLM DIAG] Endpoint: $fullUri"
            Write-Host "  [LLM DIAG] Model: $($rules.LLMConfig.Model)"
            Write-Host "  [LLM DIAG] Key source: $keySource"
            Write-Host "  [LLM DIAG] Auth mode: $authMode"

            # --- Chunk config (configurable via LLMConfig, with safe defaults) ---
            $chunkSize = if ($rules.LLMConfig.ChunkSize) { [int]$rules.LLMConfig.ChunkSize } else { 32000 }
            $overlap   = if ($rules.LLMConfig.ChunkOverlap) { [int]$rules.LLMConfig.ChunkOverlap } else { 500 }

            # --- Split transcript into chunks ---
            $chunks = Split-TranscriptIntoChunks -Text $transcriptContent -ChunkSize $chunkSize -Overlap $overlap
            Write-Host "  [LLM DIAG] Chunks: $($chunks.Count) (chunk size: $chunkSize chars)"

            # --- PASS 1: Summarise each chunk (lightweight prompt) ---
            $chunkSummaryPrompt = @"
You are summarising a section of a meeting transcript.
Extract key points, decisions, actions, risks, and topics discussed in this section.
Be concise but complete. Use plain text bullet points. Do not add headings or JSON.
"@
            $chunkSummaries = @()
            $chunkNum = 0
            foreach ($chunk in $chunks) {
                $chunkNum++
                Write-Host "  [LLM DIAG] Processing chunk $chunkNum/$($chunks.Count)..."
                $raw = Invoke-LLM -SystemPrompt $chunkSummaryPrompt `
                                  -UserContent "Transcript section $chunkNum/$($chunks.Count):`n`n$chunk" `
                                  -FullUri $fullUri -Headers $llmHeaders `
                                  -Model $rules.LLMConfig.Model -MaxTokens 4000
                if ($raw) { $chunkSummaries += "### Section $chunkNum`n$raw" }
            }

            if ($chunkSummaries.Count -eq 0) {
                Write-Warning "LLM Analysis failed: all chunk passes returned empty."
            } else {
                # --- PASS 2: Synthesise all chunk summaries into final structured JSON ---
                $combinedSummaries = $chunkSummaries -join "`n`n"
                $userContent = "Meeting transcript summaries (from $($chunks.Count) sections):`n`n$combinedSummaries"
                $rawContent  = Invoke-LLM -SystemPrompt $rules.LLMConfig.Prompt `
                                          -UserContent $userContent `
                                          -FullUri $fullUri -Headers $llmHeaders `
                                          -Model $rules.LLMConfig.Model -MaxTokens 16000

                if ($rawContent) {
                    $resultJson = ConvertFrom-LLMJson -RawContent $rawContent
                    if ($resultJson) {
                        return @{
                            classification = $resultJson.classification
                            confidence     = $resultJson.confidence
                            summary        = $resultJson.summary
                            source         = "llm"
                        }
                    }
                    # JSON parse failed — try regex recovery
                    $recovered = Recover-LLMResult -RawContent $rawContent
                    if ($recovered.summary) {
                        Write-Warning "LLM Analysis returned malformed JSON; using recovered summary fallback."
                        return @{
                            classification = if ($recovered.classification) { $recovered.classification } else { "CEO" }
                            confidence     = if ($recovered.confidence) { $recovered.confidence } else { "Low" }
                            summary        = $recovered.summary
                            source         = "llm_recovered"
                        }
                    }
                }
                Write-Warning "LLM Analysis failed: synthesis pass returned no usable content."
            }
        } catch {
            Write-Warning "LLM Analysis failed: $_"
        }
    }

    # --- Case 2: No transcript - Use heuristics ---

    # 1. TYPE (fast heuristic)
    if ($rules.TypeRules.CEO -contains $type) {
        return @{ classification = "CEO"; confidence = "High"; source = "rule"; summary = $null }
    }
    if ($rules.TypeRules.CPO -contains $type) {
        return @{ classification = "CPO"; confidence = "High"; source = "rule"; summary = $null }
    }

    # 2. ORGANISER (disambiguation)
    if ($rules.OrganiserRules.CEO -contains $organiser) {
        return @{ classification = "CEO"; confidence = "High"; source = "rule"; summary = $null }
    }
    if ($rules.OrganiserRules.CPO -contains $organiser) {
        return @{ classification = "CPO"; confidence = "High"; source = "rule"; summary = $null }
    }

    # Default if everything fails
    return @{ classification = "CEO"; confidence = "Low"; source = "default"; summary = $null }
}

# =========================
# --- CONFLUENCE UTILITIES ---

function Convert-SummaryToConfluenceHtml {
    param($SummaryText, $Subject, $MeetingId, $EventDate, $Organiser)

    $html = ""
    $lines = $SummaryText -split "`n"

    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if (-not $trimmed) {
            $html += "<br />"
            continue
        }

        # H2: numbered main sections like 1. Topics / Context, 2. Signals, ... 9. Trend / Trajectory
        if ($trimmed -match '^\d+\.\s+.*') {
            $html += "<h2>$trimmed</h2>"
            continue
        }

        # H3: topic headings
        if ($trimmed -match '^## Topic: (.*)') {
            $html += "<h3>Topic: $($matches[1])</h3>"
            continue
        }

        # H3: subsection labels inside executive sections
        if ($trimmed -match '^(Positive|Negative|Unknowns|Decision|Rationale|Action|Owner|Deadline|Product|Delivery|Quality|Overall direction|Justification|Gaps / inconsistencies|Known risks|Emerging concerns):') {
            $html += "<h3>$trimmed</h3>"
            continue
        }

        # SIGNAL with lozenge, but same paragraph metadata style
        if ($trimmed -match '^SIGNAL: (.*)') {
            $val = $matches[1].Trim()
            $color = switch ($val) {
                'Positive' { 'green' }
                'Negative' { 'red' }
                'Mixed'    { 'yellow' }
                default    { 'neutral' }
            }
            $html += "<p><strong>SIGNAL:</strong> <span data-type='status' data-color='$color'>$val</span></p>"
            continue
        }

        # Metadata lines
        if ($trimmed -match '^(DOMAIN|TOPIC_ID|CANONICAL_TOPIC|TRAJECTORY|DISPLAY_LABEL|MEETING ID|SUBJECT|ORGANISER|EVENT DATE|TYPE|PRIORITY|MODE|MODE_SOURCE|MODE_CONFIDENCE|PIPELINE_VERSION|TAXONOMY_VERSION|MAPPING_RULES_VERSION|ROLES_CONFIG_VERSION|SENTIMENT_RULES_VERSION|PROCESSING_TIMESTAMP|STATUS|BACK-LINK \(MASTER LOG\)): (.*)') {
            $html += "<p><strong>$($matches[1]):</strong> $($matches[2])</p>"
            continue
        }

        # Content label
        if ($trimmed -eq 'Content:') {
            $html += "<h3>Content:</h3>"
            continue
        }

        # Topic records section header must be H1
        if ($trimmed -match '^## Topic Records \(Internal\)') {
            $html += "<h1>## Topic Records (Internal)</h1>"
            continue
        }

        # Individual record block
        if ($trimmed -match '^\[Record: (.*)\]') {
            $html += "<h3>[Record: $($matches[1])]</h3>"
            continue
        }

        # CONTENT label in records block
        if ($trimmed -eq 'CONTENT:') {
            $html += "<h3>CONTENT:</h3>"
            continue
        }

        # Bullet lines
        if ($trimmed -match '^[-*]\s+(.*)') {
            $html += "<ul><li>$($matches[1])</li></ul>"
            continue
        }

        # Fallback plain paragraph
        $html += "<p>$trimmed</p>"
    }

    return $html
}

function Publish-SummaryToConfluence {
    param($HtmlContent, $Title, $SpaceKey, $ParentPageId)

    Write-Host "  [CONFLUENCE] Attempting to mirror summary: $Title"

    $config = $null; if (Test-Path (Join-Path $PSScriptRoot "pipeline_config.json")) { $config = Get-Content -Path (Join-Path $PSScriptRoot "pipeline_config.json") | ConvertFrom-Json }

    $user = if ($env:CONFLUENCE_USER) { $env:CONFLUENCE_USER } else { $config.confluence_user }
    $token = if ($env:CONFLUENCE_TOKEN) { $env:CONFLUENCE_TOKEN } else { $config.confluence_token }
    $baseUrl = if ($env:CONFLUENCE_BASE_URL) { $env:CONFLUENCE_BASE_URL } else { $config.confluence_base_url }
    
    if (-not $user -or -not $token -or -not $baseUrl) {
        Write-Warning "  [CONFLUENCE] Skipping: Missing CONFLUENCE credentials in environment or config."
        return $null
    }

    $pair = "$($user):$($token)"
    $encodedCreds = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($pair))
    $headers = @{ Authorization = "Basic $encodedCreds"; "Content-Type" = "application/json"; Accept = "application/json" }

    try {
        $spaceUrl = "$baseUrl/api/v2/spaces?keys=$SpaceKey"
        $spaceResponse = Invoke-RestMethod -Uri $spaceUrl -Headers $headers -Method Get
        $spaceId = $spaceResponse.results[0].id
        
        $body = @{ spaceId = $spaceId; status = "current"; title = $Title; parentId = $ParentPageId; body = @{ representation = "storage"; value = $HtmlContent } } | ConvertTo-Json -Depth 10

        $targetPage = $null
        try {
            $targetPage = Invoke-RestMethod -Uri "$baseUrl/api/v2/pages" -Headers $headers -Method Post -Body $body
            Write-Host "  [CONFLUENCE] Created new page: $($targetPage.id)"
        }
        catch {
            if ($_.Exception.Message -match "400" -or $_.Exception.Message -match "Already exists") {
                $searchUrl = "$baseUrl/api/v2/pages?spaceKey=$SpaceKey&title=$([uri]::EscapeDataString($Title))&limit=1"
                $existing = (Invoke-RestMethod -Uri $searchUrl -Headers $headers -Method Get).results[0]
                if ($existing) {
                    $updateBody = @{ id = $existing.id; status = "current"; title = $Title; spaceId = $spaceId; version = @{ number = $existing.version.number + 1 }; body = @{ representation = "storage"; value = $HtmlContent } } | ConvertTo-Json -Depth 10
                    $targetPage = Invoke-RestMethod -Uri "$baseUrl/api/v2/pages/$($existing.id)" -Headers $headers -Method Put -Body $updateBody
                    Write-Host "  [CONFLUENCE] Updated page to v$($targetPage.version.number)"
                }
            } else { throw $_.Exception }
        }

        if ($targetPage) {
            $webui = $targetPage._links.webui
            return "$($baseUrl.Replace('/wiki',''))/wiki$webui"
        }
    }
    catch { Write-Warning "  [CONFLUENCE] Mirror failed: $($_.Exception.Message)" }
    return $null
}

function Send-TeamsNotification {
    param($MessageBlock)

    $webhookUrl = $env:TEAMS_WEBHOOK_URL
    if (-not $webhookUrl) {
        if (Test-Path (Join-Path $PSScriptRoot "pipeline_config.json")) {
            $config = Get-Content -Path (Join-Path $PSScriptRoot "pipeline_config.json") | ConvertFrom-Json
            $webhookUrl = $config.teams_webhook_url
        }
    }
    
    if (-not $webhookUrl) { 
        Write-Output "  [TEAMS] Skip: No teams_webhook_url defined in environment or config."
        return 
    }

    # Unified Webhook payload
    $payload = @{
        "text" = "### Executive Intelligence Update`n$MessageBlock"
    } | ConvertTo-Json -Depth 10

    try {
        # Force TLS 1.2 for Teams compatibility
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $payload -ContentType "application/json"
    } catch {
        Write-Warning "  [TEAMS] Notification failed: $($_.Exception.Message). Ensure your webhook supports AdaptiveCards."
    }
}

$global:GraphTokenInfo = $null
$global:authHeader = $null

function Get-GraphToken {
    $body = @{
        client_id     = $clientId
        client_secret = $clientSecret
        scope         = "https://graph.microsoft.com/.default"
        grant_type    = "client_credentials"
    }
    $tokenResponse = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" -Body $body
    
    # Typically expires in 3600 seconds. Set expiration with 5 min safety margin.
    $expiresIn = if ($tokenResponse.expires_in) { $tokenResponse.expires_in } else { 3600 }
    $expiration = [DateTime]::Now.AddSeconds($expiresIn - 300) 
    
    return [PSCustomObject]@{
        Token      = $tokenResponse.access_token
        Expiration = $expiration
    }
}

function Ensure-GraphToken {
    if ($null -eq $global:GraphTokenInfo -or [DateTime]::Now -ge $global:GraphTokenInfo.Expiration) {
        $global:GraphTokenInfo = Get-GraphToken
        $global:authHeader = @{ Authorization = "Bearer $($global:GraphTokenInfo.Token)" }
        Write-Host "Microsoft Graph Session Refreshed ✅"
    }
}

# Initial Connection
Ensure-GraphToken
Write-Host "Connected to Microsoft Graph (REST) ✅"

# =========================
# HELPERS
# =========================

function Test-IsExternalTenant {
    param($JoinUrl, $InternalTenantId)
    if ($JoinUrl -match "Tid%22%3a%22([a-f0-9-]+)%22") {
        $tid = $matches[1]
        return ($tid -ne $InternalTenantId)
    }
    return $false
}

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
    
    # Ensure token is valid for upload
    Ensure-GraphToken
    
    $fileName = [System.IO.Path]::GetFileName($FilePath)
    $uploadUri = "https://graph.microsoft.com/v1.0/drives/$DriveId/items/$FolderId`:/$fileName`:/content"
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    
    $maxRetries = 3
    $retryCount = 0
    while ($retryCount -lt $maxRetries) {
        try {
            return Invoke-RestMethod -Method Put -Uri $uploadUri -Headers $authHeader -Body $bytes -ContentType "application/octet-stream"
        } catch {
            $retryCount++
            if ($retryCount -eq $maxRetries) { throw $_ }
            Write-Warning "  [UPLOAD] Failed (attempt $retryCount/$maxRetries). Retrying in 2s..."
            Start-Sleep -Seconds 2
        }
    }
}

function Get-MeetingLogId {
    param($EventDate, [string]$Subject)
    # Ensure date is treated as UTC to prevent local timezone offsets in the ID
    $utcDate = if ($EventDate -is [string]) { [DateTime]::Parse($EventDate).ToUniversalTime() } else { $EventDate.ToUniversalTime() }
    $datePart = $utcDate.ToString("yyyy-MM-dd_HHmm")
    $slugSubject = ($Subject -replace '[^a-zA-Z0-9]', '_').ToLower()
    return "$datePart`_$slugSubject"
}

function Get-StickyMasterLogValue {
    param($NewValue, $ExistingEntry, [string]$PropertyName)
    if ($NewValue) { return $NewValue }
    if (-not $ExistingEntry) { return $null }
    $existing = $ExistingEntry.$PropertyName
    if ($existing) { return $existing }
    return $null
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
# LOAD MASTER LOG (before processing — needed for history enrichment and merge)
# =========================

Write-Host "Loading existing Master Log..."
$masterLogFileName = "master_log.json"
$rootFolderId = Ensure-DriveFolder -DriveId $driveId -FolderPath $spTranscriptRootFolder
$masterLogData = @{ Meetings = @() }
try {
    $existingFileUri = "https://graph.microsoft.com/v1.0/drives/$driveId/items/$rootFolderId`:/$masterLogFileName"
    $existingFile = Invoke-RestMethod -Method Get -Uri $existingFileUri -Headers $authHeader

    $downloadUri = "https://graph.microsoft.com/v1.0/drives/$driveId/items/$($existingFile.id)/content"
    $rawMasterData = Invoke-RestMethod -Method Get -Uri $downloadUri -Headers $authHeader

    if ($rawMasterData.Meetings) {
        $masterLogData.Meetings = @($rawMasterData.Meetings)
    } elseif ($rawMasterData -is [array]) {
        $masterLogData.Meetings = @($rawMasterData)
    }
    Write-Host "Master Log loaded ($($masterLogData.Meetings.Count) meetings) ✅"
} catch {
    Write-Host "No existing Master Log found or could not parse. Starting fresh."
}

# Load master_people_log.json
$masterPeopleLogFileName = "master_people_log.json"
$masterPeopleLogData = @{ Entries = @() }
try {
    $existingPeopleFileUri = "https://graph.microsoft.com/v1.0/drives/$driveId/items/$rootFolderId`:/$masterPeopleLogFileName"
    $existingPeopleFile = Invoke-RestMethod -Method Get -Uri $existingPeopleFileUri -Headers $authHeader
    $downloadPeopleUri = "https://graph.microsoft.com/v1.0/drives/$driveId/items/$($existingPeopleFile.id)/content"
    $rawPeopleData = Invoke-RestMethod -Method Get -Uri $downloadPeopleUri -Headers $authHeader
    if ($rawPeopleData.Entries) { $masterPeopleLogData.Entries = @($rawPeopleData.Entries) }
    Write-Host "Master People Log loaded ($($masterPeopleLogData.Entries.Count) entries) ✅"
} catch {
    Write-Host "No existing Master People Log found. Starting fresh."
}

# =========================
# VTT DIRECT-FILE MODE
# Bypasses calendar lookup and transcript fetch — processes a local .vtt file directly.
# Usage: pwsh -File ./power-transcript-pipeline.ps1 -VttFile "path/to/file.vtt" -Participant "Theo Davis"
# =========================
if ($VttFile) {
    if (-not (Test-Path $VttFile)) {
        Write-Error "VTT file not found: $VttFile"
        exit 1
    }

    Write-Host "VTT Mode: Processing file '$VttFile'"

    # --- Parse filename for date and subject ---
    # Supports: YYYY-MM-DD_HHMM-Meeting_Title.vtt  or  YYYY-MM-DD-Meeting_Title.vtt
    $vttBaseName = [System.IO.Path]::GetFileNameWithoutExtension($VttFile)
    $eventDate   = $null
    $subject     = $null

    if ($vttBaseName -match "^(\d{4}-\d{2}-\d{2})_(\d{4})-(.+)$") {
        $eventDate = [datetime]::ParseExact("$($matches[1]) $($matches[2])", "yyyy-MM-dd HHmm", $null)
        $subject   = $matches[3] -replace "_", " "
    } elseif ($vttBaseName -match "^(\d{4}-\d{2}-\d{2})-(.+)$") {
        $eventDate = [datetime]::ParseExact($matches[1], "yyyy-MM-dd", $null)
        $subject   = $matches[2] -replace "_", " "
    } else {
        $eventDate = Get-Date
        $subject   = $vttBaseName -replace "_", " "
        Write-Warning "  [VTT] Could not parse date from filename. Using today: $($eventDate.ToString('yyyy-MM-dd'))"
    }

    $timestamp    = $eventDate.ToString("yyyy-MM-dd_HHmm")
    $cleanSubject = $subject -replace '[^a-zA-Z0-9\s-]', '' -replace '\s+', '_'
    $mId          = Get-MeetingLogId -EventDate $eventDate -Subject $subject
    $organiser    = if ($Participant) { $Participant } else { "Unknown" }
    $meetingType  = "Work"

    Write-Host "  [VTT] Subject    : $subject"
    Write-Host "  [VTT] Date       : $($eventDate.ToString('yyyy-MM-dd HH:mm'))"
    Write-Host "  [VTT] Participant: $organiser"

    # --- Convert VTT to plain text ---
    $vttRaw    = Get-Content -Path $VttFile -Raw -Encoding utf8
    $plainText = ConvertFrom-Vtt -VttContent $vttRaw
    Write-Host "  [VTT] Transcript length: $($plainText.Length) chars"

    # --- Classify and summarise ---
    $cls = Get-MeetingClassification -type $meetingType -organiser $organiser -transcriptContent $plainText
    if (-not $cls.summary) {
        Write-Warning "  [VTT] Summary generation failed. Retrying once..."
        $cls = Get-MeetingClassification -type $meetingType -organiser $organiser -transcriptContent $plainText
    }

    # --- EIP Enrichment ---
    $historyTopicRecords = @()
    if ($masterLogData -and $masterLogData.Meetings) {
        $historyTopicRecords = $masterLogData.Meetings | Where-Object { $_.TopicRecords } | ForEach-Object { $_.TopicRecords } | Where-Object { $_ }
    }
    $enrichResult        = Enrich-Summary -summaryText $cls.summary -meetingId $mId -historyRecords $historyTopicRecords
    $enrichedSummaryText = if ($enrichResult.Summary) { $enrichResult.Summary } else { $cls.summary }
    $topicRecords3D      = if ($enrichResult.Records) { $enrichResult.Records } else { @() }
    $modeResult          = Assign-Mode -type $meetingType -organiser $organiser -topicRecords $topicRecords3D

    foreach ($rec in $topicRecords3D) {
        Write-Host "  [3D DIAG] Topic=$($rec.TopicId) / $($rec.TopicName) | Section=$($rec.Section) |Category=$($rec.Category) | ContextType=$($rec.ContextType)"
    }
    Write-Host "  [VALIDATION] Topics detected: $(($topicRecords3D | Select-Object -Property TopicId -Unique).Count)"
    Write-Host "  [VALIDATION] Mode Assigned: $($modeResult.mode) ($($modeResult.source))"

    # --- Build header ---
    $masterLogUrl = "https://scanningpens.sharepoint.com/sites/Petersplace/Shared%20Documents/Exec%20Intel%20Insights/Meeting%20transcripts/master_log.txt"
    $header = @"
MEETING ID: $mId
SUBJECT: $subject
ORGANISER: $organiser
EVENT DATE: $($eventDate.ToString("yyyy-MM-ddTHH:mm:ssZ"))
TYPE: $meetingType
PRIORITY: normal
MODE: $($modeResult.mode)
MODE_SOURCE: $($modeResult.source)
MODE_CONFIDENCE: $($modeResult.confidence)
PIPELINE_VERSION: $PIPELINE_VERSION
PROCESSING_TIMESTAMP: $([System.DateTime]::UtcNow.ToString("yyyy-MM-dd HH:mm:ssZ"))
STATUS: success
BACK-LINK (MASTER LOG): $masterLogUrl
---

"@

    # --- Save transcript .txt ---
    if (-not (Test-Path $outDir)) { $null = New-Item -ItemType Directory -Path $outDir -Force }
    $localFile = Join-Path $outDir "$timestamp-$cleanSubject.txt"
    ($header + $plainText) | Out-File -FilePath $localFile -Encoding utf8
    Write-Host "  [VTT] Transcript saved: $localFile"

    # --- Save summary .txt ---
    $localSummaryFile = $null
    if ($cls.summary) {
        $localSummaryFile = Join-Path $outDir "$timestamp-$cleanSubject-Summary.txt"
        ($header + $enrichedSummaryText) | Out-File -FilePath $localSummaryFile -Encoding utf8
        Write-Host "  [VTT] Summary saved   : $localSummaryFile"
    }

    # --- SharePoint upload ---
    $uploadedTranscript = $null
    $uploadedSummary    = $null
    try {
        $eventFolderPath    = "$spTranscriptRootFolder/$($eventDate.ToString('yyyy-MM'))"
        $eventFolderId      = Ensure-DriveFolder -DriveId $driveId -FolderPath $eventFolderPath
        $uploadedTranscript = Upload-FileToSharePoint -DriveId $driveId -FolderId $eventFolderId -FilePath $localFile
        Write-Host "  [VTT] Transcript uploaded to SharePoint"
        if ($localSummaryFile) {
            $uploadedSummary = Upload-FileToSharePoint -DriveId $driveId -FolderId $eventFolderId -FilePath $localSummaryFile
            Write-Host "  [VTT] Summary uploaded to SharePoint"
        }
    } catch {
        Write-Warning "  [VTT] SharePoint upload failed: $_"
    }

    # --- Confluence mirroring ---
    $confluenceUrl = $null
    if ($cls.summary) {
        $vttConfig       = if (Test-Path (Join-Path $PSScriptRoot "pipeline_config.json")) { Get-Content -Path (Join-Path $PSScriptRoot "pipeline_config.json") | ConvertFrom-Json } else { $null }
        $isMirrorEnabled = ($vttConfig -and $vttConfig.enable_confluence_mirror) -or ($env:CONFLUENCE_TOKEN -and $env:CONFLUENCE_USER)
        if ($isMirrorEnabled) {
            $confSpace  = if ($env:CONFLUENCE_SPACE_KEY) { $env:CONFLUENCE_SPACE_KEY } else { $vttConfig.confluence_space_key }
            $confParent = if ($env:CONFLUENCE_PARENT_ID) { $env:CONFLUENCE_PARENT_ID } else { $vttConfig.confluence_parent_id }
            if ($confSpace -and $confParent) {
                $confHtml      = Convert-SummaryToConfluenceHtml -SummaryText $enrichedSummaryText -Subject $subject -MeetingId $mId -EventDate $eventDate -Organiser $organiser
                $confluenceUrl = Publish-SummaryToConfluence -HtmlContent $confHtml -Title $mId -SpaceKey $confSpace -ParentPageId $confParent
            }
        }
    }

    # --- VTT People Intelligence ---
    $vttUploadedPeopleFile = $null
    if ($peopleConfig -and $cls.summary -and $plainText) {
        try {
            $vttSpeakerNames   = Get-TranscriptSpeakers -TranscriptText $plainText
            $vttResolvedPeople = Resolve-People -Names $vttSpeakerNames -PeopleConfig $peopleConfig
            if ($vttResolvedPeople -and $vttResolvedPeople.Count -gt 0) {
                $vttLlmKey     = if ($env:FOUNDRY_API_KEY) { $env:FOUNDRY_API_KEY } elseif ($env:AZURE_OPENAI_API_KEY) { $env:AZURE_OPENAI_API_KEY } else { $rules.LLMConfig.ApiKey }
                $vttAuthMode   = if ($rules.LLMConfig.Endpoint -match "openai\.azure\.com") { "api-key" } else { "Bearer" }
                $vttLlmHeaders = if ($vttAuthMode -eq "api-key") { @{ "api-key" = $vttLlmKey; "Content-Type" = "application/json" } } else { @{ "Authorization" = "Bearer $vttLlmKey"; "Content-Type" = "application/json" } }
                $vttDeployment = if ($rules.LLMConfig.DeploymentName) { $rules.LLMConfig.DeploymentName } else { $rules.LLMConfig.Model }
                $vttLlmUri     = if ($rules.LLMConfig.Endpoint -match "openai\.azure\.com") {
                    $vttBase = $rules.LLMConfig.Endpoint -replace "/(openai/)?v\d[^/]*/?$", "" -replace "/$", ""
                    "$vttBase/openai/deployments/$vttDeployment/chat/completions?api-version=2024-02-15-preview"
                } else { "$($rules.LLMConfig.Endpoint -replace '/$', '')/chat/completions" }

                $vttPeopleRaw = Get-PeopleIntelligence `
                    -TranscriptText $plainText `
                    -ChunkSummaries $enrichedSummaryText `
                    -ResolvedPeople $vttResolvedPeople `
                    -TopicRecords $topicRecords3D `
                    -MeetingId $mId `
                    -Subject $subject `
                    -FullUri $vttLlmUri `
                    -Headers $vttLlmHeaders `
                    -Model $rules.LLMConfig.Model

                if ($vttPeopleRaw) {
                    $vttPeopleContent = Format-PeopleFile -LLMOutput $vttPeopleRaw -MeetingId $mId -Subject $subject -EventDate $eventDate -PipelineVersion $PIPELINE_VERSION
                    $vttLocalPeopleFile = Join-Path $outDir "$timestamp-$cleanSubject-People.txt"
                    $vttPeopleContent | Out-File -FilePath $vttLocalPeopleFile -Encoding utf8
                    $vttUploadedPeopleFile = Upload-FileToSharePoint -DriveId $driveId -FolderId $eventFolderId -FilePath $vttLocalPeopleFile
                    Write-Host "  [VTT] People file uploaded: $($vttUploadedPeopleFile.webUrl)"
                    $masterPeopleLogData = Update-MasterPeopleLog -MasterPeopleLogData $masterPeopleLogData -MeetingId $mId -Subject $subject -EventDate $eventDate -PeopleFileUrl $vttUploadedPeopleFile.webUrl -ResolvedPeople $vttResolvedPeople
                }
            } else {
                Write-Warning "  [VTT] No resolved people found — skipping people file"
            }
        } catch {
            Write-Warning "  [VTT] People intelligence failed: $_"
        }
    }

    # --- Master Log entry ---
    $now         = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
    $vttLogEntry = @{
        MeetingId                = $mId
        Subject                  = $subject
        Organiser                = $organiser
        EventDate                = $eventDate.ToString("yyyy-MM-ddTHH:mm:ssZ")
        Type                     = $meetingType
        Priority                 = "normal"
        Mode                     = $modeResult.mode
        ModeConfidence           = $modeResult.confidence
        ModeSource               = $modeResult.source
        Classification           = $modeResult.mode
        ClassificationConfidence = $modeResult.confidence
        ClassificationSource     = $modeResult.source
        PipelineVersion          = $PIPELINE_VERSION
        TopicRecords             = $topicRecords3D
        HasTranscript            = $true
        TranscriptFile           = if ($uploadedTranscript) { $uploadedTranscript.webUrl } else { $localFile }
        SummaryFile              = if ($uploadedSummary) { $uploadedSummary.webUrl } else { $localSummaryFile }
        ConfluenceMirror         = $confluenceUrl
        PeopleFile               = if ($vttUploadedPeopleFile) { $vttUploadedPeopleFile.webUrl } else { $null }
        Status                   = "success"
        AgentState               = "processed_vtt"
        LastProcessed            = $now
        RetryCount               = 0
        LastRunId                = "vtt_direct"
        LastUpdated              = $now
    }

    $existingMatch = $masterLogData.Meetings | Where-Object { $_.MeetingId -eq $mId }
    if ($existingMatch) {
        $idx = [array]::IndexOf($masterLogData.Meetings, $existingMatch)
        $masterLogData.Meetings[$idx] = $vttLogEntry
    } else {
        $masterLogData.Meetings += $vttLogEntry
    }

    $masterLogLocalPath = Join-Path $outDir $masterLogFileName
    $masterLogData | ConvertTo-Json -Depth 10 | Set-Content -Path $masterLogLocalPath -Encoding utf8
    try { Upload-FileToSharePoint -DriveId $driveId -FolderId $rootFolderId -FilePath $masterLogLocalPath | Out-Null } catch { Write-Warning "  [VTT] Master log upload failed: $_" }

    Write-Host ""
    Write-Host "VTT Mode complete ✅"
    Write-Host "  Transcript : $localFile"
    if ($localSummaryFile)        { Write-Host "  Summary    : $localSummaryFile" }
    if ($confluenceUrl)           { Write-Host "  Confluence : $confluenceUrl" }
    if ($vttUploadedPeopleFile)   { Write-Host "  People     : $($vttUploadedPeopleFile.webUrl)" }

    # Save master_people_log in VTT mode
    $masterPeopleLogLocalPath = Join-Path $outDir $masterPeopleLogFileName
    $masterPeopleLogData | ConvertTo-Json -Depth 10 | Set-Content -Path $masterPeopleLogLocalPath -Encoding utf8
    try { Upload-FileToSharePoint -DriveId $driveId -FolderId $rootFolderId -FilePath $masterPeopleLogLocalPath | Out-Null } catch {}
    exit 0
}

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

# --- DEDUPLICATE BY ONLINE MEETING JOIN URL ---
# Prevents processing the same meeting multiple times if it exists on multiple calendars
$uniqueMeetings = @{}
foreach ($e in $events) {
    $key = $e.onlineMeeting.joinUrl
    if (-not $uniqueMeetings.ContainsKey($key)) {
        $uniqueMeetings[$key] = $e
    }
}
$events = $uniqueMeetings.Values

# =========================
# PROCESS MEETINGS
# =========================

$log = @()

foreach ($calendarEvent in $events) {
    # Ensure token is valid for this iteration
    Ensure-GraphToken
    
    $subject   = $calendarEvent.subject
    $joinUrl   = $calendarEvent.onlineMeeting.joinUrl
    $organiser = $calendarEvent.organizer.emailAddress.address
    $start     = $calendarEvent.start.dateTime

    # --- SKIP SUCCESSFUL MEETINGS ---
    if (-not $ForceRerun) {
        $mIdCheck = Get-MeetingLogId -EventDate $start -Subject $subject
        $existing = $masterLogData.Meetings | Where-Object { $_.MeetingId -eq $mIdCheck }
        if ($existing -and $existing.Status -eq "success" -and $existing.TranscriptFile -and $existing.SummaryFile) {
            Write-Output "  [SKIP] Meeting '$subject' is already processed successfully. Skipping."
            continue
        }
    }

    Write-Host ("Processing: " + $subject)

    # --- EXTERNAL TENANT CHECK ---
    if (Test-IsExternalTenant -JoinUrl $joinUrl -InternalTenantId $tenantId) {
        Write-Output "  [SKIP] Meeting '$subject' belongs to an external tenant. Skipping."
        $log += [pscustomobject]@{
            RunId                    = $runId
            Subject                  = $subject
            Organiser                = $organiser
            EventDate                = $start
            Status                   = "skipped_external_tenant"
            Type                     = "Work"
            Priority                 = "normal"
            Classification           = "CEO"
            ClassificationConfidence = "Low"
            ClassificationSource     = "skip"
            AgentState               = "skipped"
            LastProcessed            = $null
            RetryCount               = 0
            File                     = $null
        }
        continue
    }

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
            $mId = Get-MeetingLogId -EventDate $start -Subject $subject
            $masterLogUrl = "https://scanningpens.sharepoint.com/sites/Petersplace/Shared%20Documents/Exec%20Intel%20Insights/Meeting%20transcripts/master_log.txt"

            # --- CLASSIFICATION & SUMMARY LOGIC ---
            $cls = Get-MeetingClassification -type $meetingType -organiser $organiser -transcriptContent $content
            $repairReason = $null
            $repairAttempted = $false

            # Reliable repair: if summary is missing or unusable, retry once in the same run
            if (-not $cls.summary) {
                Write-Warning "  [REPAIR] Summary generation failed. Retrying once in same run..."
                $repairAttempted = $true
                $cls = Get-MeetingClassification -type $meetingType -organiser $organiser -transcriptContent $content
                if (-not $cls.summary) {
                    $repairReason = "llm_summary_missing_after_retry"
                }
            }

            # --- EIP ENHANCEMENT LAYER ---
            # Pre-extract history for Enrichment function
            $historyTopicRecords = @()
            if ($masterLogData.Meetings) {
                foreach ($mE in $masterLogData.Meetings) {
                    if ($mE.TopicRecords) {
                        foreach ($tr in $mE.TopicRecords) {
                            $historyTopicRecords += [pscustomobject]@{
                                TopicId   = $tr.TopicId
                                TopicName = $tr.TopicName
                                Content   = $tr.Content
                                Signal    = $tr.Signal
                                EventDate = $mE.EventDate
                            }
                        }
                    }
                }
            }

            # Phase 1-4: Stable Topic Classification & Consolidation
            $enrichResult = Enrich-Summary -summaryText $cls.summary -meetingId $mId -historyRecords $historyTopicRecords
            $enrichedSummaryText = $enrichResult.Summary
            $topicRecords = $enrichResult.Records

            # Task 5.1: Smart Mode Switch for "Work" meetings based on topic content
            $modeInfo = Assign-Mode -type $meetingType -organiser $organiser -topicRecords $topicRecords

            # --- PHASE 7: VALIDATION & LOGGING ---
            if ($pipelineConfig.enable_stable_topic_classification) {
                $topicCount = if ($topicRecords) { $topicRecords.Count } else { 0 }
                $t00Count = ($topicRecords | Where-Object { $_.TopicId -eq "T00" }).Count
                $t00Usage = if ($topicCount -gt 0) { ($t00Count / $topicCount) * 100 } else { 0 }
                
                Write-Output "  [VALIDATION] Topics detected: $topicCount"
                Write-Output "  [VALIDATION] T00 Usage: $($t00Usage.ToString('F1'))%"
                Write-Output "  [VALIDATION] Mode Assigned: $($modeInfo.mode) ($($modeInfo.source))"

                # Safety Check: Ensure we have at least one topic for successful runs
                if ($topicCount -eq 0 -and $cls.summary) {
                    Write-Warning "  [VALIDATION] No topics extracted from summary. Check LLM prompt compliance."
                }
            }

            $header = @"
---
MEETING ID: $mId
SUBJECT: $subject
ORGANISER: $organiser
EVENT DATE: $start
TYPE: $meetingType
PRIORITY: $priority
MODE: $($modeInfo.mode)
MODE_SOURCE: $($modeInfo.source)
MODE_CONFIDENCE: $($modeInfo.confidence)
PIPELINE_VERSION: $PIPELINE_VERSION
TAXONOMY_VERSION: $TAXONOMY_VERSION
MAPPING_RULES_VERSION: $MAPPING_RULES_VERSION
ROLES_CONFIG_VERSION: $ROLES_CONFIG_VERSION
SENTIMENT_RULES_VERSION: $SENTIMENT_RULES_VERSION
PROCESSING_TIMESTAMP: $([System.DateTime]::UtcNow.ToString("yyyy-MM-dd HH:mm:ssZ"))
STATUS: success
BACK-LINK (MASTER LOG): $masterLogUrl
---

"@
            # 1. Save and Upload RAW TRANSCRIPT
            $contentWithHeader = $header + $content
            $contentWithHeader | Out-File -FilePath $localFile -Encoding utf8
            $uploadedTranscript = Upload-FileToSharePoint -DriveId $driveId -FolderId $eventFolderId -FilePath $localFile

            # 2. Save and Upload SUMMARY (if available)
            $uploadedSummary = $null
            if ($cls.summary) {
                $localSummaryFile = Join-Path $outDir "$timestamp-$cleanSubject-Summary.txt"
                $summaryWithHeader = $header + $enrichedSummaryText
                $summaryWithHeader | Out-File -FilePath $localSummaryFile -Encoding utf8
                $uploadedSummary = Upload-FileToSharePoint -DriveId $driveId -FolderId $eventFolderId -FilePath $localSummaryFile

                # --- CONFLUENCE MIRRORING ---
                $config = $null; if (Test-Path (Join-Path $PSScriptRoot "pipeline_config.json")) { $config = Get-Content -Path (Join-Path $PSScriptRoot "pipeline_config.json") | ConvertFrom-Json }
                
                $confluenceUrl = $null
                $hasConfluenceCreds = ($env:CONFLUENCE_TOKEN -and $env:CONFLUENCE_USER)
                $isMirrorEnabled = ($config -and $config.enable_confluence_mirror) -or $hasConfluenceCreds
                
                if ($isMirrorEnabled -and $organiser -ne "carolynn@empoweringtech.com") {
                    $confSpace = if ($env:CONFLUENCE_SPACE_KEY) { $env:CONFLUENCE_SPACE_KEY } else { $config.confluence_space_key }
                    $confParent = if ($env:CONFLUENCE_PARENT_ID) { $env:CONFLUENCE_PARENT_ID } else { $config.confluence_parent_id }
                    
                    if ($confSpace -and $confParent) {
                        $confHtml = Convert-SummaryToConfluenceHtml -SummaryText $enrichedSummaryText -Subject $subject -MeetingId $mId -EventDate $start -Organiser $organiser
                        $confluenceUrl = Publish-SummaryToConfluence -HtmlContent $confHtml -Title $mId -SpaceKey $confSpace -ParentPageId $confParent
                    } else {
                        Write-Output "  [CONFLUENCE] Skip: Missing Space Key ($confSpace) or Parent ID ($confParent)."
                    }
                }
            }
            
            # --- PEOPLE INTELLIGENCE ---
            $uploadedPeopleFile = $null
            if ($peopleConfig -and $cls.summary -and $content) {
                try {
                    # 1. Extract speaker names from transcript and resolve against people_config
                    $speakerNames = Get-TranscriptSpeakers -TranscriptText $content
                    $resolvedPeople = Resolve-People -Names $speakerNames -PeopleConfig $peopleConfig

                    if ($resolvedPeople -and $resolvedPeople.Count -gt 0) {
                        # 2. Run LLM people intelligence extraction (Pass 3)
                        # Build LLM connection for people pass (same config as classification)
                        $pLlmKey     = if ($env:FOUNDRY_API_KEY) { $env:FOUNDRY_API_KEY } elseif ($env:AZURE_OPENAI_API_KEY) { $env:AZURE_OPENAI_API_KEY } else { $rules.LLMConfig.ApiKey }
                        $pAuthMode   = if ($rules.LLMConfig.Endpoint -match "openai\.azure\.com") { "api-key" } else { "Bearer" }
                        $pHeaders    = if ($pAuthMode -eq "api-key") { @{ "api-key" = $pLlmKey; "Content-Type" = "application/json" } } else { @{ "Authorization" = "Bearer $pLlmKey"; "Content-Type" = "application/json" } }
                        $pDeployment = if ($rules.LLMConfig.DeploymentName) { $rules.LLMConfig.DeploymentName } else { $rules.LLMConfig.Model }
                        $pUri        = if ($rules.LLMConfig.Endpoint -match "openai\.azure\.com") {
                            $pBase = $rules.LLMConfig.Endpoint -replace "/(openai/)?v\d[^/]*/?$", "" -replace "/$", ""
                            "$pBase/openai/deployments/$pDeployment/chat/completions?api-version=2024-02-15-preview"
                        } else { "$($rules.LLMConfig.Endpoint -replace '/$', '')/chat/completions" }

                        $peopleRaw = Get-PeopleIntelligence `
                            -TranscriptText $content `
                            -ChunkSummaries $enrichedSummaryText `
                            -ResolvedPeople $resolvedPeople `
                            -TopicRecords $topicRecords3D `
                            -MeetingId $mId `
                            -Subject $subject `
                            -FullUri $pUri `
                            -Headers $pHeaders `
                            -Model $rules.LLMConfig.Model

                        if ($peopleRaw) {
                            # 3. Format and save *-People.txt
                            $peopleFileContent = Format-PeopleFile `
                                -LLMOutput $peopleRaw `
                                -MeetingId $mId `
                                -Subject $subject `
                                -EventDate $start `
                                -PipelineVersion $PIPELINE_VERSION
                            $localPeopleFile = Join-Path $outDir "$timestamp-$cleanSubject-People.txt"
                            $peopleFileContent | Out-File -FilePath $localPeopleFile -Encoding utf8

                            # 4. Upload to SharePoint (same folder as transcript and summary)
                            $uploadedPeopleFile = Upload-FileToSharePoint -DriveId $driveId -FolderId $eventFolderId -FilePath $localPeopleFile
                            Write-Host "  [PEOPLE] People file uploaded: $($uploadedPeopleFile.webUrl)"
                            $masterPeopleLogData = Update-MasterPeopleLog -MasterPeopleLogData $masterPeopleLogData -MeetingId $mId -Subject $subject -EventDate $start -PeopleFileUrl $uploadedPeopleFile.webUrl -ResolvedPeople $resolvedPeople
                        }
                    } else {
                        Write-Warning "  [PEOPLE] No resolved people found in transcript — skipping people file"
                    }
                } catch {
                    Write-Warning "  [PEOPLE] People intelligence failed: $_"
                }
            }

            # --- CAPTURE SUCCESS DATA IMMEDIATELY ---
            $effectiveStatus = if ($uploadedTranscript -and -not $uploadedSummary) { "repair_needed" } else { "success" }
            $effectiveAgentState = if ($effectiveStatus -eq "repair_needed") { "repair_pending" } else { "pending" }
            $effectiveRetryCount = if ($repairAttempted) { 1 } else { 0 }

            $logEntry = [pscustomobject]@{
                RunId                    = $runId
                Subject                  = $subject
                Organiser                = $organiser
                EventDate                = $start
                Status                   = $effectiveStatus
                Type                     = $meetingType
                Priority                 = $priority
                Classification           = $cls.classification
                ClassificationConfidence = $cls.confidence
                ClassificationSource     = $cls.source
                AgentState               = $effectiveAgentState
                LastProcessed            = [System.DateTime]::UtcNow.ToString("yyyy-MM-dd HH:mm:ssZ")
                RetryCount               = $effectiveRetryCount
                RepairReason             = $repairReason
                File                     = if ($uploadedTranscript) { $uploadedTranscript.webUrl } else { $null }
                SummaryFile              = if ($uploadedSummary) { $uploadedSummary.webUrl } else { $null }
                ConfluenceMirror         = $confluenceUrl
                TopicRecords             = $topicRecords
                MeetingId                = $mId
                PeopleFile               = if ($uploadedPeopleFile) { $uploadedPeopleFile.webUrl } else { $null }
            }
            $log += $logEntry

            # --- TEAMS NOTIFICATION ---
            $hasTranscript = if ($logEntry.File) { "True" } else { "False" }
            $mirrorLine = if ($logEntry.ConfluenceMirror) { "CONFLUENCE MIRROR: $($logEntry.ConfluenceMirror)`n" } else { "" }
            
            $teamsMsg = "MEETING ID: $($logEntry.MeetingId)`n" +
                        "SUBJECT: $($logEntry.Subject)`n" +
                        "ORGANISER: $($logEntry.Organiser)`n" +
                        "EVENT DATE: $($logEntry.EventDate)`n" +
                        "TYPE: $($logEntry.Type)`n" +
                        "PRIORITY: $($logEntry.Priority)`n" +
                        "MODE: $($logEntry.Classification)`n" +
                        "MODE_CONFIDENCE: $($logEntry.ClassificationConfidence)`n" +
                        "MODE_SOURCE: $($logEntry.ClassificationSource)`n" +
                        "STATUS: $($logEntry.Status)`n" +
                        "AGENT STATE: $($logEntry.AgentState)`n" +
                        "HAS TRANSCRIPT: $hasTranscript`n" +
                        "TRANSCRIPT FILE: $($logEntry.File)`n" +
                        "SUMMARY FILE: $($logEntry.SummaryFile)`n" +
                        $mirrorLine +
                        "LAST UPDATED: $($logEntry.LastProcessed)"
            
            # Teams notification is now batched at the end of the run

            # Update SharePoint Columns for both files (Transcript and Summary)
            $filesToUpdate = New-Object System.Collections.Generic.List[Object]
            if ($uploadedTranscript) { $filesToUpdate.Add($uploadedTranscript) }
            if ($uploadedSummary) { $filesToUpdate.Add($uploadedSummary) }

            foreach ($fileItem in $filesToUpdate) {
                try {
                    Write-Output "  Updating SharePoint columns for: $($fileItem.name)"
                    $fieldsUri = "https://graph.microsoft.com/v1.0/drives/$driveId/items/$($fileItem.id)/listitem/fields"
                    
                    $fieldData = @{
                        "MeetingID" = $mId
                        "Category"  = $meetingType
                        "Priority"  = $priority
                        "Mode"      = $modeInfo.mode
                    }
                    
                    Invoke-RestMethod -Method Patch -Uri $fieldsUri -Headers $authHeader -Body ($fieldData | ConvertTo-Json) -ContentType "application/json" | Out-Null
                } catch {
                    $err = $_.Exception.Message
                    Write-Warning "SharePoint Update Failed for $($fileItem.name): $err"
                }
            }
        }
    }
    catch {
        $errMessage = $_.Exception.Message
        $uriStr = if ($_.Exception.Response) { $_.Exception.Response.RequestMessage.RequestUri.ToString() } else { "Unknown URI" }
        Write-Error "  [CRITICAL ERROR] Failed to process meeting '$subject': $errMessage (URI: $uriStr)"
        
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
# Ensure directory exists (safeguard against accidental deletion during execution)
if (-not (Test-Path $outDir)) { $null = New-Item -ItemType Directory -Path $outDir -Force }

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
$masterLogLocalPath = Join-Path $outDir $masterLogFileName

# Merge current run results into Master Log
$now = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
foreach ($runEntry in $log) {
    $meetingId = Get-MeetingLogId -EventDate $runEntry.EventDate -Subject $runEntry.Subject

    $existingMatch = $masterLogData.Meetings | Where-Object { $_.MeetingId -eq $meetingId }

    # Success-Sticky Logic: Do not overwrite a successful record with an error/empty one
    $shouldUpdate = $true
    if ($existingMatch -and $existingMatch.Status -eq "success" -and $runEntry.Status -ne "success") {
        $shouldUpdate = $false
    }

    if (-not $shouldUpdate) {
        continue
    }

    # Preserve file URLs and topic data when re-run produces success but LLM/upload partial failure
    $transcriptFile = Get-StickyMasterLogValue -NewValue $runEntry.File -ExistingEntry $existingMatch -PropertyName "TranscriptFile"
    $summaryFile = Get-StickyMasterLogValue -NewValue $runEntry.SummaryFile -ExistingEntry $existingMatch -PropertyName "SummaryFile"
    $confMirror = Get-StickyMasterLogValue -NewValue $runEntry.ConfluenceMirror -ExistingEntry $existingMatch -PropertyName "ConfluenceMirror"
    $topicRecords = Get-StickyMasterLogValue -NewValue $runEntry.TopicRecords -ExistingEntry $existingMatch -PropertyName "TopicRecords"
    $organiserValue = Get-StickyMasterLogValue -NewValue $runEntry.Organiser -ExistingEntry $existingMatch -PropertyName "Organiser"

    $updatedEntry = @{
        MeetingId                = $meetingId
        Subject                  = $runEntry.Subject
        Organiser                = $organiserValue
        EventDate                = $runEntry.EventDate
        Type                     = $runEntry.Type
        Priority                 = $runEntry.Priority
        Mode                     = $runEntry.Classification
        ModeConfidence           = $runEntry.ClassificationConfidence
        ModeSource               = $runEntry.ClassificationSource
        Classification           = $runEntry.Classification
        ClassificationConfidence = $runEntry.ClassificationConfidence
        ClassificationSource     = $runEntry.ClassificationSource
        PipelineVersion          = $PIPELINE_VERSION
        TopicRecords             = $topicRecords
        HasTranscript            = ($runEntry.Status -eq "success") -or ($existingMatch -and $existingMatch.HasTranscript -and $transcriptFile)
        TranscriptFile           = $transcriptFile
        SummaryFile              = $summaryFile
        ConfluenceMirror         = $confMirror
        PeopleFile               = Get-StickyMasterLogValue -NewValue $runEntry.PeopleFile -ExistingEntry $existingMatch -PropertyName "PeopleFile"
        Status                   = $runEntry.Status
        AgentState               = if ($existingMatch) { $existingMatch.AgentState } else { $runEntry.AgentState }
        LastProcessed            = if ($existingMatch) { $existingMatch.LastProcessed } else { $null }
        RetryCount               = if ($existingMatch -and $runEntry.Status -eq 'repair_needed') { ([int]$existingMatch.RetryCount + 1) } elseif ($existingMatch) { $existingMatch.RetryCount } else { 0 }
        RepairReason             = if ($runEntry.PSObject.Properties.Name -contains 'RepairReason') { $runEntry.RepairReason } else { $null }
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

# Save and Upload Master People Log (JSON)
$masterPeopleLogLocalPath = Join-Path $outDir $masterPeopleLogFileName
$masterPeopleLogData | ConvertTo-Json -Depth 10 | Set-Content -Path $masterPeopleLogLocalPath -Encoding utf8
try { Upload-FileToSharePoint -DriveId $driveId -FolderId $rootFolderId -FilePath $masterPeopleLogLocalPath | Out-Null } catch { Write-Warning "Master People Log JSON upload failed: $_" }

# Save and Upload Master People Log (TXT)
$masterPeopleLogTxtName = "master_people_log.txt"
$masterPeopleLogTxtPath = Join-Path $outDir $masterPeopleLogTxtName
$peopleTxtContent = @()
foreach ($pe in ($masterPeopleLogData.Entries | Sort-Object EventDate -Descending)) {
    $peopleTxtContent += "MEETING ID: $($pe.MeetingId)"
    $peopleTxtContent += "SUBJECT: $($pe.Subject)"
    $peopleTxtContent += "EVENT DATE: $($pe.EventDate)"
    $peopleTxtContent += "PEOPLE FILE: $($pe.PeopleFile)"
    $peopleTxtContent += "PEOPLE RESOLVED: $($pe.PeopleResolved -join ", ")"
    $peopleTxtContent += "GENERATED AT: $($pe.GeneratedAt)"
    $peopleTxtContent += ""
}
$peopleTxtContent | Out-File -FilePath $masterPeopleLogTxtPath -Encoding utf8
try { Upload-FileToSharePoint -DriveId $driveId -FolderId $rootFolderId -FilePath $masterPeopleLogTxtPath | Out-Null } catch { Write-Warning "Master People Log TXT upload failed: $_" }

# 5. Generate and Upload Human-Readable Master Log (.txt)
$masterLogTxtName = "master_log.txt"
$masterLogTxtLocalPath = Join-Path $outDir $masterLogTxtName

$txtContent = @()
foreach ($m in ($masterLogData.Meetings | Sort-Object EventDate -Descending)) {
    $mode = if ($m.Mode) { $m.Mode } else { $m.Classification }
    $modeConfidence = if ($m.ModeConfidence) { $m.ModeConfidence } else { $m.ClassificationConfidence }
    $modeSource = if ($m.ModeSource) { $m.ModeSource } else { $m.ClassificationSource }

    $txtContent += "MEETING ID: $($m.MeetingId)"
    $txtContent += "SUBJECT: $($m.Subject)"
    $txtContent += "ORGANISER: $($m.Organiser)"
    $txtContent += "EVENT DATE: $($m.EventDate)"
    $txtContent += "TYPE: $($m.Type)"
    $txtContent += "PRIORITY: $($m.Priority)"
    $txtContent += "MODE: $mode"
    $txtContent += "MODE_CONFIDENCE: $modeConfidence"
    $txtContent += "MODE_SOURCE: $modeSource"
    $txtContent += "STATUS: $($m.Status)"
    $txtContent += "AGENT STATE: $($m.AgentState)"
    if ($m.RepairReason) { $txtContent += "REPAIR REASON: $($m.RepairReason)" }
    $txtContent += "HAS TRANSCRIPT: $($m.HasTranscript)"
    $txtContent += "TRANSCRIPT FILE: $($m.TranscriptFile)"
    $txtContent += "SUMMARY FILE: $($m.SummaryFile)"
    if ($m.ConfluenceMirror) { $txtContent += "CONFLUENCE MIRROR: $($m.ConfluenceMirror)" }
    if ($m.PeopleFile) { $txtContent += "PEOPLE FILE: $($m.PeopleFile)" }
    $txtContent += "LAST UPDATED: $($m.LastUpdated)"
    $txtContent += "" # Blank line separator
}

$txtContent | Out-File -FilePath $masterLogTxtLocalPath -Encoding utf8
Upload-FileToSharePoint -DriveId $driveId -FolderId $rootFolderId -FilePath $masterLogTxtLocalPath | Out-Null

# --- BATCH TEAMS NOTIFICATION ---
if ($log -and $log.Count -gt 0) {
    Write-Host "Sending batch Teams notification..."
    $batchMsg = ""
    foreach ($entry in $log) {
        $hasTranscript = if ($entry.File) { "True" } else { "False" }
        
        $batchMsg += "MEETING ID: $($entry.MeetingId)`n"
        $batchMsg += "SUBJECT: $($entry.Subject)`n"
        $batchMsg += "ORGANISER: $($entry.Organiser)`n"
        $batchMsg += "EVENT DATE: $($entry.EventDate)`n"
        $batchMsg += "TYPE: $($entry.Type)`n"
        $batchMsg += "PRIORITY: $($entry.Priority)`n"
        $batchMsg += "MODE: $($entry.Classification)`n"
        $batchMsg += "MODE_CONFIDENCE: $($entry.ClassificationConfidence)`n"
        $batchMsg += "MODE_SOURCE: $($entry.ClassificationSource)`n"
        $batchMsg += "STATUS: $($entry.Status)`n"
        $batchMsg += "AGENT STATE: $($entry.AgentState)`n"
        $batchMsg += "HAS TRANSCRIPT: $hasTranscript`n"
        $batchMsg += "TRANSCRIPT FILE: $($entry.File)`n"
        $batchMsg += "SUMMARY FILE: $($entry.SummaryFile)`n"
        if ($entry.ConfluenceMirror) { $batchMsg += "CONFLUENCE MIRROR: $($entry.ConfluenceMirror)`n" }
        $batchMsg += "LAST UPDATED: $($entry.LastProcessed)`n`n"
    }
    Send-TeamsNotification -MessageBlock $batchMsg.Trim()
}

Write-Host "Master Log (.json and .txt) updated and uploaded ✅"

Write-Host "Done ✅"

# Local dev-mode preservation: keep TranscriptExport for inspection
if (Test-Path $outDir) {
    Write-Host "Local temp folder preserved for inspection ✅"
}
