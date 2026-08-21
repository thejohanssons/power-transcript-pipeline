# Regression checks for canonical Teams online-meeting transcript selection.
# Run from the repository root:
#   pwsh -NoProfile -File packages/pipeline/tests/transcript-acquisition-regression.ps1

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
    'Get-OrganiserIdFromJoinUrl',
    'Get-VerifiedTranscriptSegments'
)

foreach ($definition in $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -in $requiredFunctions
}, $true)) {
    Invoke-Expression $definition.Extent.Text
}

function New-TranscriptCandidate {
    param(
        [string]$Id,
        [string]$CreatedDateTime,
        [string]$MeetingId
    )

    [pscustomobject]@{
        id = $Id
        createdDateTime = $CreatedDateTime
        meetingId = $MeetingId
    }
}

$eventStart = [datetime]'2026-08-19T09:00:00Z'
$meetingId = 'canonical-meeting-id'

$exactSegments = @(Get-VerifiedTranscriptSegments `
    -Candidates @(
        (New-TranscriptCandidate -Id 'segment-1' -CreatedDateTime '2026-08-19T09:03:00Z' -MeetingId $meetingId),
        (New-TranscriptCandidate -Id 'segment-2' -CreatedDateTime '2026-08-19T10:18:00Z' -MeetingId $meetingId),
        (New-TranscriptCandidate -Id 'other-meeting' -CreatedDateTime '2026-08-19T09:04:00Z' -MeetingId 'different-meeting')
    ) `
    -MeetingId $meetingId `
    -EventStart $eventStart)

if (@($exactSegments.id) -join ',' -ne 'segment-1,segment-2') {
    throw 'Expected only exact meetingId segments inside the session window.'
}

$ambiguousFallback = @(Get-VerifiedTranscriptSegments `
    -Candidates @(
        (New-TranscriptCandidate -Id 'same-day-a' -CreatedDateTime '2026-08-19T09:05:00Z' -MeetingId $null),
        (New-TranscriptCandidate -Id 'same-day-b' -CreatedDateTime '2026-08-19T09:25:00Z' -MeetingId $null)
    ) `
    -MeetingId $meetingId `
    -EventStart $eventStart `
    -CollectionSource 'organiser_get_all_transcripts')

if ($ambiguousFallback.Count -ne 0) {
    throw 'A fallback collection without exact meetingId evidence must be rejected.'
}

$userScopedNearest = @(Get-VerifiedTranscriptSegments `
    -Candidates @(
        (New-TranscriptCandidate -Id 'nearest' -CreatedDateTime '2026-08-19T09:05:00Z' -MeetingId $null),
        (New-TranscriptCandidate -Id 'same-day-other' -CreatedDateTime '2026-08-19T09:35:00Z' -MeetingId $null)
    ) `
    -MeetingId $meetingId `
    -EventStart $eventStart `
    -CollectionSource 'canonical_user_scoped')

if ($userScopedNearest.Count -ne 1 -or $userScopedNearest[0].id -ne 'nearest') {
    throw 'A canonical user-scoped collection without meetingId must return only its nearest candidate.'
}

$outsideGuard = @(Get-VerifiedTranscriptSegments `
    -Candidates @(
        (New-TranscriptCandidate -Id 'far-away' -CreatedDateTime '2026-08-20T09:01:00Z' -MeetingId $meetingId)
    ) `
    -MeetingId $meetingId `
    -EventStart $eventStart)

if ($outsideGuard.Count -ne 0) {
    throw 'Candidates outside the 18-hour occurrence guard must be rejected.'
}

$joinUrl = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting?context=%7B%22Oid%22%3A%22organiser-object-id%22%7D'
if ((Get-OrganiserIdFromJoinUrl -JoinUrl $joinUrl) -ne 'organiser-object-id') {
    throw 'Expected organiser object ID to be read from the encoded Teams join URL.'
}

Write-Output 'Transcript acquisition regression checks passed'
