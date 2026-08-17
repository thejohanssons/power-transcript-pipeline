# Regression checks for Master Log identity and durable-publication deduplication.
# Run from the repository root:
#   pwsh -NoProfile -File packages/pipeline/tests/master-log-deduplication-regression.ps1

$ErrorActionPreference = 'Stop'
$pipelinePath = Join-Path $PSScriptRoot '../power-transcript-pipeline.ps1'
$pipelinePath = [System.IO.Path]::GetFullPath($pipelinePath)

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $pipelinePath,
    [ref]$tokens,
    [ref]$parseErrors
)
if ($parseErrors.Count) {
    throw ($parseErrors | Out-String)
}

$requiredFunctions = @(
    'Get-MeetingSubjectKey',
    'Test-DurableMasterLogEntry',
    'Find-MasterLogMeetingMatch',
    'Add-CalendarIdentityToMasterLogEntry',
    'Get-StickyMasterLogValue'
)

foreach ($definition in $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -in $requiredFunctions
}, $true)) {
    Invoke-Expression $definition.Extent.Text
}

$legacyEntry = [pscustomobject]@{
    MeetingId      = '2026-08-12_0700_ppwr_discussion'
    Subject        = 'PPWR Discussion'
    EventDate      = '2026-08-12T07:00:00Z'
    Status         = 'success'
    TranscriptFile = 'https://sharepoint.example/transcript'
    SummaryFile    = 'https://sharepoint.example/summary'
}

$legacyMatch = Find-MasterLogMeetingMatch `
    -Meetings @($legacyEntry) `
    -GraphEventId 'graph-event-1' `
    -GraphICalUId 'ical-1' `
    -LegacyMeetingId '2026-08-12_0800_ppwr_discussion' `
    -EventDate '2026-08-12T08:00:00Z' `
    -Subject 'PPWR Discussion'

if (-not $legacyMatch -or $legacyMatch.MatchType -ne 'legacy_subject_time_window') {
    throw 'Expected a unique legacy subject/time-window migration match.'
}

Add-CalendarIdentityToMasterLogEntry `
    -Entry $legacyEntry `
    -GraphEventId 'graph-event-1' `
    -GraphICalUId 'ical-1' `
    -CanonicalMeetingId '2026-08-12_0800_ppwr_discussion' `
    -MatchType $legacyMatch.MatchType

if ($legacyEntry.MeetingId -ne '2026-08-12_0800_ppwr_discussion') {
    throw 'Expected canonical MeetingId after legacy migration.'
}
if ($legacyEntry.GraphEventId -ne 'graph-event-1' -or $legacyEntry.GraphICalUId -ne 'ical-1') {
    throw 'Expected persisted Graph identities after legacy migration.'
}
if ($legacyEntry.LegacyMeetingIds -notcontains '2026-08-12_0700_ppwr_discussion') {
    throw 'Expected previous MeetingId to be retained as a legacy identity.'
}

$stableMatch = Find-MasterLogMeetingMatch `
    -Meetings @($legacyEntry) `
    -GraphEventId 'graph-event-1' `
    -GraphICalUId 'ical-1' `
    -LegacyMeetingId 'unused' `
    -EventDate '2026-08-12T08:00:00Z' `
    -Subject 'Renamed PPWR Discussion'

if (-not $stableMatch -or $stableMatch.MatchType -ne 'graph_event_id') {
    throw 'Expected a Graph event ID match even when the subject changes.'
}

$incompleteEntry = [pscustomobject]@{
    Status         = 'success'
    TranscriptFile = $null
    SummaryFile    = 'https://sharepoint.example/summary'
}
if (Test-DurableMasterLogEntry -Entry $incompleteEntry) {
    throw 'An incomplete publication must not be considered deduplicable success.'
}

$runEntry = [pscustomobject]@{ TranscriptFile = 'https://sharepoint.example/new-transcript' }
if ((Get-StickyMasterLogValue -NewValue $runEntry.TranscriptFile -ExistingEntry $legacyEntry -PropertyName 'TranscriptFile') -ne 'https://sharepoint.example/new-transcript') {
    throw 'The Master Log merge must retain the processing result TranscriptFile.'
}

Write-Output 'Master Log deduplication regression checks passed'
