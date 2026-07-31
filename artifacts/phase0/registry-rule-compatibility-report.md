# Phase 0 — Registry and Rule Compatibility Report

> **Status:** Draft compatibility assessment
> **Scope:** Comparison only. This report authorises no configuration change.
> **Compared:** [`EIP_Taxonomy_v2.md`](../../specification%20and%20plans/EIP_Taxonomy_v2.md:1), [`taxonomy.json`](../../config/taxonomy.json:1), and [`mapping_rules.json`](../../config/mapping_rules.json:1).

## 1. Decision

The proposed semantic contract is frozen for review as version `2.0.0-draft.1`. The existing JSON files remain the deployed machine registry and heuristic configuration until the v2 contract, migration plan, and regression fixtures are approved together.

## 2. Compatibility Summary

| Area | Assessment | Required disposition before implementation |
|---|---|---|
| Controlled domains | Incompatible | Migrate the registry to v2 codes and primary-domain assignments |
| Topic identities | Partially compatible | Make IDs explicit and add `T19`/`T20` for legacy `AI`/`Data` |
| Topic labels | Compatible | Retain labels as display names; introduce stable IDs as keys/references |
| Topic families | Partially compatible | Add `Finance` and `Governance`; reconcile `T03` as Customer and `T05`–`T07` as Delivery |
| Context types | Compatible | Retain values; enforce v2 boundary rules in prompts and validation |
| Categories | Partially compatible | Add `Assumption`; remove non-canonical rule hints from classification output |
| Tags | Compatible | Retain as initial controlled set; validate tag use independently of class dimensions |
| Processing order | Incompatible/undefined | Enforce `ContextType → Topic → Category → enrichment` in code, prompts, and tests |
| Matching and identity | Incompatible | Add evidence/case provenance and human-review controls before automated linking/merging |

## 3. Registry Findings

### 3.1 Metadata-axis terminology

[`taxonomy.json`](../../config/taxonomy.json:4) describes a “canonical 9-axis metadata schema”, but its `MetadataAxes` array contains 13 values. It also mixes classification, presentation, status, ownership, and impact fields.

**Migration:** replace the “9-axis” claim with a versioned contract reference. Store v2 classification dimensions (`DOMAIN`, `TOPIC_FAMILY`, `TOPIC_ID`, `CATEGORY`, `CONTEXT_TYPE`, `TAGS`) separately from enrichment and governance attributes.

### 3.2 Domain inconsistency

The declared registry domains omit `Strategy`, despite the T15–T17 topic entries using it. The declared list includes `Sales`, `Marketing`, `IT`, and `SupplyChain`, but no current topic uses them as its primary domain.

**Migration:** adopt the v2 domain codes as the canonical list. Preserve removed legacy domain labels as source mappings or affected-domain enrichment, not as silent reinterpretations.

### 3.3 Topic identity and domain migration

| Legacy topic | Legacy primary domain | Proposed v2 ID / primary domain | Compatibility action |
|---|---|---|---|
| Delivery Progress & Readiness | Governance | `T05` / DELIVERY | Reclassify primary domain; retain legacy source record for lineage |
| Delivery Risk & Constraints | Governance | `T06` / DELIVERY | Reclassify primary domain; retain legacy source record for lineage |
| Development Execution | Product | `T07` / DELIVERY | Reclassify primary domain; retain legacy source record for lineage |
| Revenue & Commercial Performance | Finance | `T10` / COMMERCIAL | Reclassify primary domain; retain finance as impact/enrichment where applicable |
| Product Value & Perception | Product | `T03` / PRODUCT, Customer family | Change family only |
| AI | Technology | `T19` / TECHNOLOGY | Add explicit stable ID; retain `AI` as display label/alias |
| Data | Technology | `T20` / TECHNOLOGY | Add explicit stable ID; retain `Data` as display label/alias |

All other legacy topic concepts map one-to-one to their same-numbered v2 identifier. The current registry's name-keyed representation is not sufficient as a durable identity contract.

### 3.4 No fallback classification

Older materials identify `T15` as a fallback. The proposed contract prohibits this because it turns uncertainty into false strategic evidence.

**Migration:** introduce an explicit `unclassified` review result with evidence and reason. It is not a canonical topic and must not be aggregated as one.

## 4. Mapping Rule Findings

### 4.1 Non-canonical category hints

The rule file uses `Execution`, `Problem`, `Learning`, and `Governance` in `CategoryHints`; none are canonical v2 categories.

| Legacy hint | Proposed handling |
|---|---|
| `Problem` | Candidate `Issue` only when the excerpt states a realised adverse condition; otherwise review |
| `Learning` | Candidate `Insight` when the excerpt contains an evidenced interpretation or lesson |
| `Execution` | Do not map directly. Classify actual work as `Action`, reported work as `Progress`, and stated reliance as `Dependency` |
| `Governance` | Do not map directly. Use `Decision`, `Strategy`, or governance enrichment depending on the asserted content |

The remaining hints `Risk`, `Opportunity`, and `Strategy` map directly but remain heuristic suggestions, not output authority.

### 4.2 Context and category are currently conflated

The deployed rules are topic keyword matchers and do not define the required two-dimensional semantic test. In particular, a mention of “risk”, “decision”, or “action” can currently bias topic selection without first determining whether the source is a concern, proposal, authorised decision, commitment, or update.

**Migration:** prompts and deterministic validation must apply the v2 order, record reasons, and reject invalid/ambiguous combinations for review.

### 4.3 Context-specific topic promotion/demotion

`NpiContextGuard` promotes/demotes topics based on meeting context. This remains potentially useful as a scoring heuristic, but it cannot supersede evidence-level classification or silently alter a topic case.

**Migration:** retain it as a versioned candidate-generation heuristic with its context, score, and reason retained in the matching provenance. Validate it against fixtures before use.

### 4.4 Brand and supplier integrity rules

The product/brand, supplier, and person conflict rules are compatible with the v2 evidence requirement as validation signals. They require structured provenance: the triggering evidence, affected entity, rule version, severity, and reviewer outcome.

## 5. Required Implementation Package (Deferred)

Once v2 is approved, the implementation change set MUST contain:

1. A new versioned machine registry reflecting the v2 domain, family, ID, category, and tag vocabulary.
2. A rules migration that converts non-canonical hints to reviewable candidate semantics.
3. Prompt and code changes enforcing `ContextType → Topic → Category → enrichment`.
4. Schema support for immutable evidence, topic cases, claims, review events, and idempotency keys.
5. Regression fixtures covering all changed topic/domain mappings, boundary distinctions, unclassified outcomes, and rule integrity alerts.
6. A documented backfill strategy that preserves legacy identifiers and source lineage.

## 6. Acceptance Gates

This compatibility report is complete when reviewed alongside the fixture set. It does **not** complete the Phase 0 exit criteria until two reviewers achieve the agreed consistency threshold on representative excerpts and an initial system-of-record decision is approved.
