# Product-context grounding helpers.
# Pure functions only: no network calls, file writes, or pipeline side effects.

function Resolve-ProductContext {
    [CmdletBinding()]
    param(
        [string]$Subject,
        [string]$Organiser = "",
        [string]$Transcript = "",
        [object]$ExecutionContextsConfig,
        [object]$PeopleConfig,
        [object]$MappingRules
    )

    $text = if ($Transcript) { $Transcript } else { "" }
    $subjectValue = if ($null -ne $Subject) { [string]$Subject } else { "" }
    $subjectLower = $subjectValue.ToLowerInvariant()
    $contextRule = $null
    $contextName = ""

    foreach ($rule in @($ExecutionContextsConfig.ContextDetectionRules)) {
        foreach ($pattern in @($rule.subject_patterns)) {
            if ($pattern -and $subjectLower.Contains($pattern.ToString().ToLowerInvariant())) {
                $contextRule = $rule
                $contextName = [string]$rule.context
                break
            }
        }
        if ($contextRule) { break }
    }

    if (-not $contextRule) {
        $organiserValue = if ($null -ne $Organiser) { [string]$Organiser } else { "" }
        $organiserLower = $organiserValue.ToLowerInvariant()
        foreach ($rule in @($ExecutionContextsConfig.ContextDetectionRules)) {
            foreach ($pattern in @($rule.organiser_patterns)) {
                if ($pattern -and $organiserLower.Contains($pattern.ToString().ToLowerInvariant())) {
                    $contextRule = $rule
                    $contextName = [string]$rule.context
                    break
                }
            }
            if ($contextRule) { break }
        }
    }

    $productConfig = if ($contextRule -and $contextRule.PSObject.Properties.Name -contains "product_context") {
        $contextRule.product_context
    } else { $null }

    $candidates = @{}
    foreach ($product in @($productConfig.products)) {
        if (-not $product.name) { continue }
        $candidates[[string]$product.name] = [pscustomobject]@{
            Product = [string]$product.name
            Score = 0
            Evidence = [System.Collections.Generic.List[object]]::new()
            Direct = $false
        }
    }

    $productAliases = @{}
    foreach ($product in @($productConfig.products)) {
        if ($product.name) { $productAliases[[string]$product.name] = @($product.aliases) }
    }

    $directProducts = [System.Collections.Generic.List[string]]::new()
    foreach ($name in @($candidates.Keys)) {
        $candidate = $candidates[$name]
        $definition = @($productConfig.products | Where-Object { $_.name -eq $name })[0]
        foreach ($alias in @($definition.aliases)) {
            if ($alias -and $text -match [regex]::Escape([string]$alias)) {
                $candidate.Direct = $true
                $candidate.Score += 100
                $candidate.Evidence.Add([pscustomobject]@{
                    Type = "explicit_transcript_identity"
                    Product = $name
                    CueId = "alias:$alias"
                    Weight = 100
                    Match = [string]$alias
                })
                if (-not $directProducts.Contains($name)) { $directProducts.Add($name) }
                break
            }
        }
    }

    foreach ($name in @($candidates.Keys)) {
        $candidate = $candidates[$name]
        $definition = @($productConfig.products | Where-Object { $_.name -eq $name })[0]
        foreach ($cue in @($definition.distinctive_cues)) {
            $matched = $false
            foreach ($pattern in @($cue.patterns)) {
                if ($pattern -and $text -match [regex]::Escape([string]$pattern)) {
                    $matched = $true
                    break
                }
            }
            if ($matched) {
                $weight = if ($cue.weight) { [int]$cue.weight } else { 1 }
                $candidate.Score += $weight
                $candidate.Evidence.Add([pscustomobject]@{
                    Type = "distinctive_transcript_cue"
                    Product = $name
                    CueId = [string]$cue.id
                    Weight = $weight
                    Match = ($cue.patterns -join ", ")
                })
            }
        }
    }

    $defaultProduct = [string]$productConfig.default_product
    if ($defaultProduct -and $candidates.ContainsKey($defaultProduct)) {
        $candidate = $candidates[$defaultProduct]
        $defaultWeight = if ($productConfig.default_weight) { [int]$productConfig.default_weight } else { 2 }
        $candidate.Score += $defaultWeight
        $candidate.Evidence.Add([pscustomobject]@{
            Type = "meeting_series_default"
            Product = $defaultProduct
            CueId = "context:$contextName"
            Weight = $defaultWeight
            Match = $Subject
        })
    }

    $ordered = @($candidates.Values | Sort-Object Score -Descending)
    $selected = $null
    $state = "ambiguous"
    $conflicts = [System.Collections.Generic.List[object]]::new()

    if ($directProducts.Count -eq 1) {
        $selected = $directProducts[0]
        $state = "confirmed"
    } elseif ($directProducts.Count -gt 1) {
        $state = "ambiguous"
        $conflicts.Add([pscustomobject]@{
            Type = "multiple_direct_products"
            Products = @($directProducts)
        })
    } elseif ($ordered.Count -gt 0 -and $ordered[0].Score -ge [int]$(if ($productConfig.likely_threshold) { $productConfig.likely_threshold } else { 5 })) {
        $selected = $ordered[0].Product
        $state = "likely"
    }

    if ($selected -and $defaultProduct -and $selected -ne $defaultProduct -and $directProducts.Count -eq 1) {
        $conflicts.Add([pscustomobject]@{
            Type = "series_default_overridden_by_direct_evidence"
            DefaultProduct = $defaultProduct
            DirectProduct = $selected
        })
    }

    $allowedWording = switch ($state) {
        "confirmed" { "Use the confirmed product name when supported by the transcript."; break }
        "likely" { if ($selected) { "Use only qualified wording such as 'likely $selected programme'; do not use the product as an unqualified canonical label." } else { "Use neutral wording." }; break }
        default { "Use neutral wording such as 'the device' or 'the programme'; do not name a product." }
    }

    [pscustomobject]@{
        Context = $contextName
        State = $state
        SelectedProduct = $selected
        Confidence = switch ($state) { "confirmed" { "High" }; "likely" { "Medium" }; default { "Low" } }
        AllowedWording = $allowedWording
        Candidates = @($ordered | ForEach-Object {
            [pscustomobject]@{ Product = $_.Product; Score = $_.Score; EvidenceCount = $_.Evidence.Count }
        })
        ProductAliases = $productAliases
        Evidence = @($ordered | ForEach-Object { $_.Evidence })
        Conflicts = @($conflicts)
        ConfigVersion = if ($productConfig.version) { [string]$productConfig.version } else { "unversioned" }
    }
}

function Get-ProductGroundingBlock {
    param([object]$ProductContext)
    $evidenceLines = @($ProductContext.Evidence | Select-Object -First 12 | ForEach-Object {
        "- $($_.Type): $($_.CueId) (match: $($_.Match))"
    })
    if ($evidenceLines.Count -eq 0) { $evidenceLines = @("- No product evidence was established.") }
    $candidateLines = @($ProductContext.Candidates | ForEach-Object {
        "- $($_.Product): score=$($_.Score), evidence_count=$($_.EvidenceCount)"
    })
    @"

==================================================
PRODUCT CONTEXT GROUNDING — MANDATORY
==================================================
State: $($ProductContext.State)
Selected product: $(if ($ProductContext.SelectedProduct) { $ProductContext.SelectedProduct } else { "none" })
Confidence: $($ProductContext.Confidence)
Allowed wording: $($ProductContext.AllowedWording)
Candidates:
$($candidateLines -join "`n")
Evidence:
$($evidenceLines -join "`n")
Rules:
- Product references must be evidence-supported.
- Direct transcript identity overrides meeting-series defaults.
- Do not substitute a different product based on generic NPI language.
- If state is ambiguous, use neutral wording and do not guess.
==================================================
"@
}

function Test-ProductAttribution {
    param(
        [object]$ProductContext,
        [string]$Transcript,
        [string]$Summary,
        [object[]]$Records
    )
    $outputText = (($Summary, ($Records | ConvertTo-Json -Depth 20)) -join "`n")
    $unsupported = [System.Collections.Generic.List[object]]::new()
    foreach ($candidate in @($ProductContext.Candidates)) {
        if (-not $candidate.Product) { continue }
        $aliases = if ($ProductContext.ProductAliases -and $ProductContext.ProductAliases.ContainsKey($candidate.Product)) {
            @($ProductContext.ProductAliases[$candidate.Product])
        } else { @() }
        if ($ProductContext.State -eq "ambiguous" -or ($ProductContext.State -eq "likely" -and $candidate.Product -ne $ProductContext.SelectedProduct)) {
            foreach ($alias in $aliases) {
                if ($outputText -match [regex]::Escape([string]$alias)) {
                    $unsupported.Add([pscustomobject]@{ Product = $candidate.Product; Reason = "product_not_allowed_by_resolved_context"; Match = $alias })
                }
            }
        }
    }
    [pscustomobject]@{
        State = if ($unsupported.Count -gt 0) { "needs_review" } elseif ($ProductContext.State -eq "ambiguous") { "needs_review" } else { "passed" }
        UnsupportedReferences = @($unsupported)
        ProductContextState = $ProductContext.State
    }
}
