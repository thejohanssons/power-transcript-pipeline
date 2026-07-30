# EIP WIP Roadmap — Organisational Memory Platform
 
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

### Phase 0 — Spec Consolidation & Canonical Model (immediate)

**Goal:** One authoritative conceptual model for classification and topic memory; remove conflicts between PRS/specs.

**Key Outcomes:**
- Single canonical taxonomy and 3D classification model (Topic, Category, ContextType + Domains, TopicFamilies, Tags).
- Updated specs and deprecation notes for older documents.

**Workstreams:**

1. **Canonical Taxonomy & 3D Model**
   - Freeze authoritative vocabularies for:
     - `DOMAIN`
     - `TOPIC_FAMILY`
     - `TOPIC_ID` / `CANONICAL_TOPIC`
     - `CATEGORY`
     - `CONTEXT_TYPE`
     - `TAGS`
   - Produce explicit mapping tables from legacy vocabularies:
     - Domain: Execution/Organisation/Financial → new domains (Operations, People, Finance, Governance, etc.).
     - Category: Execution/Problem/Learning/etc. → final Category values.
     - ContextType: Status Update/Issue/Risk etc. → final CONTEXT_TYPE values.

2. **Document Precedence & Supersession**
   - Publish a short spec: `EIP_Spec_Governance.md` with:
     - Spec hierarchy (e.g. Implementation Description + Taxonomy CR are source of truth).
     - Status markers on PRS / blueprints (Active, Superseded, Deprecated, Draft).

3. **Update Implementation Spec**
   - Rev EIP Implementation Description to align with canonical taxonomy and 3D model.
   - Ensure pipeline description explicitly states processing order: ContextType → Topic → Category.

---

### Phase 1 — Harden Current Pipeline as "EIP v1 Memory Extractor" (short term)

**Goal:** Make the existing Azure pipeline a robust, trustworthy extractor into the canonical memory model.

**Key Outcomes:**
- Stable, verified extraction of meetings into the canonical topic schema.
- Backfill strategy for historical meetings.

**Workstreams:**

1. **Classification Engine Hardening**
   - Align `classification_rules.json` prompts with the canonical taxonomy and 3D separation rules.
   - Ensure deterministic processing order in code:
     - ContextType assignment → Topic mapping → Category selection.
   - Refine `Select-Category` and ContextType derivation rules using verification artefacts.

2. **Topic Record Schema Finalisation**
   - Lock a final Topic Record schema consistent with:
     - Canonical taxonomy axes (Domain, TopicFamily, Topic, Category, ContextType, Tags).
     - Ownership / governance fields.
     - Evidence anchors (People, Products, Projects, Systems, Dependencies).
   - Mark older topic record plans as superseded.

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

1. **Schema & Data Model Design**
   - Translate canonical Topic Record + master log formats into relational schema (D1) and object model:
     - `topics` (identity, labels, domains, owners).
     - `evidence` (meetings, docs, emails) with source metadata.
     - `topic_evidence_links` (many-to-many + context fields).
     - `decisions`, `actions`, `risks` tables for first-class decision/evidence tracking.
   - Preserve append-only history semantics.

2. **Ingestion Adapters**
   - Phase 2a: Azure pipeline writes into Topic Memory service via API (coexistence period).
   - Phase 2b: Cloudflare-native ingestion paths for new sources (e.g. Jira, Confluence, M365 connectors).

3. **Matching Engine Implementation**
   - Implement `Topic Matching Engine` per PRS with updated classification stack:
     - Domain/Topic/Category/ContextType/Brand.
     - Semantic similarity + entity/relationship similarity.
   - Expose API endpoints for:
     - Upsert evidence.
     - Match evidence → topic(s).
     - Create new topics when confidence threshold not met.

4. **Topic Query & Signals API**
   - Provide APIs for:
     - Get topic history (timeline of evidence, decisions, actions, status).
     - Get topic signals (repeated risks, stalled work, escalations).
     - Get per-executive views (topics by owner, domain, capability).

---

### Phase 3 — Management & Governance Surfaces (medium term)

**Goal:** Turn the topic memory into a usable management tool and governance system.

**Key Outcomes:**
- Management dashboards and review workflows based on Topic Memory.
- Formal governance of taxonomy and classification quality.

**Workstreams:**

1. **Executive Views & Dashboards**
   - Build views for:
     - Topic health (status, trajectory, risk level).
     - Domain/owner views (per executive, per board).
     - Stalled work and repeated risks.
   - Initial implementation can be:
     - Power BI or similar BI tool over Topic Memory service.
     - Lightweight web UI served from Workers.

2. **Decision & Evidence Explorer**
   - UI/API to:
     - Search decisions by topic, person, timeframe.
     - Drill down from decision → evidence artefacts.
     - Export decision trails for audits and board packs.

3. **Taxonomy & Rule Governance**
   - Establish an internal governance process:
     - Monthly taxonomy review.
     - Change requests for new topics/domains/categories.
   - Tooling:
     - Config UI or repository-based change workflow with validation (linting + regression tests).

4. **Quality & Drift Monitoring**
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
     - Email/Chat (decisions and commitments, with strong filters).
   - Normalise all evidence into the same Topic Memory schema.

2. **Cross-System Identity & Entity Resolution**
   - Unify people IDs across platforms.
   - Normalise product/project/system names across sources.

3. **Onboarding & Offboarding Use Cases**
   - Specific persona flows:
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

1. **Create Canonical Taxonomy Spec**
   - New file: `specification and plans/EIP_Taxonomy_v2.md` consolidating DOMAIN, TOPIC_FAMILY, TOPIC, CATEGORY, CONTEXT_TYPE, TAGS + mapping tables from legacy terms.

2. **Align Implementation Description with Canonical Model**
   - Update [`EIP_Implementation_Description_v1.7.7.md`](specification and plans/EIP_Implementation_Description_v1.7.7.md:1) to:
     - Explicitly reference the canonical taxonomy spec.
     - Document the mandatory 3D processing order.

3. **Refine `classification_rules.json` and Verification Artifacts**
   - Update prompts to enforce:
     - Non-overlap of Category vs ContextType.
     - Exact vocabularies.
   - Add verification cases that target ambiguous Category/ContextType boundaries.

4. **Design Topic Memory Schema (Draft)**
   - Draft a `TopicMemorySchema_v1.sql` (or markdown spec) based on D1, reflecting:
     - Topics, Evidence, Links, Decisions, Actions, Risks.

5. **Decide Migration Strategy**
   - Document whether the Azure pipeline becomes:
     - a) A long-term extractor feeding the Cloudflare Topic Memory service; or
     - b) A temporary bridge to be fully replaced by Cloudflare Workers.

These steps move the project from a powerful transcript pipeline towards a coherent organisational memory platform aligned with the stated objectives.