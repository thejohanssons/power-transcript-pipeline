# Change Request: EIP Cockpit Lens, Hierarchy and Escalation Model

**Change Request ID:** EIP-CR-2026-08-13-001  
**Document version:** v0.2  
**Date:** 13 August 2026  
**Requested by:** Peter Johansson  
**System / Product:** EIP ExCo Cockpit / Executive Intelligence Platform  
**Status:** Conditionally approved in principle, pending policy and data-model design  
**Priority:** High  
**Change Type:** Product architecture, information model, governance policy, dashboard UX, escalation lifecycle, access entitlement model

---

## 0. Specification History

| Version | Date | Status | Summary of Change | Author / Source |
|---|---|---|---|---|
| v0.1 | 13 August 2026 | Draft for review | Initial change request proposing audience lenses, hierarchy layers, escalation levels, executive cards and drill-down from executive summary to evidence. | Peter Johansson / Copilot draft |
| v0.2 | 13 August 2026 | Conditionally approved in principle | Updated after SWOT review. Adds governed classification workflow, canonical policy specification, escalation lifecycle, primary-parent plus typed graph relationships, separation of lens relevance, attention visibility and access entitlement, measurable acceptance criteria, policy simulation and narrower first production slice. | Peter Johansson feedback / Copilot update |

### 0.1 Change Log from v0.1 to v0.2

This version keeps the original direction of the change request but strengthens the governance and implementation model.

Key changes:

- Status changed from **Draft for review** to **Conditionally approved in principle**.
- Added a **Policy Governance Layer** between topic classification and cockpit presentation.
- Added a **canonical policy specification** requirement covering field dictionaries, allowed values, defaults, derivation logic, ownership and review cadence.
- Added a **classification operating model** defining which actors can propose, approve, override, reclassify and de-escalate items.
- Replaced a pure hierarchy tree with **primary parent plus typed relationships**, reflecting that EIP topics form a graph.
- Split **lens relevance/ranking**, **attention visibility** and **access entitlement** into separate concerns.
- Added deterministic escalation requirements covering thresholds, evidence windows, precedence rules and policy versions.
- Added controls to prevent unsupported executive compression and false authority.
- Added measurable acceptance criteria and a policy simulation/regression suite.
- Narrowed the first production slice to **ExCo plus one domain lens**, focused on **E3-E4** items with explicit manual review and evidence-backed executive cards.

---

## 1. Executive Summary

The current EIP ExCo Cockpit proof of concept is too granular for executive use. It exposes a broad set of risks, actions, decisions, memory records, warnings and operational details directly in the ExCo view. This makes the cockpit useful as an intelligence repository, but not yet suitable as an executive attention system.

This change request proposes a shift from a flat dashboard model to a lens-based, hierarchy-aware, policy-governed and escalation-driven intelligence model.

The goal is to ensure that C-level users see only what is relevant to their role and level of accountability, while retaining the ability to drill down into supporting evidence when entitled and when needed.

The dashboard should not decide what executives see. The underlying EIP knowledge and policy model should decide visibility based on governance ownership, organisational layer, impact, urgency, escalation status, evidence quality, review status and access entitlement.

### 1.1 Conditional Approval Position

This change request is approved in principle, subject to a policy-and-data-model design that defines:

- Ownership of classification and escalation.
- Field dictionaries and allowed values.
- Deterministic visibility and escalation rules.
- Evidence requirements.
- Human review routes.
- Override controls.
- Security entitlements.
- Testable acceptance outcomes.

Implementation should begin with a controlled ExCo pilot rather than attempting to release all proposed lenses, all hierarchy levels and full automated escalation at once.

---

## 2. Background and Observed Issue

The current POC cockpit presents enterprise intelligence in a direct and flattened way. The active dashboard exposes high-level counts for meetings, topics, decisions, open actions, memory records, warnings and risks. It also lists detailed risk-classified topics, key decisions and open actions in the same executive-facing surface.

Examples visible in the current cockpit include:

- Product and firmware testing capacity risks.
- SuperPen pilot schedule risks.
- PPWR compliance concerns.
- Amazon inventory constraints.
- Purchase order approval risks.
- Cash-flow and salary funding risks.
- Controlled document library improvements.
- Jira and Confluence navigation concerns.
- Specific owner-level actions assigned to individuals.

These are all valuable intelligence signals, but they do not belong at the same attention level.

The problem is not that the information is wrong. The problem is that the information is not sufficiently classified, governed, layered, filtered or escalated according to audience and governance level.

---

## 3. Problem Statement

The current ExCo Cockpit is too granular because it treats captured intelligence as directly visible executive intelligence.

This creates seven issues:

1. **Executive attention overload**  
   C-level users are exposed to operational and project-level details that should remain with the owning function unless escalated.

2. **Governance confusion**  
   Items owned by Product, Operations, Finance, Compliance, Sales or individual teams appear together without a clear distinction between ownership, accountability, governance and executive relevance.

3. **Weak escalation logic**  
   A low-level operational problem and a company-level financial risk can both appear simply as risks, even though they require very different levels of attention and action.

4. **Poor role fit**  
   A CEO, CFO, COO and CPO need different views of the same organisational memory. The current experience does not sufficiently adapt the same underlying evidence to different executive responsibilities.

5. **Missing classification operating model**  
   The system does not yet define who creates, approves, changes or de-escalates hierarchy, escalation, attention audience and accountable executive classifications.

6. **Insufficient determinism**  
   Terms such as “cross-functional”, “worsening”, “exceeds threshold” and “commitment at risk” need explicit threshold rules, evidence windows and precedence logic.

7. **Risk of false authority**  
   Compressed executive cards can look like verified management conclusions even when they are system-generated synthesis from partial evidence. Confidence, review status and source basis must be visible.

---

## 4. Change Objective

Introduce a governance-aware cockpit architecture that supports:

- Role-based executive views.
- Hierarchical and graph-based drill-down.
- Escalation-based attention visibility.
- Separation between ownership, governance, attention, ranking and entitlement.
- Evidence-backed decision and risk visibility.
- Measurable visibility rules.
- Governed classification and escalation lifecycle.
- Executive summaries that show only what requires attention at the selected level.

The intended outcome is that EIP becomes an executive attention system, not just a captured intelligence dashboard.

---

## 5. Target Architectural Model

The proposed target model has six layers.

```text
Evidence Layer
    ↓
Topic Memory Layer
    ↓
Policy Governance Layer
    ↓
Escalation and Review Layer
    ↓
Lens and Ranking Layer
    ↓
Dashboard / Cockpit Presentation Layer
```

### 5.1 Evidence Layer

The evidence layer contains the raw or semi-processed source material behind EIP memory.

Evidence may include:

- Meeting transcripts.
- Meeting chat.
- Emails.
- Teams messages.
- Files.
- Jira issues.
- Confluence pages.
- NetSuite records.
- Manual notes.
- Human feedback.

Evidence must remain traceable. Evidence does not automatically become a governed risk, decision or executive conclusion.

### 5.2 Topic Memory Layer

The Topic Memory Layer stores durable organisational topics and their relationships.

This layer should answer:

- What is the topic?
- What evidence supports it?
- What is its current state?
- What related topics, decisions, risks and actions exist?
- What has changed since the previous review?

### 5.3 Policy Governance Layer

This is the new required layer introduced by v0.2.

The Policy Governance Layer defines how topics become visible, escalated, classified, reviewable and auditable.

It should define:

- Field dictionaries.
- Allowed values.
- Default values.
- Derivation logic.
- Policy version.
- Human policy owner.
- Review cadence.
- Validation requirements.
- Override rules.
- Lifecycle rules.

Without this layer, lenses risk becoming cosmetic UI filters rather than governed executive intelligence.

### 5.4 Escalation and Review Layer

This layer manages promotion, review, override, expiry and de-escalation.

It should answer:

- Who proposed the escalation?
- Was it system-suggested or human-approved?
- What evidence triggered it?
- Who approved it?
- When must it be reviewed?
- What condition allows de-escalation?
- Has it expired?
- Has any override been applied?

### 5.5 Lens and Ranking Layer

This layer adapts the canonical topic state to each audience.

It must separate:

- **Lens relevance:** Should this role care about the item?
- **Attention visibility:** Should it be shown by default?
- **Ranking:** How prominent should it be?
- **Access entitlement:** Is the user allowed to open the underlying detail or evidence?

### 5.6 Dashboard / Cockpit Presentation Layer

The cockpit should present executive intelligence at the appropriate altitude.

It should not contain hidden business rules that materially change classification, escalation or entitlement. Those rules belong in the Policy Governance Layer.

---

## 6. Audience Lens Model

Add configurable role-based lenses. Each lens should use the same underlying Topic Memory Model and governed policy framework, but apply different relevance, wording, ranking and default layer-depth rules.

Proposed lenses:

| Lens | Primary Purpose |
|---|---|
| CEO | Enterprise-level attention, strategic risk, cross-functional drift, decision pressure |
| ExCo | Shared executive operating picture, escalated risks, major decisions, dependencies |
| COO | Operations, supply chain, compliance execution, process ownership, business continuity |
| CPO | Product strategy, NPI, R&D delivery, product readiness, launch risk, roadmap impact |
| CFO | Cash-flow, working capital, revenue timing, stock funding, margin and financial exposure |
| Sales / Commercial | Pipeline, sales execution, customer commitments, forecast risk, availability constraints |
| Board | Strategic exposure, fiduciary risk, major investment decisions, extreme escalations only |

### 6.1 Canonical Escalation vs Per-Lens Relevance

The model must maintain one canonical escalation state for each item.

It must not create conflicting escalation states per lens.

Instead:

```text
Canonical escalation level = how far the issue has been formally escalated.
Per-lens relevance = how relevant the item is to a role.
Per-lens ranking = how prominently the item should appear for that role.
Access entitlement = whether the user can open the detail or evidence.
```

Example:

| Topic | Canonical Escalation | CFO Relevance | CPO Relevance | ExCo Visibility |
|---|---:|---:|---:|---:|
| Product delay with revenue impact | E3 | High | High | Show only if E4 trigger is met or manually escalated |
| Supplier evidence gap | E2 | Medium | Medium | Hidden from ExCo unless compliance or shipment threshold is crossed |
| Cash coverage risk | E4 | High | Medium | Visible in ExCo |

---

## 7. Hierarchy and Relationship Model

### 7.1 Primary Hierarchy

The cockpit should support clear navigation from enterprise view into detail.

Suggested hierarchy:

| Layer | Description | Example |
|---|---|---|
| L0 Enterprise | Whole-company issues | Cash runway, company-wide risk, strategic exposure |
| L1 Executive Domain | Major accountable area | Product, Finance, Operations, Sales, People |
| L2 Capability / Function | Organisational capability | R&D, Compliance, Supply Chain, Education |
| L3 Programme / Product | Programme or product family | SuperPen, C-Pen C910x, ER3 |
| L4 Project / Release | Specific release or initiative | M13, ER3 launch, PPWR readiness |
| L5 Workstream | Delivery area | Firmware, hardware, packaging, compliance evidence |
| L6 Task / Action | Specific owner-level action | Confirm glue specification, approve purchase order |
| L7 Evidence | Source material | Transcript, email, Teams message, file, Jira issue |

### 7.2 Graph Relationships

A pure tree is not sufficient. EIP topics regularly span multiple domains.

The model should therefore support:

- One optional `primary_parent_topic_id` for navigation.
- Multiple typed relationships for governance, impact, dependency and evidence mapping.

Required relationship structure:

```json
{
  "source_topic_id": "topic_superpen_pilot",
  "target_topic_id": "topic_cash_flow",
  "relationship_type": "financial_impact",
  "strength": "medium",
  "evidence_count": 3,
  "policy_version": "EIP-POLICY-2026-08-001"
}
```

Suggested relationship types:

| Relationship Type | Meaning |
|---|---|
| primary_parent | Main navigation parent |
| relates_to | General relationship |
| blocks | Source blocks target |
| depends_on | Source depends on target |
| duplicates | Source duplicates target |
| mitigates | Source mitigates target |
| escalates_to | Source escalates to target |
| financial_impact | Source affects financial exposure |
| compliance_impact | Source affects compliance exposure |
| customer_impact | Source affects customer commitment |
| delivery_impact | Source affects delivery or launch |
| people_impact | Source affects people, HR or capacity |
| evidence_for | Source is evidence for target |
| decision_for | Source is a decision related to target |
| action_for | Source is an action related to target |

---

## 8. Escalation Model

### 8.1 Escalation Levels

| Escalation Level | Audience | Description |
|---|---|---|
| E0 Evidence | System / analyst | Raw captured evidence, not directly actionable |
| E1 Operational | Team / owner | Local issue or action owned within a team |
| E2 Management | Head of department / functional lead | Requires management attention or prioritisation |
| E3 Executive | C-level owner | Requires executive awareness or decision support |
| E4 ExCo | Executive committee | Cross-functional impact, trade-off or company-level exposure |
| E5 Board | Board / shareholders | Strategic, fiduciary, legal, funding or survival-level exposure |

Only E3 and above should normally appear in executive-level lenses. E1 and E2 items should remain available through drill-down, watchlists, owner views or governance queues.

### 8.2 Escalation Lifecycle

Each escalated item should follow a governed lifecycle.

```text
Detected / Captured
    ↓
Classified
    ↓
Escalation Proposed
    ↓
Evidence Checked
    ↓
Approved / Rejected / Needs Review
    ↓
Active Escalation
    ↓
Review Due
    ↓
De-escalated / Reconfirmed / Closed / Expired
```

### 8.3 Escalation States

| State | Meaning |
|---|---|
| detected | Signal exists but has not been classified |
| classified | Topic has basic domain, owner and type metadata |
| proposed | System or human has proposed escalation |
| needs_review | Required evidence, owner or policy data is incomplete |
| approved | Escalation has been approved by authorised actor |
| active | Item is actively escalated and visible according to policy |
| rejected | Escalation was reviewed and rejected |
| overridden | Human override changes visibility or ranking |
| review_due | Item requires revalidation |
| stale | Review date has passed without confirmation |
| de_escalated | Item has been lowered to a lower level |
| closed | Item is no longer active |
| expired | Time-bound escalation lapsed without renewal |

### 8.4 Approval Authority by Level

| Escalation Level | Proposal Source | Approval Authority | Required Evidence |
|---|---|---|---|
| E1 | System or owner | Operational owner | At least one evidence source or manual owner note |
| E2 | System, owner, HoD | Functional owner / HoD | Evidence source plus owner or domain classification |
| E3 | System, HoD, executive | Accountable executive or delegated governance reviewer | Evidence pack, escalation reason, review date |
| E4 | System recommendation or executive | ExCo secretary, CEO, accountable executive or agreed governance process | Evidence pack, cross-functional or company-level rationale, review date |
| E5 | Executive / Board process | Board or authorised corporate governance process | Formal evidence pack, legal/financial/strategic rationale |

### 8.5 Deterministic Rules and Thresholds

Escalation rules must be deterministic enough to test.

Each rule should define:

- Rule ID.
- Policy version.
- Trigger condition.
- Evidence window.
- Required evidence count or evidence type.
- Required metadata completeness.
- Default escalation level.
- Precedence over conflicting rules.
- Review frequency.
- De-escalation condition.

Example structure:

```json
{
  "rule_id": "EIP-ESC-CASH-001",
  "policy_version": "EIP-POLICY-2026-08-001",
  "trigger": "cash_coverage_risk",
  "evidence_window_days": 14,
  "required_evidence_types": ["meeting", "finance_record"],
  "default_escalation_level": "E4",
  "requires_human_review": true,
  "review_frequency_days": 7,
  "de_escalation_condition": "cash_coverage_confirmed_or_no_longer_at_risk"
}
```

Thresholds should be configured, not hard-coded in dashboard UI.

---

## 9. Policy Specification

A canonical policy specification is required before moving to full implementation.

### 9.1 Policy Object

Each policy version should include:

| Field | Purpose |
|---|---|
| policy_id | Stable policy identifier |
| version | Version number |
| status | Draft, active, retired |
| effective_date | Date policy becomes active |
| approved_by | Human or governance group approving the policy |
| owner | Policy owner responsible for maintenance |
| review_cadence | When policy must be reviewed |
| field_dictionary | Allowed fields and values |
| escalation_rules | Rule set for escalation |
| lens_rules | Rule set for relevance and ranking |
| entitlement_rules | Rule set for user access |
| override_rules | Rules for manual overrides |
| regression_tests | Standard scenario tests |

### 9.2 Field Dictionary Requirement

Every governed metadata field must define:

- Field name.
- Purpose.
- Allowed values.
- Default value.
- Authoritative source.
- Derivation logic.
- Validation rule.
- Reviewer.
- Review frequency.
- Whether human approval is required.
- Whether the field can be overwritten manually.

### 9.3 Initial Governed Fields

| Field | Required? | Authoritative Source | Default | Review Route |
|---|---:|---|---|---|
| topic_id | Yes | Topic Memory Model | Generated | System validation |
| primary_parent_topic_id | Recommended | Topic policy / reviewer | None | Governance reviewer |
| relationships | Yes | Topic graph builder plus reviewer | Empty array | Governance reviewer |
| hierarchy_layer | Yes | Policy engine proposal plus reviewer | Unknown | Governance queue |
| governance_domain | Yes | Policy dictionary plus reviewer | Unknown | Domain owner |
| accountable_executive_role | Yes | Governance policy | Unknown | Executive governance review |
| operational_owner | Yes | Extracted, assigned or reviewed | Unknown | Functional owner |
| attention_visibility | Yes | Policy engine | Hidden unless criteria met | Governance queue |
| lens_relevance | Yes | Lens policy | None | Policy test suite |
| lens_ranking | Recommended | Lens policy | Standard | Policy test suite |
| access_entitlement_class | Yes | Security policy | Restricted | System/security owner |
| escalation_level | Yes | Escalation policy | E0 | Governance reviewer |
| escalation_state | Yes | Escalation lifecycle | detected | Governance reviewer |
| escalation_reason | Yes if escalated | Policy engine or reviewer | None | Governance reviewer |
| escalation_trigger | Recommended | Rule engine | None | Governance reviewer |
| escalation_provenance | Yes | System audit log | System generated | Audit trail |
| de_escalation_condition | Recommended | Escalation policy | None | Governance reviewer |
| evidence_confidence | Yes | Evidence model | Low | Evidence reviewer |
| evidence_count_by_type | Recommended | Evidence index | 0 | System validation |
| impact_dimension | Yes | Policy engine plus reviewer | Unknown | Domain owner |
| urgency | Yes if visible above E2 | Policy engine plus reviewer | Unknown | Governance reviewer |
| trend | Recommended | Time-series evidence model | Unknown | Governance reviewer |
| decision_required | Yes | Policy engine plus reviewer | No | Accountable executive |
| next_review_date | Yes if escalated | Escalation policy | Required | Governance reviewer |

---

## 10. Classification Operating Model

### 10.1 Actors

| Actor | Role |
|---|---|
| Extraction pipeline | Captures evidence and proposes candidate topics, owners, domains and relationships |
| Policy engine | Applies deterministic rules and proposes classification, visibility and escalation |
| Functional owner | Confirms owner, domain, operational status and local actions |
| Accountable executive | Confirms executive relevance, decision requirement and E3-level escalation |
| ExCo governance reviewer / secretary | Reviews E4 visibility, cross-functional items and stale escalations |
| Security / entitlement owner | Maintains access entitlement rules and sensitive category restrictions |
| Human user with permission | Can propose correction, pin item, override visibility or request review within allowed scope |

### 10.2 Classification Flow

```text
Evidence captured
    ↓
Candidate topic created or matched
    ↓
Initial metadata proposed
    ↓
Policy engine applies rules
    ↓
Missing fields sent to governance queue
    ↓
Owner/domain reviewer confirms or corrects
    ↓
Escalation proposed where rules match
    ↓
Authorised reviewer approves, rejects or requests evidence
    ↓
Lens output generated
    ↓
Dashboard displays only permitted and relevant items
```

### 10.3 Governance Queue Requirements

Missing or low-confidence fields should not just appear as generic validation warnings.

They should create governance work items such as:

- Missing operational owner.
- Missing governance domain.
- Missing accountable executive.
- Missing escalation reason.
- Missing evidence confidence.
- Escalation review overdue.
- Manual override expiring.
- Conflicting topic relationships.
- Access entitlement unresolved.

Each governance queue item should include:

- Field needing review.
- Recommended value.
- Evidence basis.
- Assigned reviewer.
- Review due date.
- Impact if unresolved.

---

## 11. Separation of Concerns

The cockpit must separate three concerns that are often confused.

### 11.1 Lens Relevance and Ranking

This answers:

- Is the topic relevant to this role?
- How high should it appear?
- What wording should be used?

### 11.2 Attention Visibility

This answers:

- Should the item be shown by default?
- Is it escalated enough for this view?
- Is it manually pinned or watchlisted?

### 11.3 Access Entitlement

This answers:

- Can the user open the underlying detail?
- Can the user view evidence?
- Should sensitive content be redacted?
- Can the user export the item?

Audience lens filtering is not security.

Access entitlement must be enforced separately and server-side for sensitive financial, people, legal, board and confidential material.

---

## 12. Evidence, Compression and Confidence

### 12.1 Executive Compression

The cockpit should compress multiple low-level signals into a single executive narrative only when evidence and review requirements are met.

Compression must preserve:

- Source links.
- Evidence count.
- Evidence types.
- Source dates.
- Confidence level.
- Whether the statement is system-generated, owner-confirmed or executive-approved.
- Whether it is a fact, judgement, forecast or synthesis.

### 12.2 Compression Review Status

| Status | Meaning |
|---|---|
| system_generated | Generated by the system from available evidence |
| owner_confirmed | Confirmed by functional owner |
| executive_confirmed | Confirmed by accountable executive |
| disputed | Conflicting evidence or human challenge exists |
| insufficient_evidence | Not enough evidence to support executive summary |

### 12.3 Example Executive Narrative

Low-level signals:

- Firmware testing capacity risk.
- Key person dependency.
- Test engineer vacancy.
- Compliance workload increasing.
- Release scope pressure.

Executive-level summary:

```text
SuperPen delivery capacity may tighten if firmware testing, compliance workload and release scope continue to compete for the same limited resources. This is currently a Product Development management issue and should escalate to ExCo only if pilot delivery or external launch commitments move off track.
```

Required supporting metadata:

- Confidence: Medium or High.
- Evidence count by type.
- Current review status.
- Accountable reviewer.
- Escalation condition.
- De-escalation condition.

---

## 13. Required Functional Changes

### 13.1 Add Lens Selector

Add a primary dashboard selector with at least:

- CEO.
- ExCo.
- COO.
- CPO.
- CFO.
- Sales / Commercial.
- Board.

Each lens should:

- Re-rank topics according to role relevance.
- Hide non-relevant operational detail by default.
- Reword summaries for the selected audience.
- Emphasise different impact dimensions.
- Preserve access to authorised evidence and drill-down.

### 13.2 Add Layer Selector

Add a hierarchy layer control.

Suggested controls:

- Enterprise only.
- Executive domain.
- Programme / product.
- Project / release.
- Workstream.
- Action detail.
- Evidence.

Default settings:

| Lens | Default Layer |
|---|---|
| Board | L0-L1 only |
| CEO | L0-L2 |
| ExCo | L0-L3 |
| CFO | L0-L4, financial impact only |
| COO | L1-L5 for operational domains |
| CPO | L1-L5 for product and R&D domains |
| Product owner / team | L3-L7 |

### 13.3 Add Escalation Gate

Every topic should have an escalation state.

Required fields:

- Current escalation level.
- Recommended escalation level.
- Escalation state.
- Escalation reason.
- Trigger condition.
- Owning function.
- Accountable executive.
- Evidence confidence.
- Last reviewed date.
- Escalated by system or human.
- Review owner.
- De-escalation condition.
- Expiry or next review date.

### 13.4 Add “Why am I seeing this?” Explanation

Each visible executive item should explain why it is displayed.

Suggested format:

```text
Why visible: ExCo-level escalation
Reason: Cross-functional launch dependency and compliance evidence gap
Owner: Operations
Accountable executive: COO
Evidence: 3 meeting references, 1 decision, 2 open actions
Confidence: Medium
Review status: Owner confirmed
Policy version: EIP-POLICY-2026-08-001
Access: Summary visible; evidence restricted by entitlement
```

### 13.5 Add Governed Manual Overrides

Manual pinning and override should be supported, but governed.

Override fields:

| Field | Purpose |
|---|---|
| override_id | Stable override ID |
| actor | Person applying override |
| reason | Why override was applied |
| scope | Lens, topic, audience or time period affected |
| effect | Pin, hide, promote, demote, request review |
| created_date | Date applied |
| expiry_date | When override expires |
| review_date | When override must be reviewed |
| supersedes_policy | Whether it overrides policy or only supplements ranking |
| audit_log | Record of change history |

---

## 14. Executive Visibility Rules

### 14.1 Default ExCo Visibility Rule

Show an item in ExCo only if at least one of the following is true:

- Canonical escalation level is E4 or higher.
- Cross-functional trade-off is required and approved for ExCo visibility.
- Executive decision is required and accountable executive has confirmed ExCo relevance.
- Financial, legal, compliance, people or customer impact crosses a configured threshold.
- Delivery risk affects a committed external milestone and evidence confidence is sufficient.
- Owner is unclear and unresolved beyond the configured review window.
- Issue is worsening across repeated evidence signals within the configured evidence window.
- CEO, ExCo secretary or authorised C-level user has manually pinned it with reason and expiry.

### 14.2 Default CPO Visibility Rule

Show in CPO lens if:

- Product roadmap, NPI, R&D, launch readiness or compliance readiness is affected.
- Product Board or NPI governance is implicated.
- Cross-functional dependencies affect product delivery.
- A delivery blocker threatens a committed milestone.
- A resource risk impacts R&D or product development capacity.
- The item is E2 or above and within the Product Development governance domain.

### 14.3 Default CFO Visibility Rule

Show in CFO lens if:

- Cash-flow, funding, factoring, stock purchasing or working capital is affected.
- Revenue timing is at risk.
- Cost exposure or supplier payment priority is affected.
- A product or operational issue has financial impact.
- The item has financial impact relationship or impact dimension above configured threshold.

### 14.4 Default COO Visibility Rule

Show in COO lens if:

- Supply chain, compliance execution, facilities, HR operations or process ownership is affected.
- Operational readiness or business continuity is at risk.
- Cross-functional execution is blocked by unclear ownership.
- Governance queue items sit within COO-governed domains.

---

## 15. Suggested UI Changes

### 15.1 Top-Level Dashboard Controls

Add controls:

```text
Lens: [CEO] [ExCo] [COO] [CPO] [CFO] [Sales] [Board]
Layer: [Enterprise] [Domain] [Programme] [Product] [Project] [Workstream] [Action] [Evidence]
Escalation: [All] [Escalated only] [Decision required] [Watchlist] [Governance queue]
Impact: [Financial] [Delivery] [Compliance] [Customer] [People] [Operations]
Review: [Approved] [Needs review] [Stale] [Overridden] [Disputed]
```

### 15.2 Executive Cards

Replace raw list-heavy presentation with executive cards.

Each card should include:

- Title.
- Executive summary.
- Current status.
- Trend.
- Impact dimension.
- Governance domain.
- Operational owner.
- Accountable executive.
- Canonical escalation level.
- Why visible.
- Decision required, yes/no.
- Evidence count and confidence.
- Review status.
- Next review date.
- Access entitlement status.
- Drill-down link.

### 15.3 Drill-Down Pattern

Suggested pattern:

```text
Executive Summary
  Why Visible
    Governance Context
      Escalation History
        Related Risks
          Related Decisions
            Related Actions
              Evidence Pack
```

The executive starts at summary level and can expand when permitted and required.

### 15.4 Repository View vs Executive Cockpit

The system should decouple:

- **All Content / Repository View:** investigative workspace for all captured intelligence and review activity.
- **Executive Cockpit View:** curated attention surface based on policy, escalation and lens rules.

This prevents the cockpit from becoming unusable while still preserving full investigative capability.

---

## 16. Acceptance Criteria

### 16.1 Policy and Data-Model Acceptance Criteria

This change may move from conditional approval to implementation approval when:

1. A canonical policy specification exists.
2. Each governed field has allowed values, default value, source, validation rule and reviewer.
3. Escalation lifecycle states are implemented or explicitly supported in the data model.
4. Classifications distinguish system-proposed, owner-confirmed and executive-approved states.
5. Primary hierarchy and typed graph relationships are supported.
6. Lens relevance, attention visibility and access entitlement are modelled separately.
7. Manual overrides include actor, reason, scope, effect, expiry and audit trail.
8. Every E3-E4 item has a review owner and next review date.
9. Stale escalation items are clearly visible to governance reviewers.
10. Policy version is recorded against classifications and visibility decisions.

### 16.2 Executive Cockpit Acceptance Criteria

The first production slice is accepted when:

1. The cockpit supports ExCo plus one domain lens, recommended first domain lens: CPO.
2. Only E3-E4 items are included by default in executive cards.
3. The ExCo view suppresses operational detail unless escalated, pinned or watchlisted.
4. Every visible executive card includes “Why am I seeing this?”.
5. Every visible executive card shows evidence count, confidence, review status and policy version.
6. Items lacking mandatory governance metadata appear in a governance queue, not as unexplained executive noise.
7. Users can drill down from executive summary to evidence only where access entitlement permits.
8. Access entitlement is enforced separately from lens filtering.
9. Manual overrides are visible, auditable and time-bound.
10. Stale escalations are flagged and cannot remain silently visible indefinitely.

### 16.3 Measurable Validation Criteria

The system should track:

| Metric | Target for Pilot |
|---|---|
| Executive card explanation coverage | 100% of visible executive cards |
| Mandatory metadata completeness | 95% or higher for E3-E4 cards |
| Evidence confidence shown | 100% of visible executive cards |
| Review status shown | 100% of visible executive cards |
| Stale escalation count | Visible and reviewable |
| False-positive review rate | Measured during pilot, target to be set after baseline |
| False-negative review rate | Measured during pilot, target to be set after baseline |
| Drill-down rate | Measured to assess card usefulness |
| Decision closure rate | Measured for cards marked decision required |
| Override expiry compliance | 100% of overrides must have expiry or review date |

---

## 17. Policy Simulation and Regression Suite

Before changing the executive default view, run known historical topics through the proposed policy.

### 17.1 Simulation Inputs

For each test topic, capture:

- Raw evidence summary.
- Existing topic classification.
- Proposed hierarchy layer.
- Proposed relationships.
- Proposed governance domain.
- Proposed accountable executive.
- Proposed escalation level.
- Proposed lens relevance.
- Proposed access entitlement class.
- Expected ExCo visibility.
- Expected CPO visibility.
- Expected CFO visibility.
- Expected COO visibility.
- Expected review queue item, if any.

### 17.2 Regression Scenarios

Include test scenarios for:

- Cash-flow risk.
- Product launch delay.
- Compliance evidence gap.
- Stock availability issue.
- Owner missing.
- Conflicting evidence.
- Manually pinned item.
- Stale escalation.
- Sensitive people-related issue.
- Board-level issue.
- Low-level action that should not be visible to ExCo.

### 17.3 Success Condition

The policy simulation should demonstrate that:

- Important executive items are not hidden.
- Operational detail is suppressed unless escalated.
- Sensitive evidence is not exposed by lens selection alone.
- Missing metadata creates review work rather than false certainty.
- Manual overrides behave predictably and expire.
- The ExCo view becomes materially smaller and more decision-focused than All Content.

---

## 18. Implementation Plan

### Phase 0: Policy and Data-Model Design

- Define canonical policy specification.
- Define field dictionaries.
- Define allowed values and defaults.
- Define authoritative sources.
- Define classification operating model.
- Define escalation lifecycle.
- Define access entitlement model.
- Define test scenarios and regression suite.

### Phase 1: Metadata and Governance Queue

- Add hierarchy layer.
- Add primary parent and typed relationships.
- Add governance domain.
- Add accountable executive role.
- Add operational owner.
- Add escalation level and state.
- Add attention visibility.
- Add lens relevance.
- Add access entitlement class.
- Add governance queue for missing or low-confidence fields.

### Phase 2: Controlled ExCo Pilot

- Implement ExCo lens only.
- Include one domain lens, recommended first domain lens: CPO.
- Display E3-E4 cards only by default.
- Require manual review for executive-visible cards.
- Add “Why am I seeing this?”.
- Add evidence confidence and review status.
- Add drill-down with entitlement checks.

### Phase 3: Policy Simulation and Validation

- Run historical topics through the policy suite.
- Compare raw content vs executive-visible output.
- Review false positives and false negatives.
- Tune policy thresholds.
- Validate governance queue behaviour.

### Phase 4: Additional Lenses

After pilot validation, add:

- CFO lens.
- COO lens.
- CEO lens.
- Sales / Commercial lens.
- Board lens.

### Phase 5: Executive Compression and Automation

- Add compression only where evidence and review requirements are met.
- Add confidence labels.
- Add owner-confirmed and executive-confirmed status.
- Add stale escalation automation.
- Add policy analytics and review reports.

---

## 19. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Over-filtering creates dangerous silence | Add safe escalation defaults for legal, cash, compliance, people and customer-commitment indicators; maintain cross-lens watchlist and governance queue |
| Lens rules become subjective or political | Use versioned policy, explicit rules, approval workflow and audit logs |
| Poor metadata quality weakens visibility | Treat missing metadata as governance work, not just warnings |
| Executives over-trust polished cards | Show confidence, evidence count, review status and generation source on every card |
| Operational teams feel hidden | Preserve All Content / Repository View and provide owner-level and management-level views |
| Dashboard becomes complex | Keep default views simple; use progressive disclosure |
| Data sensitivity increases through synthesis | Enforce server-side access entitlement and audience-specific redaction |
| Stale escalation becomes permanent noise | Require review dates, stale indicators and expiry/de-escalation workflow |
| Implementation scope delays value | Start with ExCo plus one domain lens and E3-E4 only |
| Hierarchy misrepresents graph reality | Use primary parent plus typed relationships |

---

## 20. Recommended First Production Slice

The first production slice should be deliberately narrow.

### Include

- ExCo lens.
- One domain lens, recommended: CPO.
- E3-E4 items only.
- Executive cards.
- “Why am I seeing this?”.
- Evidence count and confidence.
- Review status.
- Manual review requirement.
- Governance queue for missing metadata.
- Primary parent plus typed relationships.
- Access entitlement class.
- Manual override with expiry.

### Exclude from First Slice

- Full Board lens.
- Full CFO, COO, CEO and Sales lens rollout.
- Fully automatic escalation without human review.
- Full L5-L7 drill-down as default executive surface.
- Unsupported executive compression.
- Client-only security filtering.

---

## 21. Design Principles

EIP should not be a flat display of everything the organisation knows.

EIP should be a governance-aware intelligence system that decides:

- What is known.
- What is only evidence.
- What is a topic.
- What is a governed risk.
- Who owns it.
- Where it belongs.
- Who needs to see it.
- Why it has been escalated.
- What evidence supports it.
- Who approved the classification.
- When it must be reviewed.
- Whether the user is entitled to open the detail.

The cockpit should present intelligence at the right altitude for the selected audience.

### 21.1 Core Principle

```text
Evidence is not escalation.
Classification is not approval.
Visibility is not access.
Lens relevance is not accountability.
Executive compression is not verified truth unless reviewed.
```

---

## 22. Recommended Decision

Approve EIP-CR-2026-08-13-001 in principle, subject to a policy-and-data-model design that defines ownership, lifecycle, determinism, security entitlements and testable escalation outcomes.

Begin with a controlled ExCo pilot rather than implementing every proposed lens and hierarchy level at once.

Recommended approval wording:

```text
Approve EIP-CR-2026-08-13-001 in principle, subject to a policy-and-data-model design that defines ownership, lifecycle, determinism, security entitlements, and testable escalation outcomes. Begin with a controlled ExCo pilot rather than implementing every proposed lens and hierarchy level at once.
```

---

## 23. Short Name

**EIP Lens, Escalation and Policy Architecture**

Suggested internal label:

```text
EIP-LEPA
```

Previous internal label retained for history:

```text
EIP-LEA
```

