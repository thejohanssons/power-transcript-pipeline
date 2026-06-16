param($Timer)

# Role: Daily trigger for meeting transcript processing
# Logic: Imports required Graph modules and dots the pipeline script

Write-Output "Function started at $(Get-Date)"

if ($Timer.IsPastDue) {
    Write-Warning "Timer is running late!"
}

try {
    Write-Output "Starting transcript pipeline..."

    # Dot-sourcing the script to execute in the current scope
    # The pipeline script handles its own authentication via client secret
    # but we can optionally pre-connect here if Managed Identity is available.
    
    if ($env:MSI_ENDPOINT -or $env:IDENTITY_ENDPOINT) {
        Write-Output "Using Managed Identity detected in environment"
        # Pipeline script will skip client-secret logic if already connected
    }

    # Use the absolute path to the pipeline script
    $pipelinePath = Join-Path $PSScriptRoot "../power-transcript-pipeline.ps1"
    
    & $pipelinePath

    Write-Output "Pipeline completed successfully ✅"
}
catch {
    Write-Error "Pipeline failed: $_"
    throw
}