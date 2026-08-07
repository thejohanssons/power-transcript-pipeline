<#
.SYNOPSIS
    Migrates the 9 real meeting records from the staging Runtime Shadow to production.
    Reads each manifest from staging R2 and resubmits it to the production Worker,
    which reclassifies under v0.2 taxonomy and creates fresh D1 rows.

.NOTES
    Run from packages/runtime-shadow/ directory.
    Requires: SHADOW_CONTINUOUS_SUBMISSION_TOKEN set as environment variable
              (the production Worker's submission token).
    Skips: the remote-smoke test record (not real meeting data).

.EXAMPLE
    $env:SHADOW_CONTINUOUS_SUBMISSION_TOKEN = "your-production-token"
    .\migrate-staging-to-production.ps1
#>

param(
    [string]$ProductionWorkerUrl = "https://eip-runtime-shadow.homeassistant-8d3.workers.dev",
    [string]$StagingBucket = "eip-runtime-shadow-staging-fixtures",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$token = $env:SHADOW_CONTINUOUS_SUBMISSION_TOKEN
if (-not $token) {
    throw "SHADOW_CONTINUOUS_SUBMISSION_TOKEN environment variable is not set. Set it to the production Worker submission token."
}

# The 9 real meeting manifest keys to migrate (excludes smoke test)
$manifestKeys = @(
    "azure-export-manifests/azure-2026-08-04_0900_discussion_on_required_dashboard_modifications.json",
    "azure-export-manifests/azure-2026-08-03_1030_npi_stage_2___biweekly.json",
    "azure-export-manifests/azure-2026-08-04_1130_payment_strategy.json",
    "azure-export-manifests/azure-2026-08-05_0700_sales_call.json",
    "azure-export-manifests/azure-2026-08-04_0900_exco_discussion___lunch.json",
    "azure-export-manifests/azure-2026-08-04_0700_squid_call___bd_focus___general_focus.json",
    "azure-export-manifests/azure-2026-08-04_0600_general_on_compliance.json",
    "azure-export-manifests/azure-2026-08-05_0400_mandar_peter__channel_meeting_.json"
    # azure-2026-08-04_0800_weekly_r_d_update (manifest key not retrieved — may be missing from staging)
)

$endpoint = "$ProductionWorkerUrl/v1/azure-export-runs"
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }

Write-Host ""
Write-Host "Runtime Shadow — Staging → Production Migration" -ForegroundColor Cyan
Write-Host "Production Worker: $ProductionWorkerUrl" -ForegroundColor Gray
Write-Host "Records to migrate: $($manifestKeys.Count)" -ForegroundColor Gray
if ($DryRun) { Write-Host "DRY RUN — no submissions will be made" -ForegroundColor Yellow }
Write-Host ""

$successCount = 0
$skipCount = 0
$failCount = 0

foreach ($manifestKey in $manifestKeys) {
    $meetingId = [System.IO.Path]::GetFileNameWithoutExtension($manifestKey) -replace '^azure-export-manifests/', ''
    Write-Host "[$($manifestKeys.IndexOf($manifestKey) + 1)/$($manifestKeys.Count)] $meetingId" -ForegroundColor White

    # Read manifest from staging R2
    Write-Host "  Reading from staging R2..." -ForegroundColor Gray
    $tmpFile = [System.IO.Path]::GetTempFileName()
    try {
        $result = npx wrangler r2 object get "$StagingBucket/$manifestKey" --remote --pipe 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [SKIP] Could not read from staging R2: $result" -ForegroundColor Yellow
            $skipCount++
            continue
        }
        $manifestJson = $result | Out-String

        # Parse to verify it's valid JSON
        $manifest = $manifestJson | ConvertFrom-Json
        $packageId = $manifest.packageId
        if (-not $packageId) {
            Write-Host "  [SKIP] Manifest has no packageId" -ForegroundColor Yellow
            $skipCount++
            continue
        }

        # Append -migration suffix to packageId to avoid idempotency conflicts
        # if the same manifest was previously submitted to production
        $migratedPackageId = "$packageId-migration"
        $manifest.packageId = $migratedPackageId
        $migratedJson = $manifest | ConvertTo-Json -Depth 20 -Compress

        Write-Host "  PackageId: $migratedPackageId" -ForegroundColor Gray

        if ($DryRun) {
            Write-Host "  [DRY RUN] Would POST to $endpoint" -ForegroundColor Yellow
            $successCount++
            continue
        }

        # Submit to production Worker
        $response = Invoke-RestMethod -Uri $endpoint -Method POST -Headers $headers -Body $migratedJson -ErrorAction SilentlyContinue -ErrorVariable restError
        if ($restError) {
            Write-Host "  [FAIL] $restError" -ForegroundColor Red
            $failCount++
        } else {
            $runId = $response.runId ?? $response.run_id ?? "(no runId)"
            Write-Host "  [OK] runId=$runId" -ForegroundColor Green
            $successCount++
        }
    } catch {
        Write-Host "  [FAIL] $_" -ForegroundColor Red
        $failCount++
    } finally {
        if (Test-Path $tmpFile) { Remove-Item $tmpFile -Force }
    }

    # Brief pause between submissions to avoid queue flooding
    Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "Migration complete: $successCount succeeded, $skipCount skipped, $failCount failed" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next: wait ~5 minutes for the production Worker to process the queue,"
Write-Host "then check D1: npx wrangler d1 execute eip-runtime-shadow --remote --command `"SELECT package_id, state, comparison_status, blocking_count, material_count FROM azure_export_runs ORDER BY created_at DESC`""
