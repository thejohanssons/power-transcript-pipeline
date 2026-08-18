$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ProductContext.ps1')

$execution = Get-Content (Join-Path $PSScriptRoot 'config/execution_contexts.json') -Raw | ConvertFrom-Json
$people = Get-Content (Join-Path $PSScriptRoot 'config/people_config.json') -Raw | ConvertFrom-Json
$rules = Get-Content (Join-Path $PSScriptRoot 'config/mapping_rules.json') -Raw | ConvertFrom-Json

function Assert-Equal($actual, $expected, $message) {
    if ($actual -ne $expected) { throw "$message. Expected '$expected'; got '$actual'." }
}

function Assert-True($condition, $message) {
    if (-not $condition) { throw $message }
}

function Resolve-TestContext([string]$text) {
    Resolve-ProductContext -Subject 'NPI Stage 2 - biweekly' -Organiser 'NPIProcess@scanningpens.com' `
        -Transcript $text -ExecutionContextsConfig $execution -PeopleConfig $people -MappingRules $rules
}

$fixture = Get-Content (Join-Path $PSScriptRoot '../../debug/NPI Stage 2 - biweekly.vtt') -Raw
$npi = Resolve-TestContext $fixture
Assert-Equal $npi.State 'likely' 'NPI Stage 2 should be likely when only distinctive cues are present'
Assert-Equal $npi.SelectedProduct 'SuperPen' 'NPI Stage 2 should select the configured product lens'
Assert-True ($npi.Evidence.Count -ge 3) 'NPI Stage 2 should retain converging evidence'
Assert-True (-not ($fixture -match 'Reader 3|Exam Reader 3')) 'NPI fixture must not contain direct Reader 3 evidence'

$explicitReader = Resolve-TestContext 'The team explicitly agreed the Reader 3 launch date and Reader 3 firmware scope.'
Assert-Equal $explicitReader.State 'confirmed' 'Direct Reader 3 evidence should be confirmed'
Assert-Equal $explicitReader.SelectedProduct 'Reader 3' 'Direct Reader 3 evidence must override the NPI default'
Assert-True ($explicitReader.Conflicts.Count -eq 1) 'Default override should be recorded as a conflict'

$ambiguous = Resolve-TestContext 'The device programme needs a new test plan and launch decision.'
Assert-Equal $ambiguous.State 'ambiguous' 'Generic NPI language should remain ambiguous'
Assert-True (-not $ambiguous.SelectedProduct) 'Ambiguous context must not select a product'

$conflicting = Resolve-TestContext 'SuperPen and Reader 3 are both discussed as separate products.'
Assert-Equal $conflicting.State 'ambiguous' 'Conflicting direct product names should be ambiguous'
Assert-True ($conflicting.Conflicts.Count -ge 1) 'Conflicting direct names must be recorded'

$validation = Test-ProductAttribution -ProductContext $npi -Transcript $fixture `
    -Summary 'The meeting discussed Reader 3 launch readiness.' -Records @()
Assert-Equal $validation.State 'needs_review' 'Unsupported Reader 3 attribution must require review'
Assert-True ($validation.UnsupportedReferences.Product -contains 'Reader 3') 'Reader 3 must be reported as unsupported'

Write-Output 'ProductContext tests passed.'
