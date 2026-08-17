# Change Request: EIP Cockpit Lens, Hierarchy and Escalation Model

**Change Request ID:** EIP-CR-2026-08-13-001  
**Date:** 13 August 2026  
**Requested by:** Peter Johansson  
**System / Product:** EIP ExCo Cockpit / Executive Intelligence Platform  
**Status:** Draft for review  
**Priority:** High  
**Change Type:** Product architecture, information model, dashboard UX, governance logic

---

## 1. Executive Summary

The current EIP ExCo Cockpit proof of concept is too granular for executive use. It exposes a broad set of risks, actions, decisions, memory records, warnings and operational details directly in the ExCo view. This makes the cockpit useful as an intelligence repository, but not yet suitable as an executive attention system.

This change request proposes a shift from a flat dashboard model to a lens-based, hierarchy-aware and escalation-driven intelligence model.

The goal is to ensure that C-level users see only what is relevant to their role and level of accountability, while retaining the ability to drill down into supporting evidence when needed.

The dashboard should not decide what executives see. The underlying EIP knowledge model should decide visibility based on governance ownership, organisational layer, impact, urgency, escalation status and evidence quality.

---

## 2. Background and Observed Issue

The current POC cockpit presents enterprise intelligence in a direct and flattened way. The active dashboard currently exposes high-level counts for meetings, topics, decisions, open actions, memory records, warnings and risks. It also lists detailed risk-classified topics, key decisions and open actions in the same executive-facing surface.

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

The problem is not that the information is wrong. The problem is that the information is not sufficiently layered, filtered or escalated according to audience and governance level.

---

## 3. Problem Statement

The current ExCo Cockpit is too granular because it treats captured intelligence as directly visible executive intelligence.

This creates four issues:

1. **Executive attention overload**  
   C-level users are exposed to operational and project-level details that should remain with the owning function unless escalated.

2. **Governance confusion**  
   Items owned by Product, Operations, Finance, Compliance, Sales or individual teams appear together without a clear distinction between ownership and executive relevance.

3. **Weak escalation logic**  
   A low-level operational problem and a company-level financial risk can both appear simply as risks, even though they require very different levels of attention and action.

4. **Poor role fit**  
   A CEO, CFO, COO and CPO need different views of the same organisational memory. The current experience does not sufficiently adapt the same underlying evidence to different executive responsibilities.

---

## 4. Change Objective

Introduce a governance-aware cockpit architecture that supports:

- Role-based executive views.
- Hierarchical drill-down layers.
- Escalation-based visibility.
- Separation between ownership, governance and attention.
- Evidence-backed decision and risk visibility.
- Executive summaries that show only what requires attention at the selected level.

The intended outcome is that EIP becomes an executive attention system, not just a captured intelligence dashboard.

---

## 5. Proposed Conceptual Model

### 5.1 Audience Lens

Add configurable role-based lenses. Each lens should use the same underlying Topic Memory Model, but apply different visibility, wording, grouping and priority rules.

Proposed initial lenses:

| Lens | Primary Purpose |
|---|---|
| CEO | Enterprise-level attention, strategic risk, cross-functional drift, decision pressure |
| ExCo | Shared executive operating picture, escalated risks, major decisions, dependencies |
| COO | Operations, supply chain, compliance execution, process ownership, business continuity |
| CPO | Product strategy, NPI, R&D delivery, product readiness, launch risk, roadmap impact |
| CFO | Cash-flow, working capital, revenue timing, stock funding, margin and financial exposure |
| Sales / Commercial | Pipeline, sales execution, customer commitments, forecast risk, availability constraints |
| Board | Strategic exposure, fiduciary risk, major investment decisions, extreme escalations only |

### 5.2 Hierarchical Layers

Introduce a clear organisational and topic hierarchy.

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

The cockpit should allow users to start high and drill down only when needed.

### 5.3 Escalation Levels

Introduce explicit escalation levels.

| Escalation Level | Audience | Description |
|---|---|---|
| E0 Evidence | System / analyst | Raw captured evidence, not directly actionable |
| E1 Operational | Team / owner | Local issue or action owned within a team |
| E2 Management | Head of department / functional lead | Requires management attention or prioritisation |
| E3 Executive | C-level owner | Requires executive awareness or decision support |
| E4 ExCo | Executive committee | Cross-functional impact, trade-off or company-level exposure |
| E5 Board | Board / shareholders | Strategic, fiduciary, legal, funding or survival-level exposure |

Only E3 and above should normally appear in executive-level lenses. E1 and E2 items should remain available through drill-down, watchlists or owner views.

---

## 6. Required Functional Changes

### 6.1 Add Lens Selector

Add a primary dashboard selector with at least:

- CEO
- ExCo
- COO
- CPO
- CFO
- Sales / Commercial
- Board

Each lens should:

- Re-rank topics according to role relevance.
- Hide non-relevant operational detail by default.
- Reword summaries for the selected audience.
- Emphasise different impact dimensions.
- Preserve access to evidence and drill-down.

Example:

| Topic | CPO View | CFO View | ExCo View |
|---|---|---|---|
| SuperPen pilot delay | Launch readiness and R&D dependency risk | Revenue timing and stock funding impact | Cross-functional launch risk requiring alignment |
| PPWR evidence | Product compliance launch dependency | Customs and shipment risk | Regulatory and supply-chain exposure |
| Salary cash gap | Not primary unless it affects delivery capacity | Cash coverage issue | Company-level operating risk |

### 6.2 Add Layer Selector

Add a hierarchy layer control.

Suggested controls:

- Enterprise only
- Executive domain
- Programme / product
- Project / release
- Workstream
- Action detail
- Evidence

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

### 6.3 Add Escalation Gate

Every topic should have an escalation state.

Required fields:

- Current escalation level.
- Recommended escalation level.
- Escalation reason.
- Trigger condition.
- Owning function.
- Accountable executive.
- Evidence confidence.
- Last reviewed date.
- Escalated by system or human.
- De-escalation condition.

Example escalation reasons:

- Financial impact above threshold.
- Cross-functional dependency unresolved.
- Decision overdue.
- Launch commitment at risk.
- Compliance blocker.
- Customer commitment affected.
- Repeated unresolved signal across meetings, emails or chats.
- Owner missing or unclear.
- Issue trending worse.

### 6.4 Add “Why am I seeing this?” Explanation

Each visible executive item should explain why it is displayed.

Suggested format:

```text
Why visible: ExCo-level escalation
Reason: Cross-functional launch dependency and compliance evidence gap
Owner: Operations
Accountable executive: COO
Evidence: 3 meeting references, 1 decision, 2 open actions
Confidence: Medium
```

This is essential to prevent the dashboard from becoming a noisy list.

### 6.5 Separate Owner, Governance and Attention

Entity model should distinguish:

| Field | Meaning |
|---|---|
| Owner | Person or team responsible for execution |
| Governance domain | Where the work belongs organisationally |
| Accountable executive | C-level owner or sponsor |
| Attention audience | Who should currently see it |
| Escalation level | How far up the organisation it has moved |

Example:

```text
Issue: Firmware testing bottleneck
Owner: Mandar / R&D
Governance domain: Product Development
Accountable executive: CPO
Attention audience: CPO lens
Escalation level: E2 Management, unless launch commitment is at risk
```

### 6.6 Add Executive Compression

The cockpit should compress multiple low-level signals into a single executive narrative.

Example:

Low-level signals:

- Firmware testing capacity risk.
- Gaurav overloaded.
- Test engineer vacancy.
- Compliance workload increasing.
- M13 scope pressure.

Executive-level summary:

```text
SuperPen delivery capacity is tightening due to firmware testing bottlenecks, compliance workload and unresolved resourcing constraints. Current impact is contained within Product Development, but should escalate to ExCo if pilot delivery or launch commitments move off track.
```

The executive should not need to read every raw source unless they choose to drill down.

---

## 7. Required Data Model Changes

Add or confirm support for the following metadata fields on topics, risks, decisions and actions.

| Field | Required? | Purpose |
|---|---:|---|
| topic_id | Yes | Stable topic identity |
| parent_topic_id | Yes | Hierarchical topic graph |
| hierarchy_layer | Yes | L0-L7 layer classification |
| governance_domain | Yes | Organisational ownership |
| accountable_executive_role | Yes | CEO, CFO, COO, CPO, etc. |
| operational_owner | Yes | Person/team executing the work |
| attention_audience | Yes | Who should currently see it |
| escalation_level | Yes | E0-E5 visibility level |
| escalation_reason | Yes | Why it was escalated |
| escalation_trigger | Recommended | Rule or signal causing escalation |
| de_escalation_condition | Recommended | What makes it safe to lower visibility |
| evidence_confidence | Yes | Low, medium, high |
| evidence_count_by_type | Recommended | Meetings, emails, chats, files, Jira, etc. |
| impact_dimension | Yes | Financial, delivery, compliance, customer, people, operational |
| urgency | Yes | Low, medium, high, critical |
| trend | Recommended | Improving, stable, worsening, unknown |
| decision_required | Yes | Whether an executive decision is required |
| next_review_date | Recommended | Governance review timing |

---

## 8. Proposed Rules for Executive Visibility

### 8.1 Default ExCo Visibility Rule

Show an item in ExCo only if at least one of the following is true:

- Escalation level is E4 or higher.
- Cross-functional trade-off is required.
- Executive decision is required.
- Financial, legal, compliance or customer impact exceeds threshold.
- Delivery risk affects a committed external milestone.
- Owner is unclear or accountability conflict exists.
- Issue is worsening across repeated evidence signals.
- CEO or C-level user has manually pinned it.

### 8.2 Default CPO Visibility Rule

Show in CPO lens if:

- Product roadmap, NPI, R&D, launch readiness or compliance readiness is affected.
- Product Board or NPI governance is implicated.
- Cross-functional dependencies affect product delivery.
- A delivery blocker threatens a committed milestone.
- A resource risk impacts R&D or product development capacity.

### 8.3 Default CFO Visibility Rule

Show in CFO lens if:

- Cash-flow, funding, factoring, stock purchasing or working capital is affected.
- Revenue timing is at risk.
- Cost exposure or supplier payment priority is affected.
- A product or operational issue has financial impact.

### 8.4 Default COO Visibility Rule

Show in COO lens if:

- Supply chain, compliance execution, facilities, HR operations or process ownership is affected.
- Operational readiness or business continuity is at risk.
- Cross-functional execution is blocked by unclear ownership.

---

## 9. Suggested UI Changes

### 9.1 Top-Level Dashboard Controls

Add controls:

```text
Lens: [CEO] [ExCo] [COO] [CPO] [CFO] [Sales] [Board]
Layer: [Enterprise] [Domain] [Programme] [Product] [Project] [Workstream] [Action] [Evidence]
Escalation: [All] [Escalated only] [Decision required] [Watchlist]
Impact: [Financial] [Delivery] [Compliance] [Customer] [People] [Operations]
```

### 9.2 Executive Cards

Replace raw list-heavy presentation with executive cards.

Each card should include:

- Title.
- Summary.
- Current status.
- Trend.
- Impact dimension.
- Owner.
- Accountable executive.
- Why visible.
- Decision required, yes/no.
- Drill-down link.

### 9.3 Drill-Down Pattern

Suggested pattern:

```text
Executive Summary
  Governance Context
    Related Risks
      Related Decisions
        Related Actions
          Evidence Pack
```

The executive starts at summary level and can expand when required.

---

## 10. Acceptance Criteria

This change is accepted when:

1. The cockpit supports at least ExCo, COO, CPO and CFO lenses.
2. Each lens shows materially different content prioritisation from the same underlying topic data.
3. The ExCo view suppresses operational detail unless escalated.
4. Every visible executive item includes a “Why am I seeing this?” explanation.
5. Each topic has an assigned hierarchy layer.
6. Each risk/action/decision has an escalation level.
7. Users can drill down from executive summary to evidence without losing context.
8. Governance ownership and executive attention are separate fields.
9. The system can distinguish between evidence-only items and escalated governance items.
10. The model supports manual override or pinning by authorised users.

---

## 11. Suggested Implementation Phases

### Phase 1: Model and Metadata

- Add hierarchy layer field.
- Add escalation level field.
- Add governance domain field.
- Add accountable executive role.
- Add attention audience.
- Add escalation reason.

### Phase 2: Lens Rules

- Define initial lens rules for ExCo, COO, CPO and CFO.
- Implement role-specific ranking and filtering.
- Establish default layer depth by lens.

### Phase 3: UI Refactor

- Add lens selector.
- Add layer selector.
- Add escalation filter.
- Replace flat risk/action lists with executive cards.
- Add drill-down flows.

### Phase 4: Executive Compression

- Group low-level signals into higher-level executive narratives.
- Add evidence packs behind each executive item.
- Add “why visible” explanation.

### Phase 5: Validation

- Test against known EIP topics.
- Validate with ExCo lens first.
- Compare raw intelligence vs executive-visible intelligence.
- Confirm that operational detail is suppressed unless correctly escalated.

---

## 12. Risks and Considerations

| Risk | Mitigation |
|---|---|
| Over-filtering hides important issues | Provide watchlists, manual pinning and escalation triggers |
| Lens rules become subjective | Keep rules explicit, auditable and configurable |
| Poor metadata quality weakens visibility | Add validation warnings for missing owner, domain or escalation level |
| Executives lose trust if items appear without reason | Make “Why am I seeing this?” mandatory |
| Operational teams feel hidden | Provide owner-level and management-level views separate from ExCo |
| Dashboard becomes complex | Keep default views simple, use progressive drill-down |

---

## 13. Design Principle

EIP should not be a flat display of everything the organisation knows.

EIP should be a governance-aware intelligence system that decides:

- What is known.
- Who owns it.
- Where it belongs.
- Who needs to see it.
- Why it has been escalated.
- What evidence supports it.

The cockpit should present intelligence at the right altitude for the selected audience.

---

## 14. Recommended Decision

Approve this change request as a core architectural enhancement to the EIP Cockpit.

The immediate priority should be to implement the ExCo, COO, CPO and CFO lenses, combined with hierarchy layers and escalation rules. This will make the cockpit more suitable for executive governance while preserving the depth of the underlying EIP memory model.

---

## 15. Short Name

**EIP Lens and Escalation Architecture**

Suggested internal label:

```text
EIP-LEA
```

