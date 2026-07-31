# EIP Roadmap — Organisational Memory Platform

> **Document status:** **CANONICAL ROADMAP** — Active
>
> **Authority:** This document is the binding source of truth for EIP product direction, scope, phase sequencing, target outcomes, and acceptance priorities. Where another workspace document conflicts with it, this roadmap prevails. The implementation plan in [`EIP_Implementation_Description_v1.7.7.md`](EIP_Implementation_Description_v1.7.7.md:1) is the canonical delivery plan and must implement this roadmap; it may describe current-state detail but cannot expand or redefine roadmap scope.
>
> **Vision:** "EIP is Salesforce for organisational memory: a configurable platform that converts scattered organisational activity into a living, persistent memory that executives, teams and AI systems can actually reason over."
 
## 0. Business Value & Scenario-Driven Outcomes
 
EIP business value is defined by three recurring executive pain scenarios:
 
1. **Scenario 1 – "The £5m Decision Nobody Understands"**
   - Problem: No reconstructable trail of why major investments were approved, which assumptions were made, which risks/dependencies were accepted, and when assumptions failed.
   - EIP outcome: A **Decision Record** object and explorer that can answer:
     - "Why did we approve Project Falcon?"
     - "What assumptions turned out to be wrong?"
 
2. **Scenario 2 – "The Executive Blind Spot"**
   - Problem: Cross-functional risks emerge across multiple departments, but no single person sees the full picture until a launch or delivery fails.
   - EIP outcome: **Executive risk signals** (e.g. "Emerging Executive Risk") that surface converging topics, blockers and departments **months before** failure, with probability and impact estimates.
 
3. **Scenario 3 – "Key Person Leaves"**
   - Problem: Critical knowledge (decisions, context, relationships, dependencies) is stored in individuals’ heads and inboxes; when they leave, the real cost is knowledge loss.
   - EIP outcome: **Institutional memory**: decisions, topic history, dependencies and ownership live in Topic Memory, so organisational knowledge persists beyond individuals.
 
**Core positioning:**
- **CRM** stores customer memory.
- **ERP** stores transaction memory.
- **EIP** stores organisational memory.
 
From a roadmap perspective, each phase must move these scenarios from narrative to reality:
- Scenario 1: requires **Decision Records**, **Assumptions**, and **Decision→Evidence** trails.
- Scenario 2: requires **Signals** over the topic graph, especially **Emerging Executive Risk**.
- Scenario 3: requires durable **Topic/Decision/Ownership history** plus onboarding/offboarding views.
 
## 1. Strategic Objectives

1. **Inform management about state and activity**
   - Provide reliable, topic-centric views of what is happening across the business.
   - Expose history, trends and stalled work at topic, domain and executive levels.

2. **Enable traceable evidence for decisions and implementations**
   - Every decision, action and risk is backed by immutable evidence (meetings, docs, emails, etc.).
   - Decision trails can be reconstructed by topic, person, project and timeframe.

3. **Build organisational redundancy and resilience**
   - Reduce single-person dependency by preserving knowledge in a durable topic memory.
   - Support onboarding ("who decided what, when, and why") and continuity when people leave or change roles.

---

## 2. Current State (Q3 2026)

Source: [`EIP_Implementation_Description_v1.7.7.md`](specification and plans/EIP_Implementation_Description_v1.7.7.md:1), taxonomy PRS, 3D classification PRS, matching engine PRS.

**Implemented (Azure pipeline):**
- Daily Azure Function pipeline that ingests Teams meeting transcripts and local VTT files.
- Map-reduce LLM classification producing:
  - 9-section leadership summary per meeting.
  - Topic records (T01–T18 + AI + Data) stored in SharePoint.
  - People intelligence layer (`*-People.txt`, `master_people_log.*`).
- SharePoint-based time-series memory via `master_log.json` and topic record folders.
- Taxonomy-driven classification (`taxonomy.json`, `mapping_rules.json`).
- Partial 3D classification (Topic, Domain, Category, ContextType) in code and prompts.
- Verification framework for LLM outputs.

**Partially aligned / inconsistent:**
- Multiple overlapping specs for CATEGORY / CONTEXT_TYPE and domain model.
- Topic memory / matching engine PRS (Cloudflare + D1/Vectorize) is not yet implemented; current system is Azure + SharePoint.
- Topic Record schema has evolved beyond original EIP 1.1 plan, but older docs are not marked as superseded.

**Not yet realised:**
- Unified, cross-source organisational memory (beyond Teams + transcripts).
- Full topic memory service (independent of SharePoint) that can be queried by humans and AI in real time.
- Formalised evidence graph (decisions/actions/risks linked to meetings, documents, people, systems).
- Operational metrics and governance for classification quality over time.

---

## 3. Guiding Product Principles

1. **Topic-first memory**
   - Topics, not meetings, are the primary unit of organisational memory.
   - Every artefact (meeting, email, document, ticket) must attach to one or more topics.

2. **Evidence-backed intelligence**
   - Every insight shown to management must be traceable to concrete evidence.
   - No "magic" insights without links to source artefacts.

3. **Deterministic spine, probabilistic helpers**
   - Deterministic, config-driven classification and matching are the backbone.
   - LLMs are used for extraction/enrichment but must be auditable and overrideable.

4. **Configuration over code**
   - Taxonomy, rules, prompts and thresholds are controlled via configuration (files or UI), not hardcoded.
   - New domains, topics, and categories can be introduced without redeploying core services.

5. **Append-only history**
   - Topic memory is never overwritten, only appended.
   - Corrections are modelled as new events, not destructive edits.

6. **Agent- and human-friendly**
   - Data structures are designed to be easily consumed by both executives and AI agents.
   - Standard, documented schemas and APIs.

---

## 4. Roadmap Overview

Phased plan from current Azure pipeline to a full organisational memory platform.

### Phase 0 — Canonical Contract, Governance & Architecture Decision (immediate)

**Goal:** Establish one authoritative, versioned semantic and data contract before changing extraction behaviour or expanding the storage/API surface.

**Key Outcomes:**
- An approved canonical taxonomy and 3D classification contract.
- Explicit identity boundaries between taxonomy topics, live topic cases, evidence, extracted claims, and ExCo governance items.
- An agreed Azure-to-Topic-Memory migration decision and coexistence contract.
- Older specifications marked with clear status and precedence.

**Exit criteria:** Two reviewers classify 10–20 representative transcript excerpts consistently; every extracted record has an unambiguous schema destination; and a decision has been made on the initial system of record.

**Workstreams:**

1. **Canonical Taxonomy & Memory Contract**
    - Create `EIP_Taxonomy_v2.md` as the normative contract; retain `taxonomy.json` as the machine-readable registry and `mapping_rules.json` as extraction/matching heuristics only.
    - Freeze authoritative vocabularies for `DOMAIN`, `TOPIC_FAMILY`, `TOPIC_ID`, `CATEGORY`, `CONTEXT_TYPE`, and `TAGS`.
    - Define entity boundaries and stable identities for:
      - canonical taxonomy topic (configured business concept);
      - topic case (a specific live instance of a concern or initiative);
      - evidence item (immutable source artefact or source fragment);
      - claim (decision, action, risk, issue, dependency, or assumption extracted from evidence); and
      - ExCo governance item (a material decision, risk, dependency, action, or outcome requiring ExCo visibility or intervention).
    - Define Category versus ContextType boundary rules, including risk versus issue, decision versus proposal, and action versus progress.
    - Define controlled governance fields: ExCo materiality (`Inform`, `Monitor`, `Discuss`, `Decide`, `Escalate`), governance status, accountable executive, review cycle, next review date, and escalation/staleness rules.
    - Produce explicit mappings from legacy vocabularies and resolve internal registry inconsistencies before approval.

2. **Evidence, History & Identity Rules**
    - Specify mandatory evidence anchors: source-native ID, source locator, timestamp, content/version hash, ingestion time, and confidence.
    - Define corrections, merges, and review decisions as append-only events; mutable current state must be reproducible from that history.
    - Define threshold and review rules: matching may suggest an existing case, but must not silently create or merge canonical taxonomy topics.

3. **Document Precedence, Change Governance & Security Baseline**
    - Publish `EIP_Spec_Governance.md` defining the spec hierarchy, statuses (Active, Superseded, Deprecated, Draft), named decision rights, semantic versioning, and regression-test requirements for taxonomy changes.
    - Define the minimum information-governance baseline for all evidence: access control, audit history, retention, source-specific handling, and redaction requirements.

4. **Migration and System-of-Record Decision**
    - Time-box the decision whether the Azure pipeline will initially remain the extractor while Topic Memory becomes the system of record, or whether it will be fully replaced.
    - Document API ownership, source identifiers, idempotency keys, retry behaviour, authentication, and coexistence/backfill boundaries.

5. **Update Implementation Specification**
    - Rev the implementation description to reference the canonical contract and state the mandatory processing order: ContextType → Topic → Category → enrichment.

---

### Phase 1 — Prove the Decision-to-Evidence Vertical Slice (short term)

**Goal:** Prove EIP's central promise with a governed, end-to-end path from transcript evidence to a reconstructable decision trail.

**Key Outcomes:**
- Stable, verified extraction into the canonical memory contract.
- A decision record linked to immutable transcript evidence, assumptions, risks, dependencies, actions, and intended outcome where stated.
- A query/API result that reconstructs one real decision end-to-end.
- An ExCo-ready governance item that states materiality, accountable executive, required intervention, review cycle, and next review date.
- A validated, idempotent historical-backfill approach for the same contract.

**Workstreams:**

1. **Classification Engine Hardening**
   - Align `classification_rules.json` prompts with the canonical taxonomy and 3D separation rules.
   - Ensure deterministic processing order in code:
     - ContextType assignment → Topic mapping → Category selection.
   - Refine `Select-Category` and ContextType derivation rules using verification artefacts.

2. **Canonical Record & Decision Slice**
    - Finalise schemas for evidence items, claims, topic cases, decision records, assumptions, risks, dependencies, actions, outcomes, ExCo governance items, and append-only review/correction events.
    - Make evidence anchors and taxonomy version mandatory for every extracted claim.
    - Implement one decision-to-evidence vertical slice from transcript ingestion through retrieval, including its materiality, accountable executive, required ExCo intervention, and intended outcome; do not defer Scenario 1 until dashboards or broad multi-source ingestion.
    - Treat fuzzy or semantic matching as candidate generation only, with reviewable and reversible case merge decisions.

3. **Verification & Quality Metrics**
   - Extend `artifacts/verification` to include:
     - Category/ContextType accuracy checks.
     - Drift metrics (e.g. fallback usage, unknown categories).
   - Define a minimal "classification quality dashboard" (offline first, e.g. CSV + basic charts) with:
     - Fallback rates.
     - Conflict logs (dimension overlap, invalid combos).
     - Per-topic extraction coverage over time.

4. **Historical Backfill Strategy**
   - Define how to reprocess historical meetings to populate the canonical model:
     - Time windows.
     - Idempotent updates to master log and topic records.

---

### Phase 2 — Canonical Topic Memory Service (medium term)

**Goal:** Move from "files on SharePoint" to a proper topic memory service that can power multiple surfaces (dashboards, agents, APIs).

**Key Outcomes:**
- Independent Topic Memory store with API access.
- Topic-centric queries (history, decisions, actions, risks) for executives and agents.

**Architecture Direction:**
- Adopt the matching engine PRS and Cloudflare stack as the long-term runtime:
  - Cloudflare Workers for ingestion/orchestration.
  - D1 for topic metadata and history.
  - R2 for raw evidence storage (transcripts, docs, artefacts).
  - Vectorize + Workers AI for embeddings and similarity search.

**Workstreams:**

1. **Schema & Data Model Implementation**
    - Implement the Phase 1 canonical contract in D1 and R2:
      - canonical taxonomy topics and separately identified topic cases;
      - immutable `evidence` with source metadata and R2 references;
      - claims and typed links between cases, evidence, decisions, actions, risks, dependencies, assumptions, outcomes, and ExCo governance items;
      - append-only event/revision history plus materialised current state.
    - Preserve lineage through corrections, merges, and source reprocessing.

2. **Ingestion Adapters**
   - Phase 2a: Azure pipeline writes into Topic Memory service via API (coexistence period).
   - Phase 2b: Cloudflare-native ingestion paths for new sources (e.g. Jira, Confluence, M365 connectors).

3. **Matching Engine Implementation**
    - Implement the Topic Matching Engine using the canonical classification stack: Domain/Topic/Category/ContextType/Brand.
    - Use semantic similarity and entity/relationship similarity only to propose topic-case links or merge candidates; the relational memory model remains the source of truth.
    - Expose API endpoints to upsert evidence, return match candidates with confidence/provenance, and create reviewable candidate cases when confidence is insufficient.

4. **Topic Query, Signals & ExCo Governance API**
    - Provide APIs for:
      - Get topic history (timeline of evidence, decisions, actions, status).
      - Get topic signals (repeated risks, stalled work, escalations).
      - Get the ExCo governance queue filtered by materiality, governance status, accountable executive, review date, and stale-item threshold.
      - Get per-executive views (topics by owner, domain, capability).
    - Define the evidence-backed `EmergingExecutiveRisk` signal contract: a reviewable candidate generated when related risks, blockers, or dependencies converge across a configurable minimum number of live topic cases and organisational domains/capabilities within a configurable observation window.
    - Require every `EmergingExecutiveRisk` candidate to retain its contributing evidence and cases, detection rationale, observation window, probability, impact, confidence, accountable executive or triage owner, and review state. Automated detection may propose a signal but cannot mark it material or escalated without human governance review.
    - Add an acceptance fixture in which converging evidence from at least two distinct domains/capabilities produces one explainable candidate signal; unrelated evidence must not be aggregated, and a reviewer must be able to confirm, dismiss, or split the candidate without losing provenance.

5. **ExCo Continuity Brief API**
    - Generate an evidence-backed continuity brief for a departing or newly appointed ExCo member or strategic accountable executive.
    - The brief must identify the person's material decisions, open assumptions, risks, dependencies, actions, outcomes, governance items, ownership-transfer needs, next review dates, and evidence links; it must distinguish recorded facts from unresolved or low-confidence claims.
    - Add an acceptance fixture where a reviewer can reconstruct the material context and required handover actions for one role from Topic Memory without relying on the departing person's mailbox or recollection.

---

### Phase 3 — ExCo Governance Cockpit (medium term)

**Goal:** Turn Topic Memory into a focused Board/ExCo management and governance control surface; broader organisational hierarchy dashboards remain out of scope.

**Key Outcomes:**
- An ExCo Governance Cockpit that converts material memory records into an actionable agenda and review workflow.
- Formal governance of taxonomy, access, and classification quality.
- A closed feedback loop from decision and action to intended and evidenced outcomes.

**Workstreams:**

1. **ExCo Governance Cockpit**
   - Build four connected views:
     - **Executive overview:** material risks, overdue decisions, stuck actions, deteriorating confidence, reviewable `EmergingExecutiveRisk` candidates, and the required ExCo intervention.
     - **Decision register:** proposed, approved, rejected, reversed, or superseded decisions with authority, rationale, assumptions, dependencies, evidence, and linked outcomes.
     - **Risk and dependency tracker:** material cross-domain risks and dependencies with exposure, mitigation, accountable executive, aging, next review, escalation status, and drill-down to any contributing `EmergingExecutiveRisk` candidate.
     - **Outcome tracker:** intended outcome, success measure, baseline, target, target date, latest actual, confidence, and evidence of result for decisions and strategic actions.
   - Initial implementation can be Power BI or a lightweight Workers-served web UI over Topic Memory.

2. **Governance Workflow Tracker**
   - Provide explicit queues for:
     - decisions awaiting ExCo authority;
     - approved decisions missing evidence, assumptions, owners, or outcome definitions;
     - material risks without mitigation, accountable executive, or next review date;
     - overdue actions or actions lacking evidence of completion;
     - outcomes with missed targets, declining confidence, or no measurement update;
     - reviewable `EmergingExecutiveRisk` candidates that require confirmation, dismissal, splitting, or escalation;
     - stale governance items and low-confidence material claims awaiting human review.
   - Every material item must show why it is material, what changed since its previous review, who is accountable, what is due next, supporting evidence, and the decision or intervention required from ExCo.

3. **Decision & Evidence Explorer**
   - UI/API to:
     - Search decisions by topic, person, timeframe.
     - Drill down from decision → evidence artefacts.
     - Export decision trails for audits and board packs.

4. **Taxonomy, Rule & Access Governance**
    - Operate the named decision-rights and versioned change process established in Phase 0, including compatibility review, migration plans, and regression fixtures for every semantic change.
    - Establish a monthly taxonomy review and a repository-based or UI workflow with validation, regression tests, audit history, and approval controls.
    - Apply evidence-level authorisation, retention, and audit requirements before exposing management or agent surfaces.

5. **Quality & Drift Monitoring**
   - Operational dashboards:
     - Classification drift indicators.
     - Volume of unmatched evidence.
     - Distribution of Category/ContextType over time.

---

### Phase 4 — Multi-Source Organisational Memory (longer term)

**Goal:** Extend beyond meetings into a unified organisational memory across tools.

**Key Outcomes:**
- Consolidated topic memory with evidence from multiple systems.
- Robust redundancy for people movement and organisational change.

**Workstreams:**

1. **Additional Evidence Sources**
    - Prioritise high-value integrations:
      - Jira / DevOps boards (implementation work items).
      - Confluence / SharePoint pages (design docs, specs).
      - Email/Chat (decisions and commitments, with strong filters and source-specific privacy/retention controls).
    - Normalise all evidence into the same Topic Memory contract, including immutable provenance and access metadata.

2. **Cross-System Identity & Entity Resolution**
   - Unify people IDs across platforms.
   - Normalise product/project/system names across sources.

3. **Onboarding & Offboarding Use Cases**
    - Build on the Phase 2 ExCo continuity brief with broader persona flows:
      - "New manager for Domain X" → curated topic tour (history, key decisions, open risks).
      - "Engineer joining project Y" → project-specific topic history.
    - Packaged views and summaries generated from Topic Memory.

4. **AI Assistant & Co-pilot Integration**
   - Provide:
     - Retrieval APIs optimised for RAG (chunking, metadata filters).
     - System prompts and tools for organisational-memory agents ("What has Mandar been discussing about storage constraints?").
   - Ensure every AI answer links back to concrete evidence in Topic Memory.

---

## 5. Near-Term Concrete Next Steps

1. **Approve the Canonical Taxonomy and Memory Contract**
    - Complete `EIP_Taxonomy_v2.md` as the normative specification for vocabulary, entity boundaries, evidence anchors, identity/matching, legacy mappings, and semantic versioning.
    - Resolve registry conflicts, including declared domain values that are used by topic entries but absent from the domain list, and the inaccurate “9-axis” terminology.

2. **Validate the Contract Against Real Evidence**
    - Annotate 10–20 representative transcript excerpts with ContextType, Topic, Category, evidence anchors, and proposed case identity.
    - Add adjudicated examples for risk versus issue, decision versus proposal, action versus progress, and existing case versus new case.

3. **Publish Governance and Decide the Initial System of Record**
    - Create `EIP_Spec_Governance.md` with precedence, document statuses, named decision rights, change approvals, and required regression tests.
    - Time-box the Azure/Cloudflare migration decision; document coexistence, idempotency, authentication, and backfill behaviour.

4. **Build the Decision-to-Evidence-and-Outcome Vertical Slice**
   - Ingest one transcript as immutable evidence, extract a decision with its stated assumptions, risks, dependencies, actions, materiality, accountable executive, and intended outcome, and retrieve its complete evidence trail.
   - Use the result as the acceptance test for Scenario 1 and the first ExCo governance item before implementing broad signals, dashboards, or extra connectors.

5. **Define ExCo Governance Controls, Risk-Signal, and Tracker Acceptance Criteria**
    - Approve controlled values and rules for materiality, governance status, accountable executive, next review, escalation, staleness, outcome measurement, and human-review thresholds.
    - Define the `EmergingExecutiveRisk` detection contract and fixture: configurable convergence and observation-window thresholds, probability/impact/confidence semantics, evidence/provenance requirements, and reviewer confirm/dismiss/split/escalate actions.
    - Define acceptance tests for the Executive overview, Decision register, Risk and dependency tracker, Outcome tracker, and governance queues.

6. **Prove an ExCo Continuity Brief**
    - Define and test a role-handover brief for one departing or newly appointed ExCo member or strategic accountable executive, covering material decisions, open assumptions, risks, dependencies, actions, outcomes, ownership transfers, next reviews, and supporting evidence.
    - Require a reviewer to verify that the brief supports a complete, evidence-backed handover without relying on the departing person's private knowledge.

7. **Align Pipeline Rules, Verification, and Storage Design**
    - Update classification rules and verification artefacts to enforce exact vocabularies and Category/ContextType separation.
    - Draft and review the D1/R2 schema for evidence, claims, cases, decision records, typed links, and append-only history before expanding the API.

These steps establish a governed evidence-and-decision spine first, allowing the later platform phases to extend a validated organisational-memory system rather than create a parallel one.