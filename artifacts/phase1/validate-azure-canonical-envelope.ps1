# Validates canonical-envelope construction without executing the Azure pipeline.
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '../..')
$pipelinePath = Join-Path $repoRoot 'packages/pipeline/power-transcript-pipeline.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($pipelinePath, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) {
    throw "Pipeline parse failed: $($errors[0].Message)"
}

foreach ($functionName in @('Get-TopicMemorySha256', 'New-CanonicalTopicMemoryEnvelope')) {
    $functionAst = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName }, $true) | Select-Object -First 1
    if (-not $functionAst) { throw "Required function was not found: $functionName" }
    . ([scriptblock]::Create($functionAst.Extent.Text))
}

$PIPELINE_VERSION = 'test'
$eventDate = [datetime]'2026-07-22T11:00:00Z'
$transcriptText = 'VAT amount and requested clarification.'
$topicRecords = @(
    [pscustomobject]@{
        ContextType = 'Concern'; Category = 'Risk'; TopicId = 'T11'; Label = 'VAT payment-status clarification'
        Summary = 'A VAT-related amount requires clarification before payment status can be confirmed.'
    },
    [pscustomobject]@{
        ContextType = 'Discussion'; Category = 'Learning'; TopicId = 'T00'; Label = 'Unclassified learning'
        Summary = 'An unclassified candidate preserves a legacy category mapping without a fallback topic.'
    },
    [pscustomobject]@{
        ContextType = 'Invalid'; Category = 'Risk'; TopicId = 'T11'; Label = 'Excluded candidate'
        Summary = 'This invalid controlled value must be omitted.'
    }
)

$first = New-CanonicalTopicMemoryEnvelope -MeetingId 'meeting-123' -EventDate $eventDate -TranscriptText $transcriptText -TopicRecords $topicRecords -ExtractionRunId 'run-123'
$second = New-CanonicalTopicMemoryEnvelope -MeetingId 'meeting-123' -EventDate $eventDate -TranscriptText $transcriptText -TopicRecords $topicRecords -ExtractionRunId 'run-123'

if ($first.submission_id -ne $second.submission_id -or $first.evidence.evidence_id -ne $second.evidence.evidence_id) {
    throw 'Canonical identities are not deterministic.'
}
if ($first.contract_version -ne '2.0.0' -or $first.taxonomy_version -ne '2.0.0') {
    throw 'Canonical contract or taxonomy version is incorrect.'
}
if ($first.claims.Count -ne 2) {
    throw 'Invalid controlled-value candidate was not omitted.'
}
$classified = @($first.claims | Where-Object { $_.classification_status -eq 'Candidate' })[0]
$unclassified = @($first.claims | Where-Object { $_.classification_status -eq 'Unclassified' })[0]
if ($classified.topic_id -ne 'T11' -or $classified.category -ne 'Risk') {
    throw 'Classified candidate is not preserved correctly.'
}
if ($unclassified.topic_id -ne $null -or $unclassified.category -ne 'Insight') {
    throw 'Legacy T00/category mapping did not become an unclassified Insight candidate.'
}
if (-not $first.claims[0].provenance.review_required -or $first.evidence.source_metadata.azure_authoritative -ne $true) {
    throw 'Required review or Azure-authority provenance is missing.'
}

Write-Output 'Azure canonical envelope validation passed: deterministic identity, controlled-value filtering, legacy mapping, and unclassified handling verified.'
