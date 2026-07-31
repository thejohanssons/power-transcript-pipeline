# EIP Taxonomy and Memory Contract v2

> **Document status:** Draft — proposed normative semantic contract
> **Version:** 2.0.0-draft.1
> **Scope:** Phase 0 sandbox proposal only; it is not approved and does not alter deployed extraction or storage behaviour.

## 1. Authority, Purpose, and Normative Language

This contract defines the semantic model needed to turn source evidence into durable organisational memory. On approval, it governs controlled vocabulary, entity boundaries, identity, evidence provenance, classification semantics, and change compatibility. It implements Phase 0 of [the roadmap](WIP-roadmap.md:113) and is subordinate to that roadmap.

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative. Until approved, [the current registry](../config/taxonomy.json:1) and [matching rules](../config/mapping_rules.json:1) remain deployed-state configuration, not this contract's implementation.

## 2. Design Rules

1. **Topic-first:** a canonical taxonomy topic is a stable configured business concept; it is not a meeting, claim, or live programme instance.
2. **Evidence-backed:** every extracted claim MUST retain immutable, source-addressable evidence.
3. **Deterministic spine:** processing order is `ContextType → Topic → Category → enrichment`.
4. **No silent identity mutation:** matching MAY propose a topic-case link or merge; it MUST NOT automatically create, merge, or rename a canonical taxonomy topic.
5. **Append-only history:** assertions, corrections, reviews, state changes, and merge decisions are events. Current state is a reproducible projection.
6. **Controlled change:** semantic changes require an approved version, migration assessment, and regression fixtures.

## 3. Canonical Entity Model

| Entity | Meaning | Stable identity | Mutable state permitted? |
|---|---|---|---|
| Canonical taxonomy topic | Configured business concept used to classify evidence | `topic_id` | No; a replacement is a versioned taxonomy change |
| Topic case | A particular live initiative, concern, decision thread, or recurring matter associated with one or more taxonomy topics | `case_id` | Only through append-only state events |
| Evidence item | Immutable source artefact or a precisely located source fragment | `evidence_id` | No; a new source version is new evidence |
| Claim | An extracted, reviewable assertion grounded in evidence | `claim_id` | No; corrections/supersession are events |
| Decision record | Claim aggregate representing a decision and its rationale, assumptions, dependencies, actions, risks, and outcome | `decision_id` | Projection only; history is append-only |
| ExCo governance item | Material record requiring ExCo visibility or intervention | `governance_item_id` | Projection only; governance changes are events |
| Memory event | Immutable record of extraction, review, correction, merge, or lifecycle change | `event_id` | No |

A claim MUST reference at least one `evidence_id` and one `case_id`. A case MUST reference at least one `topic_id`. A decision record and governance item MUST reference their contributing claims and evidence. A canonical topic MUST NOT be used as a substitute for a live topic case.

## 4. Identity and Evidence Contract

### 4.1 Required evidence anchors

Every evidence item MUST contain:

| Field | Requirement |
|---|---|
| `evidence_id` | Globally unique, stable EIP identifier |
| `source_system` | Source platform, for example `m365_teams` |
| `source_native_id` | Immutable source-native artefact identifier |
| `source_locator` | Replayable artefact/fragment locator, including timestamp or line/segment range where available |
| `occurred_at` | Source event time in ISO-8601 UTC, or an explicitly marked source-time fallback |
| `content_hash` | Hash of exact extracted content or immutable source version |
| `ingested_at` | EIP ingestion time in ISO-8601 UTC |
| `source_version` | Native version/ETag where supplied; otherwise a derived version identifier |
| `confidence` | Extraction confidence from 0.00 to 1.00 |
| `access_classification` | Source handling/access label |

The tuple `source_system + source_native_id + source_locator + content_hash` is the idempotency basis for evidence ingestion. Re-ingestion of the same tuple MUST return the existing evidence identity; changed source content MUST create a new evidence item linked by a supersession event.

### 4.2 Case identity and matching

A case is created only where the evidence concerns a distinguishable live matter. A case identity MUST have a human-readable title, one or more canonical topics, creation evidence, and a lifecycle state. Candidate links require provenance, matching method, score, threshold version, and reviewer disposition.

Automated matching may attach evidence to an existing case only when the approved threshold and policy permit it. Otherwise it MUST create a reviewable candidate case/link. Case merges require an explicit append-only merge event; original identifiers and provenance remain resolvable.

## 5. Controlled Classification Vocabulary

### 5.1 Domains

`DOMAIN` identifies the primary organisational value stream or accountable business area. Allowed values are:

| Code | Name |
|---|---|
| `PRODUCT` | Product strategy, quality, experience, and portfolio |
| `DELIVERY` | Programme execution, readiness, and delivery constraints |
| `COMMERCIAL` | Revenue, sales, market activation, and customer economics |
| `FINANCE` | Liquidity, cost, margin, and financial exposure |
| `PEOPLE` | Organisation, capability, capacity, and workforce |
| `OPERATIONS` | Operational processes, supply, service, and efficiency |
| `TECHNOLOGY` | Technology platforms, data, AI, and technical architecture |
| `GOVERNANCE` | Cross-functional control, decision rights, and executive oversight |
| `STRATEGY` | Enterprise direction, choices, portfolio positioning, and growth |

A topic MUST have one primary domain. A claim MAY additionally identify affected domains during enrichment.

### 5.2 Topic families

`TOPIC_FAMILY` groups related canonical topics. Allowed values: `Product`, `Delivery`, `Commercial`, `Customer`, `People`, `Process`, `Technology`, `Operations`, `Finance`, `Governance`, and `Strategy`.

### 5.3 Canonical topic registry

The proposed v2 registry retains the current 20 business concepts while making topic identifiers explicit. Topic names are labels and may change only through a compatible versioned taxonomy change.

| ID | Canonical topic | Primary domain | Family |
|---|---|---|---|
| `T01` | Product Performance | PRODUCT | Product |
| `T02` | Product Quality & Compliance | PRODUCT | Product |
| `T03` | Product Value & Perception | PRODUCT | Customer |
| `T04` | Product Scope & Prioritisation | PRODUCT | Product |
| `T05` | Delivery Progress & Readiness | DELIVERY | Delivery |
| `T06` | Delivery Risk & Constraints | DELIVERY | Delivery |
| `T07` | Development Execution | DELIVERY | Delivery |
| `T08` | Cash Flow & Liquidity | FINANCE | Finance |
| `T09` | Cost Structure & Margins | FINANCE | Finance |
| `T10` | Revenue & Commercial Performance | COMMERCIAL | Commercial |
| `T11` | Financial Risk & Exposure | FINANCE | Finance |
| `T12` | Organisation & Capability | PEOPLE | People |
| `T13` | Resource Allocation | PEOPLE | People |
| `T14` | Operational Effectiveness | OPERATIONS | Operations |
| `T15` | Strategic Direction & Alignment | STRATEGY | Strategy |
| `T16` | Product-Market Fit | STRATEGY | Strategy |
| `T17` | Growth & Opportunities | STRATEGY | Strategy |
| `T18` | Delivery Confidence | GOVERNANCE | Governance |
| `T19` | Artificial Intelligence | TECHNOLOGY | Technology |
| `T20` | Data | TECHNOLOGY | Technology |

`T19` and `T20` are proposed explicit identifiers for the legacy `AI` and `Data` entries. No fallback topic is permitted: insufficient classification MUST produce an `unclassified` review outcome rather than assignment to a catch-all topic.

### 5.4 Context type

`CONTEXT_TYPE` describes the communicative posture of the source excerpt, independent of what business condition is asserted. Exactly one value is required for an extracted claim:

| Value | Definition |
|---|---|
| `Discussion` | Exploration without a stated proposal, commitment, or conclusion |
| `Update` | Report of a current or completed state |
| `Decision` | Authorised choice or explicit determination |
| `Agreement` | Recorded concurrence without evidence of formal decision authority |
| `Proposal` | Suggested future choice requiring acceptance |
| `Concern` | Expressed worry or uncertainty; not necessarily a risk claim |
| `Commitment` | Stated intent to perform or deliver work |
| `Observation` | Factual observation or measurement |
| `Assumption` | Stated premise treated as true for planning or reasoning |

### 5.5 Category

`CATEGORY` describes the business nature of the claim. Exactly one value is required:

| Value | Definition |
|---|---|
| `Risk` | Uncertain future event or condition with potential adverse effect |
| `Issue` | Existing adverse condition, failure, or realised problem |
| `Action` | Specific work to be performed, with owner/deadline when stated |
| `Decision` | Choice made by an identified authority or governance body |
| `Progress` | Advancement, status, milestone, or measurable movement |
| `Opportunity` | Potential beneficial outcome requiring pursuit or choice |
| `Dependency` | Reliance on an external party, prerequisite, decision, resource, or event |
| `Strategy` | Direction-setting choice, objective, or strategic intent |
| `Insight` | Interpretation or learning derived from evidence |
| `Assumption` | Planning premise whose validity affects an outcome |

### 5.6 Boundary rules

| Distinction | Classification rule |
|---|---|
| Risk vs issue | Use `Risk` for a possible future adverse event; use `Issue` for a condition already happening or evidenced as failed. A concern alone has `ContextType=Concern` and may be categorised as Risk only if an adverse future effect is asserted. |
| Decision vs proposal | A `Proposal` recommends a choice but lacks acceptance. A `Decision` requires stated authority, approval, or unambiguous commitment to the chosen course. |
| Action vs progress | `Action` is work to do. `Progress` reports what has happened or current status. One excerpt may yield both claims only where each is separately evidenced. |
| Commitment vs action | `Commitment` is source posture. It becomes category `Action` only when the committed work is specific enough to be tracked. |
| Assumption vs observation | `Assumption` is unverified premise; `Observation` is presented as fact or measurement. |

### 5.7 Tags

Tags are optional, controlled, and secondary to the dimensions above. Proposed allowed values: `CriticalPath`, `BOM_Risk`, `Revenue_Impacting`, `Customer_Facing`, `Regulatory_Hold`, `AI`, `Automation`, `Strategy`, `Compliance`, `NPI`, `Product`, `Quality`, and `ProcessImprovement`. A tag MUST NOT replace a topic, category, context type, or governance field.

## 6. Governance Contract

### 6.1 Controlled fields

| Field | Allowed values / rule |
|---|---|
| `exco_materiality` | `Inform`, `Monitor`, `Discuss`, `Decide`, `Escalate` |
| `governance_status` | `Open`, `InReview`, `AwaitingDecision`, `Committed`, `OnTrack`, `AtRisk`, `Blocked`, `Closed`, `Superseded` |
| `accountable_executive` | Named accountable person identifier; executive role MAY be retained as supporting context |
| `review_cadence` | `weekly`, `monthly`, `quarterly`, `ad_hoc` |
| `next_review_at` | ISO-8601 date required for material items not Closed or Superseded |
| `required_intervention` | Concrete decision, challenge, endorsement, or escalation required; null only for `Inform` |

`Escalate` requires a stated rationale, accountable executive, and next review. A material item is stale when `next_review_at` has passed without a review event, or no review occurs within 1.5 times its cadence interval. Only a human review event may mark a governance item material or escalated.

### 6.2 Security baseline

Evidence MUST retain source-specific authorisation metadata. Retrieval MUST enforce evidence-level access controls, write an audit event, honour retention requirements, and apply source-required redaction before exposure. The system MUST distinguish withheld/redacted evidence from absent evidence.

## 7. Append-Only Events and Current-State Projection

Allowed event types are `Extracted`, `Reviewed`, `Corrected`, `Superseded`, `CaseLinked`, `CaseMergeProposed`, `CaseMerged`, `GovernanceUpdated`, `Redacted`, and `SourceReprocessed`. Each event MUST identify actor or automation, timestamp, reason, affected entities, and prior-event reference where applicable.

No record is destructively overwritten. A current view is derived by replaying ordered events and applying approved projection rules. A correction MUST retain the original claim and identify the correcting evidence or reviewer rationale.

## 8. Versioning and Change Control

This contract follows semantic versioning:

- **Major:** removes or redefines a controlled value, entity meaning, identity rule, or required field.
- **Minor:** adds a backward-compatible controlled value, field, topic, or clarification.
- **Patch:** corrects non-semantic wording, examples, or formatting.

A semantic change proposal MUST include: decision owner, affected contract sections, migration/backfill impact, machine-registry and rule changes, compatibility result, and regression fixtures. Approval requires the decision rights defined in [spec governance](EIP_Spec_Governance.md:56). No deployment configuration changes are authorised by this draft.

## Appendix A. Legacy Vocabulary Mapping

| Legacy artefact/value | Proposed v2 disposition |
|---|---|
| `Domains` omits `Strategy` while T15–T17 use it | `STRATEGY` is a controlled v2 domain; legacy registry requires later reconciliation |
| Legacy description says “9-axis” but lists 13 metadata axes | v2 separates six controlled classification dimensions from optional enrichment and governance fields; legacy terminology is inaccurate |
| Legacy `Topics` are keyed by labels and omit IDs | v2 assigns stable IDs `T01`–`T20`; `AI` becomes `T19`, `Data` becomes `T20` |
| T05/T06/T07 legacy primary domains | Proposed v2 assigns them to `DELIVERY`; legacy `Governance`/`Product` assignments are retained only as migration input |
| Legacy `Revenue & Commercial Performance` domain `Finance` | Proposed v2 assigns it to `COMMERCIAL`; finance impact is enrichment |
| Legacy `CategoryHints` include `Execution`, `Problem`, `Learning`, `Governance` | These are heuristic-only terms. Map `Problem` → `Issue` where realised, `Learning` → `Insight`, and require adjudication for `Execution`/`Governance` |
| Legacy `ContextTypes` | Retained in v2, with boundary rules added |
| Legacy Categories omit `Assumption` | v2 adds `Assumption` because the roadmap requires explicit assumptions |
| Legacy `T15` fallback behaviour in older specifications | Prohibited. Use an unclassified review outcome |

## Appendix B. Approval Checklist

Before this draft becomes normative:

1. Two reviewers independently classify 10–20 representative excerpts using this vocabulary and resolve disagreement.
2. The machine registry and heuristic rules are reconciled in a separately reviewed change.
3. The initial system-of-record and Azure coexistence contract are approved.
4. Required regression fixtures cover every boundary rule and legacy mapping.
5. Governance decision rights, retention, access, and audit implementation ownership are named.
