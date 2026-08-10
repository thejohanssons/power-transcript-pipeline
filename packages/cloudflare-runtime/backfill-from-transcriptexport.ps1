<#
.SYNOPSIS
    Submits historical transcript files from TranscriptExport to the Cloudflare Runtime Worker
    to build up Topic Memory without re-running the full Azure pipeline.

.PARAMETER TranscriptExportPath
    Path to the TranscriptExport folder. Defaults to sibling of the pipeline package.

.PARAMETER WorkerUrl
    Cloudflare Runtime Worker URL.

.PARAMETER DryRun
    If set, shows what would be submitted without actually POSTing.

.EXAMPLE
    $env:CLOUDFLARE_SUBMISSION_TOKEN = "your-token"
    .\backfill-from-transcriptexport.ps1 -DryRun
    .\backfill-from-transcriptexport.ps1
#>

param(
    [string]$TranscriptExportPath = (Join-Path $PSScriptRoot "../../packages/pipeline/TranscriptExport"),
    [string]$WorkerUrl = "https://eip-cloudflare-runtime.homeassistant-8d3.workers.dev",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$token = $env:CLOUDFLARE_SUBMISSION_TOKEN
if (-not $token) {
    throw "CLOUDFLARE_SUBMISSION_TOKEN environment variable is not set."
}

$resolvedPath = Resolve-Path $TranscriptExportPath -ErrorAction Stop
$transcriptFiles = Get-ChildItem -Path $resolvedPath -Filter "*.txt" |
    Where-Object { $_.Name -notmatch "People|Summary|master" } |
    Sort-Object Name

Write-Host ""
Write-Host "EIP Cloudflare Runtime — Historical Backfill" -ForegroundColor Cyan
Write-Host "Transcript folder: $resolvedPath" -ForegroundColor Gray
Write-Host "Files to submit:   $($transcriptFiles.Count)" -ForegroundColor Gray
Write-Host "Worker URL:        $WorkerUrl" -ForegroundColor Gray
if ($DryRun) { Write-Host "DRY RUN — no submissions will be made" -ForegroundColor Yellow }
Write-Host ""

$successCount = 0
$skipCount = 0
$failCount = 0
$index = 0

foreach ($file in $transcriptFiles) {
    $index++
    $name = $file.BaseName

    # Parse date and subject from filename e.g. 2026-07-20_0800-Weekly_RD_update
    $dateMatch = $name -match '^(\d{4}-\d{2}-\d{2})_(\d{4})-(.+)$'
    if (-not $dateMatch) {
        Write-Host "[$index/$($transcriptFiles.Count)] SKIP (unparseable filename): $name" -ForegroundColor Yellow
        $skipCount++
        continue
    }
    $date = $Matches[1]
    $time = $Matches[2]
    $subjectRaw = $Matches[3]
    $subject = $subjectRaw -replace '_', ' ' -replace '-', ' '
    $eventDate = "${date}T$($time.Substring(0,2)):$($time.Substring(2,2)):00Z"
    $meetingId = $name

    Write-Host "[$index/$($transcriptFiles.Count)] $meetingId" -ForegroundColor White
    Write-Host "  Subject: $subject | Date: $eventDate" -ForegroundColor Gray

    if ($DryRun) {
        Write-Host "  [DRY RUN] Would POST to $WorkerUrl/v1/meetings" -ForegroundColor Yellow
        $successCount++
        continue
    }

    $transcript = Get-Content -Path $file.FullName -Raw
    if ($transcript.Trim().Length -lt 50) {
        Write-Host "  [SKIP] Transcript too short ($($transcript.Trim().Length) chars)" -ForegroundColor Yellow
        $skipCount++
        continue
    }

    $payload = @{
        meetingId    = $meetingId
        sourceSystem = "azure"
        nativeId     = $meetingId
        subject      = $subject
        organiser    = "backfill@eip"
        eventDate    = $eventDate
        transcript   = $transcript
    } | ConvertTo-Json -Compress

    try {
        $response = Invoke-RestMethod `
            -Uri "$WorkerUrl/v1/meetings" `
            -Method POST `
            -Headers @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" } `
            -Body $payload `
            -ErrorAction Stop

        $state = $response.state ?? $response.status ?? "accepted"
        $alreadyExists = $response.already_exists ?? $false
        if ($alreadyExists) {
            Write-Host "  [SKIP] Already submitted (state: $state)" -ForegroundColor Gray
            $skipCount++
        } else {
            Write-Host "  [OK] Submitted (state: $state)" -ForegroundColor Green
            $successCount++
        }
    } catch {
        Write-Host "  [FAIL] $($_.Exception.Message)" -ForegroundColor Red
        $failCount++
    }

    # Brief pause to avoid flooding the queue
    Start-Sleep -Milliseconds 300
}

Write-Host ""
Write-Host "Backfill complete: $successCount submitted, $skipCount skipped, $failCount failed" -ForegroundColor Cyan
Write-Host ""
Write-Host "Allow 3-5 minutes for queue processing, then check D1:"
Write-Host "  cd packages/cloudflare-runtime"
Write-Host "  npx wrangler d1 execute eip-cloudflare-runtime --remote --command `"SELECT state, COUNT(*) as count FROM meetings GROUP BY state`""
