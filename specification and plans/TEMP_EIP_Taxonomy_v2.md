# EIP Taxonomy v2 — Canonical Classification and Memory Contract

**Status:** Proposed → Active when approved
**Version:** 2.0.0
**Effective date:** YYYY-MM-DD
**Owner:** [named taxonomy owner / governance group]
**Machine-readable registry:** [`config/taxonomy.json`](config/taxonomy.json:1)
**Decision log:** [link to governance decision log]

## 1. Purpose and normative language

This specification defines the authoritative semantic contract for EIP classification and organisational-memory records.

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

This document governs:
- classification vocabulary;
- entity identity and relationship rules;
- event-history and evidence requirements;
- compatibility mappings from legacy models; and
- taxonomy change governance.

It does not define extraction prompts, matching thresholds, dashboard design, or storage implementation.

## 2. Scope and precedence

| Rank | Artefact | Authority |
|---|---|---|
| 1 | This specification | Meaning, permitted values, identity rules |
| 2 | [`taxonomy.json`](config/taxonomy.json:17) | Machine-readable registry of permitted values |
| 3 | [`mapping_rules.json`](config/mapping_rules.json:37) | Extraction and candidate-matching heuristics only |
| 4 | Pipeline and API code | Must implement, not redefine, this contract |
| 5 | Historical specifications | Reference-only unless marked Active |

If two artefacts conflict, the higher-ranked artefact prevails. A conflict MUST result in a tracked governance change, not an ad-hoc code exception.

## 3. Canonical information model

### 3.1 Entity definitions

| Entity | Definition | Stable identity | Key rule |
|---|---|---|---|
| Taxonomy Topic | A configured, reusable business concept. | `topic_id`, such as `T06` | Never created by extraction. |
| Topic Case | A specific, time-bounded real-world matter related to one or more taxonomy topics. | `case_id` | May be created from evidence when no existing case matches. |
| Evidence Item | An immutable source artefact or source fragment. | `evidence_id` plus source locator/hash | Never overwritten; corrections create a new evidence item or annotation. |
| Claim | A structured assertion extracted from evidence. | `claim_id` | Must cite one or more evidence anchors. |
| Decision Record | A first-class claim that authorises a chosen course of action. | `decision_id` | Must include decision, authority, date/time, and evidence. |
| Action | A commitment to perform work. | `action_id` | Must have an accountable owner or explicitly state that owner is unknown. |
| Risk | An uncertain event or condition with potential adverse impact. | `risk_id` | Must be distinct from an already materialised issue. |
| Assumption | A belief treated as true without sufficient confirmation. | `assumption_id` | Must be linkable to the decision, risk, or case affected. |
| Relationship | A typed connection between entities. | `relationship_id` | Must preserve provenance and confidence. |

### 3.2 Required distinctions

- A **topic** answers: “What class of organisational concern is this?”
- A **case** answers: “Which particular instance are we tracking?”
- An **evidence item** answers: “What source supports this?”
- A **claim** answers: “What was asserted, agreed, decided, or committed?”

A transcript sentence MUST NOT become a new taxonomy topic merely because its wording is novel. It may create a new topic case under an existing canonical topic.

## 4. Canonical classification axes

### 4.1 Mandatory axes

Every extracted claim MUST have the following fields:

| Field | Cardinality | Meaning | Allowed source |
|---|---:|---|---|
| `domain` | 1 | Primary accountable business domain | Domain registry |
| `topic_id` | 1..n | Applicable canonical topic(s) | Topic registry |
| `category` | 1 | Business object/impact being expressed | Category registry |
| `context_type` | 1 | Communicative role of the source statement | ContextType registry |
| `evidence_ids` | 1..n | Source support | Evidence store |
| `confidence` | 1 | Extraction/matching confidence | Bounded numeric scale |
| `taxonomy_version` | 1 | Vocabulary version applied | This specification |

The pipeline processing order MUST be: **ContextType → Topic → Category → enrichment**. This preserves the separation already intended by [`taxonomy.json`](config/taxonomy.json:17).

### 4.2 Domain registry

The allowed `domain` values are the values in [`taxonomy.json`](config/taxonomy.json:56). Correct the present inconsistency before approval: the topic registry uses `Strategy` in [`taxonomy.json`](config/taxonomy.json:96), but `Strategy` is absent from the declared domain list. Either add it formally or remap those topics to an existing domain; do not leave the model internally invalid.

For every domain, include:

| Domain | Definition | Includes | Excludes | Default governor |
|---|---|---|---|---|
| Product | Product direction, quality, and product delivery | ... | ... | Product Board |

### 4.3 Topic family and canonical topic registry

`topic_family` is a grouping/navigation aid. `topic_id` is the stable classification identifier. Human-readable topic labels may change; the identifier MUST NOT be reused for a different concept.

Each topic entry should state:

| Field | Example |
|---|---|
| `topic_id` | `T06` |
| `label` | Delivery Risk & Constraints |
| `definition` | Risks, constraints, and blockers that threaten delivery. |
| `includes` | Dependencies, bottlenecks, supply constraints, schedule threats. |
| `excludes` | Confirmed defects are usually Product Quality; agreed work is Action. |
| `primary_domain` | Governance |
| `topic_family` | Delivery |
| `allowed_categories` | Risk, Issue, Dependency, Action |
| `example_positive` | “The supplier lead time could delay PVT.” |
| `example_negative` | “We agreed to move PVT to October.” |

Retain the current topic registry as a starting point in [`taxonomy.json`](config/taxonomy.json:81), but add explicit `includes` and `excludes`. Descriptions alone are insufficient to achieve classifier consistency.

### 4.4 Category registry: what organisational object is present?

Adopt the current controlled list in [`taxonomy.json`](config/taxonomy.json:104), with these definitions:

| Category | Definition | Must not be confused with |
|---|---|---|
| Decision | An authorised choice that commits the organisation. | Proposal, Agreement |
| Action | A concrete commitment to perform work. | Progress, Commitment context |
| Risk | An uncertain future event/condition with possible adverse impact. | Issue |
| Issue | A present, observed problem requiring attention. | Risk, Concern context |
| Dependency | Reliance on an external prerequisite, decision, person, or deliverable. | Risk |
| Progress | Evidence of movement, completion, or current delivery state. | Update context |
| Opportunity | A potential beneficial outcome. | Strategy |
| Strategy | Direction, prioritisation, or longer-term intended approach. | Decision |
| Insight | A learned interpretation, observation, or analytical conclusion. | Observation context |

A claim MUST have exactly one category. If a source contains both an issue and an action, it MUST produce two linked claims.

### 4.5 ContextType registry: how was it expressed?

Use the allowed values in [`taxonomy.json`](config/taxonomy.json:116). Context type MUST describe discourse role, never business impact.

| ContextType | Meaning | Example |
|---|---|---|
| Discussion | Exploration without a recorded outcome | “We discussed alternative suppliers.” |
| Update | Report of current state | “DVT is two weeks behind plan.” |
| Decision | Explicit choice or approval | “ExCo approved the October launch.” |
| Agreement | Consensus or acceptance without necessarily authorising a formal choice | “Everyone agreed the scope is too broad.” |
| Proposal | Suggested potential course of action | “We should dual-source the component.” |
| Concern | Expressed worry or warning | “I’m concerned the lead time is unrealistic.” |
| Commitment | A person/team undertakes an action | “Anna will obtain a new quote by Friday.” |
| Observation | Factual noticing without a wider conclusion | “Return rates rose in June.” |
| Assumption | An unverified premise being used | “We assume the certification completes in September.” |

**Boundary rules:**
- `category = Decision` usually pairs with `context_type = Decision`, but they are not identical: a meeting may discuss an earlier decision in an `Update`.
- `category = Action` often pairs with `context_type = Commitment`; an action reported as completed is normally `Progress` plus `Update`.
- `category = Risk` may pair with `Concern`, `Update`, or `Assumption`; it is not itself a context type.

## 5. Evidence, provenance, and immutable history

### 5.1 Evidence anchors

Every claim MUST reference one or more evidence anchors containing:
- immutable `evidence_id`;
- source system and source-native ID;
- source URI or R2 object key;
- source timestamp or date;
- segment, page, message, or character-span locator;
- content hash or source version; and
- ingestion timestamp.

### 5.2 Corrections and current state

Source evidence MUST NOT be altered. Extraction corrections MUST create a superseding claim revision or review event. Current topic/case state MAY be materialised for efficient queries, but MUST be reproducible from append-only events.

### 5.3 Minimum Decision Record

A Decision Record MUST include:
- decision statement;
- decision status: `Proposed`, `Approved`, `Rejected`, `Superseded`, or `Reversed`;
- authority or decision-maker;
- decision date/time or `unknown` with rationale;
- linked topic(s) and optional case;
- evidence anchors;
- assumptions, risks, dependencies, and actions where stated; and
- extraction/review confidence and reviewer status.

## 6. Identity and matching rules

1. Extraction MUST classify against existing canonical `topic_id` values only.
2. Matching MAY propose an existing topic case, but MUST record confidence and basis.
3. Below the configured confidence threshold, the system MUST create a **candidate case**, not a taxonomy topic.
4. Topic-case merges MUST be reviewable, reversible, and recorded as an event.
5. Fuzzy matching in [`index.ts`](packages/api-worker/src/index.ts:231) is a candidate-generation heuristic only; it MUST NOT silently determine canonical identity.

## 7. Validation rules

| Rule ID | Requirement | Failure handling |
|---|---|---|
| TAX-001 | `domain` must be an allowed value. | Reject or quarantine record. |
| TAX-002 | `topic_id` must exist in the versioned registry. | Reject or create review candidate. |
| TAX-003 | Category and ContextType must be valid and non-empty. | Reject record. |
| TAX-004 | Every claim must have at least one evidence anchor. | Reject record. |
| TAX-005 | Decision claims must satisfy the Decision Record minimum. | Route to review queue. |
| TAX-006 | A merge must preserve aliases, links, and history. | Block merge. |

## 8. Legacy mappings and compatibility

Provide explicit mappings for every previous vocabulary. For example:

| Legacy field/value | Canonical destination | Mapping rule | Loss/ambiguity |
|---|---|---|---|
| `Execution` category hint | No direct category | Reclassify from claim meaning | Requires review |
| `Problem` category hint | `Issue` or `Risk` | Present fact → Issue; uncertain future event → Risk | Ambiguous without evidence |
| Legacy `Governance` category | `Strategy`, `Decision`, or `Insight` | Map by proposition type | Requires review |

The legacy `CategoryHints` in [`mapping_rules.json`](config/mapping_rules.json:60) include values that do not match the canonical categories in [`taxonomy.json`](config/taxonomy.json:104). Treat them as non-normative retrieval hints and either migrate them or rename them to avoid implying they are valid category output.

## 9. Versioning and governance

- Use semantic versions: major for meaning/removal changes, minor for additive vocabulary, patch for clarifications and examples.
- No topic identifier may be deleted or reused; deprecate it and provide a successor mapping.
- Every taxonomy change MUST include rationale, examples, migration impact, test fixtures, an approver, and effective date.
- Changes affecting production classification MUST pass regression examples before activation.

## 10. Worked examples

Include 10–20 annotated source excerpts. Each example should show source text, evidence locator, extracted claims, category/context separation, topic selection, case behaviour, and any reviewer decision.

## Appendix A — Controlled vocabulary snapshot

List the exact active values, generated from [`taxonomy.json`](config/taxonomy.json:17) at release time.

## Appendix B — Deprecated terms

List retired aliases, date retired, successor value, and migration guidance.
