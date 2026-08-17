# EIP Specification Governance

> **Document status:** Active governance register  
> **Effective date:** 2026-07-31

## 1. Purpose

This register establishes document precedence for EIP and records known conflicts with the canonical product direction. It implements the document-precedence work required by [`WIP-roadmap.md`](WIP-roadmap.md:141).

## 2. Binding Precedence

1. [`WIP-roadmap.md`](WIP-roadmap.md:1) — **CANONICAL ROADMAP**
   - Governs product vision, mission, scope, scenarios, phase sequencing, target outcomes, and acceptance priorities.
   - Its mandatory feature-direction test is the required reference for every new feature, specification, implementation plan, and change request.
2. [`EIP_Implementation_Description_v1.7.7.md`](EIP_Implementation_Description_v1.7.7.md:1) — **CANONICAL IMPLEMENTATION PLAN**
   - Governs current-state implementation detail and delivery design needed to fulfil the roadmap.
   - Cannot expand, contradict, or reprioritise the roadmap.
3. `EIP_Taxonomy_v2.md` — **planned normative semantic contract**
   - When approved, governs controlled vocabulary, entity boundaries, evidence anchors, and identity/matching rules.
   - Until approved, [`config/taxonomy.json`](../config/taxonomy.json:1) is an interim machine-readable registry only; [`config/mapping_rules.json`](../config/mapping_rules.json:1) is extraction/matching heuristic configuration only.
4. Runtime code, migrations, configuration, deployment records, and verification artefacts — **deployed-state evidence**
   - Describe what is implemented, not what is authorised as target product scope.
5. Historical specifications, PRSs, architecture notes, blueprints, handover notes, plans, and generated documentation — **reference only unless reconciled**.

When documents conflict, the higher-precedence document governs. Conflicts must be resolved by updating the subordinate artefact or explicitly marking it superseded.

## 3. Document Statuses

| Status | Meaning |
|:---|:---|
| **Canonical** | Binding source of truth within its stated authority. |
| **Active** | Valid supporting document that must align with canonical documents. |
| **Planned normative** | Intended future binding contract; not authoritative until approved. |
| **Reference only** | Useful historical or technical context; cannot govern product or semantic decisions. |
| **Superseded** | Retained for history; must not be used for new decisions. |

## 4. Conflict Register

| Artefact | Status | Conflict or risk | Required disposition |
|:---|:---|:---|:---|
| [`EIP_Product_Topic_Memory_Matching_Engine_PRS.md`](../PRS/Matching%20engine%2Ball/EIP_Product_Topic_Memory_Matching_Engine_PRS.md:1) | Reference only | Excludes executive dashboards and governance workflows, allows automatic topic creation, states no manual catalogue or predefined topic IDs are required, and uses `Domain → Topic → Context → Governance`. These contradict the Board/ExCo cockpit, governed taxonomy/canonical-topic model, reviewable topic cases, and `ContextType → Topic → Category` processing required by the roadmap. | Replace or rewrite as a Phase 2 subordinate matching-engine specification after the canonical taxonomy contract is approved. |
| [`3D classification Change Request.txt`](../PRS/3D%20classification/3D%20classification%20Change%20Request.txt:1) | Reference only | Its Category and ContextType values/boundaries conflict with the current registry and has a different processing interpretation from the roadmap. | Reconcile its examples and enums into the approved `EIP_Taxonomy_v2.md`; then supersede this change request. |
| [`EIP_System_Blueprint.txt`](EIP_System_Blueprint.txt:1) | Superseded | Calls itself a canonical data specification, uses five obsolete domains, treats SharePoint/master log as the memory source of truth, and includes a T15 fallback rule. | Do not use for implementation or semantic decisions. Retain only as historical context. |
| [`EIP_Agent_Handover.txt`](EIP_Agent_Handover.txt:1) | Superseded | Calls itself authoritative, defines the same obsolete five-domain/T01–T18 model, treats `taxonomy.json` and SharePoint/master log as sources of truth, and directs T15 fallback. | Replace with a new agent-operating guide after the canonical Topic Memory API and taxonomy contract are delivered. |
| [`EIP_1.1_Topic_Record_Implementation_Plan.md`](EIP_1.1_Topic_Record_Implementation_Plan.md:1) | Superseded | Limits scope to per-meeting topic-record files and maps canonical topic to domain incorrectly; it lacks evidence, claims, topic cases, governance items, outcomes, and append-only history. | Retain as historical implementation record only. |
| [`EIP_1.1_CR-002_Taxonomy_Framework_Implementation_Instructions.md`](EIP_1.1_CR-002_Taxonomy_Framework_Implementation_Instructions.md:1) | Reference only | Establishes an older taxonomy contract that does not specify the canonical entity/evidence/history/governance model. | Use only as legacy-mapping input to `EIP_Taxonomy_v2.md`; supersede after approval. |
| [`EIP architecture and data flow.txt`](EIP%20architecture%20and%20data%20flow.txt:1) | Reference only | Correctly describes much of the deployed pipeline, but calls SharePoint the canonical store and omits the canonical Topic Memory, ExCo cockpit, risk signal, continuity brief, and governance-history target state. | Update as a current-state architecture note with a clear target-state boundary, or supersede it with a new architecture document. |
| [`README.md`](../README.md:1) | Active operational guide | Describes only the legacy Azure transcript pipeline and omits the canonical-document hierarchy and Topic Memory target. It is incomplete rather than directly contradictory. | Update its opening scope and link to the canonical roadmap/implementation plan. |
| [`config/taxonomy.json`](../config/taxonomy.json:1) | Interim machine-readable registry | Claims a canonical nine-axis schema while containing 13 axes; its declared domains omit `Strategy` even though topic entries use it; it cannot yet govern the roadmap’s planned entity model. | Reconcile through `EIP_Taxonomy_v2.md`; do not treat as normative until approved. |
| [`config/mapping_rules.json`](../config/mapping_rules.json:1) | Heuristic configuration | Contains category/context hints whose vocabulary is not consistently aligned with [`config/taxonomy.json`](../config/taxonomy.json:104) or the roadmap’s Category/ContextType boundary. | Reconcile rules and tests after the taxonomy contract is approved. |
| [`packages/d1/migrations/0001_initial_schema.sql`](../packages/d1/migrations/0001_initial_schema.sql:1) and later D1 migrations | Deployed/prototype schema | Uses mutable topic current state and lacks first-class evidence, claims, topic cases, governance items, outcomes, and append-only event history required by the roadmap. | Replace/evolve through a Phase 2 canonical Topic Memory migration plan; do not label the current schema canonical. |
| [`packages/api-worker/src/index.ts`](../packages/api-worker/src/index.ts:219) | Deployed/prototype API | Fuzzy matching can create/update topic identities and mutate current topic fields. This is not sufficient for the roadmap’s reviewable topic-case links, immutable evidence, and append-only governance history. | Refactor under the Phase 2 canonical API contract. |
| [`CHANGELOG.md`](../CHANGELOG.md:1) | Historical release record | Describes the pipeline and prototype Worker as implemented releases; it does not define product scope. | Keep as historical evidence; add a link to the canonical documents in a future maintenance pass. |
| [`3D classification risk assessment and mitigation plan.txt`](../PRS/3D%20classification/3D%20classification%20risk%20assessment%20and%20mitigation%20plan.txt:1) | Reference only | It usefully identifies classification risks but relies on legacy SharePoint/master-log context, obsolete ownership assumptions, and an undefined “CANON phase”; it does not cover the canonical evidence, claim, topic-case, governance-item, or ExCo model. | Use its risk scenarios as input to taxonomy regression tests and then supersede it with the approved taxonomy and verification contracts. |
| [`change-suggestions-by-zoo.txt`](../change-suggestions-by-zoo.txt:1) | Reference only | Its configuration and schema recommendations may be useful, but it proposes [`config/taxonomy.json`](../config/taxonomy.json:1) as the authoritative source, which conflicts with the planned normative [`EIP_Taxonomy_v2.md`](TEMP_EIP_Taxonomy_v2.md:1) contract. | Adopt individual recommendations only where they conform to the canonical roadmap, implementation plan, and approved taxonomy contract. |

## 5. Required Change Control

- Any proposed change to scope, phase ordering, target outcome, or acceptance criterion starts with an update to [`WIP-roadmap.md`](WIP-roadmap.md:1).
- Every new feature, specification, implementation plan, and change request must cite the mission and feature-direction test in [`WIP-roadmap.md`](WIP-roadmap.md:7), explaining the direct mission contribution or the necessary platform-infrastructure rationale before design or implementation proceeds.
- Any implementation design change must cite the roadmap section it implements and update [`EIP_Implementation_Description_v1.7.7.md`](EIP_Implementation_Description_v1.7.7.md:1).
- Any taxonomy, identity, or controlled-vocabulary change requires an approved update to `EIP_Taxonomy_v2.md`, machine registry changes, matching-rule changes, and regression fixtures together.
- Runtime code/configuration that conflicts with a canonical document must be logged in this register and addressed through a planned migration; deployed behaviour does not silently redefine the canon.
