#!/usr/bin/env pwsh
# =============================================================================
# normalize-topic-ids-d1.ps1
# -----------------------------------------------------------------------------
# Reads all topics from a D1 instance via the Worker API, applies the same
# Normalize-TopicIds logic used in the pipeline (matching topic_name against
# mapping_rules.json), and PATCHes each row whose topic_id needs updating.
#
# Usage:
#   pwsh -File normalize-topic-ids-d1.ps1 [-Env production|staging] [-DryRun]
#
# -Env      : "production" (default) or "staging"
# -DryRun   : Print proposed changes without writing to D1
# =============================================================================
param(
    [string] $Env     = "production",
    [switch] $DryRun
)

$ErrorActionPreference = "Stop"

# ── Config ───────────────────────────────────────────────────────────────────
$workerUrl = if ($Env -eq "staging") {
    "https://eip-api-worker-staging.homeassistant-8d3.workers.dev"
} else {
    "https://eip-api-worker.homeassistant-8d3.workers.dev"
}

$mappingRulesPath = Join-Path $PSScriptRoot "../../config/mapping_rules.json"
if (-not (Test-Path $mappingRulesPath)) {
    Write-Error "mapping_rules.json not found at: $mappingRulesPath"
    exit 1
}
$mappingRules = Get-Content $mappingRulesPath | ConvertFrom-Json

Write-Host ""
Write-Host "EIP — Normalize Topic IDs in D1" -ForegroundColor Cyan
Write-Host "  Environment : $Env" -ForegroundColor Cyan
Write-Host "  Worker      : $workerUrl" -ForegroundColor Cyan
Write-Host "  Dry Run     : $DryRun" -ForegroundColor Cyan
Write-Host "  Taxonomy    : $($mappingRules.Rules.Count) rules loaded" -ForegroundColor Cyan
Write-Host ""

# ── Helper: normalize a single topic_id + topic_name → canonical T-code ──────
function Get-CanonicalTopicId {
    param([string]$TopicId, [string]$TopicName)

    # Already a valid T-code → nothing to do
    if ($TopicId -match '^T\d+$') { return $TopicId }

    # Strip meeting-ref prefix if present (e.g. "2026-07-091000theopeter121-t02-product-quality")
    # Extract embedded T-code if present
    if ($TopicId -match '-(T\d+)-' -or $TopicId -match '-(T\d+)$') {
        $embedded = $Matches[1].ToUpper()
        $rule = $mappingRules.Rules | Where-Object { $_.TopicId -eq $embedded } | Select-Object -First 1
        if ($rule) { return $embedded }
    }

    # Also check lowercase t-code prefix (e.g. "t14-operational-effectiveness")
    if ($TopicId -match '^(t\d+)') {
        $embedded = $Matches[1].ToUpper()
        $rule = $mappingRules.Rules | Where-Object { $_.TopicId -eq $embedded } | Select-Object -First 1
        if ($rule) { return $embedded }
    }

    # Try matching on TopicName first (most reliable signal)
    $nameToMatch = $TopicName
    if ($nameToMatch) {
        # Strip version suffixes e.g. " v1.0"
        $nameToMatch = $nameToMatch -replace '\s*v\d+\.\d+\s*$', ''
        $nameClean = ($nameToMatch -replace '[^a-zA-Z0-9]', '').ToLower()

        $match = $mappingRules.Rules | Where-Object {
            $rName = ($_.Name -replace '[^a-zA-Z0-9]', '').ToLower()
            $rName -eq $nameClean -or $rName -like "*$nameClean*" -or $nameClean -like "*$rName*"
        } | Select-Object -First 1
        if ($match) { return $match.TopicId }
    }

    # Fall back to matching on topic_id slug
    $idClean = ($TopicId -replace '[^a-zA-Z0-9]', '').ToLower()
    if ($idClean) {
        $match = $mappingRules.Rules | Where-Object {
            $rName = ($_.Name    -replace '[^a-zA-Z0-9]', '').ToLower()
            $rId   = ($_.TopicId -replace '[^a-zA-Z0-9]', '').ToLower()
            $rName -like "*$idClean*" -or $idClean -like "*$rName*" -or $rId -like "*$idClean*" -or $idClean -like "*$rId*"
        } | Select-Object -First 1
        if ($match) { return $match.TopicId }
    }

    return "T00"  # Unknown — no taxonomy match found
}

# ── Fetch all topics ──────────────────────────────────────────────────────────
Write-Host "Fetching topics from D1..." -NoNewline
$page    = 1
$limit   = 500
$allTopics = @()
do {
    $url      = "$workerUrl/topics?limit=$limit&offset=$(($page - 1) * $limit)"
    $response = Invoke-RestMethod -Uri $url -Method Get -ErrorAction Stop
    $allTopics += $response.topics
    $hasMore  = $response.topics.Count -eq $limit
    $page++
} while ($hasMore)
Write-Host " $($allTopics.Count) topics loaded" -ForegroundColor Green

# ── Analyse and plan updates ──────────────────────────────────────────────────
$updates  = @()
$alreadyOk = 0
$noMatch   = 0

foreach ($topic in $allTopics) {
    $canonical = Get-CanonicalTopicId -TopicId $topic.topic_id -TopicName $topic.topic_name
    if ($canonical -eq $topic.topic_id) {
        $alreadyOk++
    } elseif ($canonical -eq "T00") {
        $noMatch++
        Write-Host "  [UNMATCHED] $($topic.topic_id) | $($topic.topic_name)" -ForegroundColor DarkYellow
    } else {
        $updates += [pscustomobject]@{
            OldId     = $topic.topic_id
            NewId     = $canonical
            TopicName = $topic.topic_name
            Rule      = ($mappingRules.Rules | Where-Object { $_.TopicId -eq $canonical }).Name
        }
    }
}

Write-Host ""
Write-Host "Analysis complete:" -ForegroundColor Cyan
Write-Host "  Already canonical (T-codes) : $alreadyOk"
Write-Host "  Needs updating              : $($updates.Count)"
Write-Host "  No taxonomy match (T00)     : $noMatch"
Write-Host ""

if ($updates.Count -eq 0) {
    Write-Host "Nothing to update. All topics are already normalised." -ForegroundColor Green
    exit 0
}

# ── Show planned updates ──────────────────────────────────────────────────────
Write-Host "Planned updates:" -ForegroundColor Cyan
$updates | ForEach-Object {
    Write-Host "  $($_.NewId) ← $($_.OldId.Substring(0, [Math]::Min(60, $_.OldId.Length)))" -ForegroundColor White
    Write-Host "     topic_name : $($_.TopicName.Substring(0, [Math]::Min(80, $_.TopicName.Length)))" -ForegroundColor Gray
    Write-Host "     rule match : $($_.Rule)" -ForegroundColor Gray
}
Write-Host ""

if ($DryRun) {
    Write-Host "DRY RUN — no changes written." -ForegroundColor Yellow
    exit 0
}

# ── Apply updates via PATCH /topics/:id ───────────────────────────────────────
$confirmed = Read-Host "Apply $($updates.Count) updates to $Env D1? (yes/no)"
if ($confirmed -ne "yes") {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
$ok    = 0
$fails = 0
foreach ($u in $updates) {
    try {
        # URL-encode the old topic_id for the path segment
        $encodedId = [Uri]::EscapeDataString($u.OldId)
        $body      = @{ topic_id = $u.NewId } | ConvertTo-Json
        Invoke-RestMethod -Uri "$workerUrl/topics/$encodedId" -Method Patch `
            -Body $body -ContentType "application/json" -ErrorAction Stop | Out-Null
        Write-Host "  ✅ $($u.NewId) ← $($u.OldId.Substring(0, [Math]::Min(50, $u.OldId.Length)))"
        $ok++
    } catch {
        Write-Warning "  ❌ Failed to update '$($u.OldId)': $_"
        $fails++
    }
}

Write-Host ""
Write-Host "Done. Updated: $ok  Failed: $fails  Unmatched (T00): $noMatch" -ForegroundColor Cyan
