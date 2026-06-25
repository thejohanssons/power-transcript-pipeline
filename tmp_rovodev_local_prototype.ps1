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

        # H2: numbered sections like 1. Topics / Context, 2. Signals, ... 9. Trend / Trajectory
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

        # Topic records section header
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

$rawSummary = Get-Content -Path "tmp_rovodev_test_summary.txt" -Raw
$html = Convert-SummaryToConfluenceHtml -SummaryText $rawSummary -Subject "Prototype" -MeetingId "PROTOTYPE-123" -EventDate "2026-06-25" -Organiser "Peter"
$html | Out-File -FilePath "tmp_rovodev_prototype_view.html" -Encoding utf8
Write-Host "SUCCESS: tmp_rovodev_prototype_view.html created ✅"
