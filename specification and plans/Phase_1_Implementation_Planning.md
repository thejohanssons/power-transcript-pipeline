# Phase 1 — Implementation Planning

> **Status:** Planning draft — no runtime-change authorisation
> **Basis:** Approved [`EIP_Taxonomy_v2.md`](EIP_Taxonomy_v2.md:1), Phase 1 roadmap in [`WIP-roadmap.md`](WIP-roadmap.md:158), and the Phase 0 compatibility assessment in [`registry-rule-compatibility-report.md`](../artifacts/phase0/registry-rule-compatibility-report.md:1).
> **Scope boundary:** This document plans implementation. It does not authorise changes to deployed configuration, pipeline code, D1 migrations, Worker/API code, Azure dual-write, deployment, or cutover.

## 1. Objective

Design one governed decision-to-evidence vertical slice: a source transcript excerpt enters through the existing Azure pipeline, is submitted idempotently to Topic Memory, becomes immutable evidence and reviewable claims, is associated with a topic case and decision record, and is retrievable as an ExCo governance item with its complete evidence trail.

The implementation must apply classification in this order:

```text
ContextType → Topic → Category → enrichment
```

## 2. Target Slice and Acceptance Evidence

### 2.1 Pilot slice

Use one explicitly authorised decision from an existing approved test transcript. The selected source must contain sufficient evidence to establish:

1. source-native identity and a precise fragment locator;
2. a decision claim with stated authority;
3. a linked topic case and one or more canonical taxonomy topics;
4. associated assumptions, dependencies, risks, actions, or intended outcome where evidenced; and
5. an ExCo governance item with materiality, accountable executive, required intervention, and next review date.

### 2.2 Slice acceptance criteria

The vertical slice is complete only when it demonstrates:

- immutable evidence anchored by the idempotency tuple in [`EIP_Taxonomy_v2.md`](EIP_Taxonomy_v2.md:39);
- claims classified using the contract order and controlled values;
- no use of a fallback topic; insufficient evidence produces `unclassified` review status;
- case links and any candidate match are reviewable and reversible;
- a retrieval response reconstructs decision, claims, evidence locators, event history, and governance state;
- exact replay returns the same durable receipt without duplicate evidence, claims, or events; and
- a correction or review is represented as a new event rather than destructive update.

## 3. Implementation Work Packages

### 3.1 Registry, rules, and classification plan

Prepare a separately approved runtime-change package that:

1. creates a versioned machine registry with stable `T01`–`T20` identifiers, canonical domains and topic families;
2. adds `Assumption` as a category;
3. replaces non-canonical category hints (`Execution`, `Problem`, `Learning`, and `Governance`) with reviewable candidate logic;
4. applies `ContextType → Topic → Category → enrichment` consistently in prompts, code, validation, and test fixtures;
5. prohibits `T15` or any other topic from acting as an uncertainty fallback; and
6. retains legacy labels, domains, and source identifiers as mapping lineage rather than silently rewriting history.

The package must resolve every item in [`registry-rule-compatibility-report.md`](../artifacts/phase0/registry-rule-compatibility-report.md:13) and include regression fixtures for each compatibility action and boundary rule.

### 3.2 Canonical D1 data-model plan

Evolve the current topic/occurrence model in [`0001_initial_schema.sql`](../packages/d1/migrations/0001_initial_schema.sql:8) through additive migrations. Do not repurpose `topics` as both a taxonomy concept and a live matter.

| Planned entity | Purpose | Key identity / constraints |
|---|---|---|
| `taxonomy_topics` | Versioned controlled taxonomy concepts | `topic_id`, `taxonomy_version`; no silent rename or merge |
| `evidence_items` | Immutable source artefacts/fragments | unique evidence idempotency tuple; source version and access classification |
| `topic_cases` | Live initiatives, concerns, or decision threads | `case_id`, lifecycle projection, creation evidence |
| `case_topics` | Many-to-many case-to-taxonomy relationship | preserves rationale and provenance |
| `claims` | Evidence-grounded extracted assertions | `claim_id`, classification dimensions, review state |
| `claim_evidence` | Many-to-many claim evidence support | at least one evidence item per claim |
| `decisions` | Decision aggregate/projection | `decision_id`, authority, rationale and outcome references |
| `decision_claims` | Decision-to-claim association | preserves contribution type |
| `governance_items` | ExCo materiality and intervention projection | controlled governance fields and next review |
| `memory_events` | Immutable lifecycle, correction, review, merge, and redaction history | ordered event identity, actor, reason, prior-event reference |
| `submission_receipts` | Durable Azure submission and replay results | unique Azure submission ID plus evidence idempotency reference |

The detailed migration design must specify indexes, foreign keys, event ordering, retention handling, access-classification fields, and projection/replay rules before implementation begins.

### 3.3 Worker/API contract plan

Replace the broad topic-upsert shape currently exposed by [`index.ts`](../packages/api-worker/src/index.ts:90) with contract-aligned, versioned operations. The planned API surface is:

| Operation | Intended responsibility |
|---|---|
| `POST /v2/submissions` | Authenticated Azure submission of source evidence plus extraction candidates; validates contract version and returns durable receipt |
| `GET /v2/submissions/{id}` | Reconciliation and retry status for a source-processing attempt |
| `GET /v2/decisions/{id}` | Reconstructable decision-to-evidence view, subject to evidence access controls |
| `GET /v2/governance-items/{id}` | ExCo governance projection and event-derived current state |
| `POST /v2/reviews` | Human review, correction, materiality, merge, or redaction event creation |
| `GET /v2/cases/{id}` | Case, linked claims, topics, and provenance; candidate matches remain explicit |

All write operations must validate controlled vocabulary, required evidence anchors, identity rules, source authorisation metadata, and idempotency. Retrieval must enforce evidence-level access, apply required redaction, and emit an audit event. HTTP response schemas, error semantics, authentication mechanism, and audit retention require separate design approval before code changes.

### 3.4 Azure coexistence and reconciliation plan

Define a versioned Azure submission envelope containing:

- `submission_id` and extraction-run identity;
- contract and taxonomy versions;
- source-native identifiers, locator, source version, content hash, occurrence time, and access classification;
- permitted R2 capture reference or source reference;
- classification candidates, confidence, provenance, and validation results; and
- correlation identifiers for Azure publication and reconciliation.

The reconciliation job must compare Azure-processed sources with Topic Memory receipts and canonical projections. It must classify discrepancies as retryable transport failure, validation rejection, identity mismatch, semantic divergence, access/redaction mismatch, or projection/publication divergence. It must never resolve a conflict by silently overwriting either system.

### 3.5 Verification, quality, and backfill plan

Extend verification artefacts to cover:

- all Category/ContextType boundary rules;
- legacy vocabulary mappings and `unclassified` outcomes;
- invalid controlled-value combinations;
- candidate case-match and merge-review behaviour;
- idempotent submission/replay and changed-content supersession;
- access, audit, retention, and redaction behaviour; and
- decision reconstruction from the vertical-slice source.

Define offline quality outputs for fallback rate, unknown/invalid values, classification conflicts, coverage by topic, candidate-link acceptance rate, reconciliation status, and unresolved divergence severity. Historical backfill must be append-only, use defined time windows, preserve original source lineage, and be validated against the same idempotency and reconciliation controls.

## 4. Sequencing and Approval Gates

1. **Design review:** approve the canonical D1 schema, API envelopes, authentication approach, and pilot source selection.
2. **Runtime reconciliation approval:** approve registry, mapping-rule, prompt, code, and regression-fixture changes as one controlled change.
3. **Vertical-slice implementation approval:** authorise additive D1 migrations, Worker/API implementation, and Azure submission integration.
4. **Pilot approval:** define pilot duration, severity thresholds, operational owners, and monitoring.
5. **Cutover approval:** only after the contract’s reconciliation, security, replay/recovery, and divergence gates are demonstrably met.

## 5. Explicitly Deferred

The following remain out of scope for this planning iteration:

- modifying [`taxonomy.json`](../config/taxonomy.json:1) or [`mapping_rules.json`](../config/mapping_rules.json:1);
- changing the PowerShell pipeline or Azure deployment;
- applying D1 migrations or deploying Worker/API changes;
- enabling Azure-to-Cloudflare dual-write;
- bulk historical backfill; and
- declaring Cloudflare Topic Memory authoritative or performing cutover.
