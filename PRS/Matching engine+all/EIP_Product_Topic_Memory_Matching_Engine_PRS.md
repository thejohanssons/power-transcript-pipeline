# Product Requirements Specification (PRS)
## EIP Product – Topic Memory & Matching Engine

### Document Status
Draft v1.0

### Purpose

Build the core EIP Product capability that transforms unstructured organisational activity into a persistent, topic-centric memory system.

The system must:

1. Classify incoming evidence.
2. Match evidence to existing topics.
3. Create new topics when required.
4. Build historical topic memory over time.
5. Generate signals from topic history.
6. Maintain awareness of people, products, organisations, brands and relationships.
7. Operate independently of M365, SharePoint, Google Workspace or Atlassian.

This direction aligns with the existing EIP objective of topic-level records, append-only historical records, comparison-ready history, trend detection, deviation detection and executive intelligence generation.

---

# Product Vision

Move from:

```text
Meetings
  → Summaries
    → Reports
```

To:

```text
Evidence
  → Topics
    → Memory
      → Signals
        → Intelligence
```

Topics become the primary organisational construct.

Meetings become evidence.

---

# Product Principles

## P1. Topic First

The topic is the primary object.

Evidence attaches to topics.

History attaches to topics.

Signals are produced from topics.

---

## P2. History First

The system must preserve business history.

Nothing should overwrite prior state.

All topic evolution must be append-only.

---

## P3. Identity ≠ Label

Topic identity must remain stable.

Topic names may evolve.

Example:

```text
Topic ID
  8f2f-93c1

Labels over time
  Factoring
  Factoring Capacity
  Working Capital & Factoring
```

The topic remains the same.

---

## P4. Configuration Driven

Taxonomy, mappings, thresholds and rules must not be hardcoded.

---

# Scope

## In Scope

- Topic creation
- Topic matching
- Topic history
- Classification
- Relationship extraction
- Entity extraction
- People awareness
- Brand awareness
- Topic signal generation
- Topic search
- Topic retrieval
- Topic linking

## Out of Scope

- Executive dashboards
- Workflow automation
- Task management
- Governance workflows
- Action execution
- Recommendations

---

# Classification Stack

Every evidence record must be classified using:

```text
Domain
  ↓
Topic
  ↓
Context
  ↓
Governance
```

Example:

```text
Financial
  ↓
Working Capital
  ↓
Risk
  ↓
ExCo Attention
```

---

# Topic Object

Each topic shall contain:

```text
Topic ID
Current Label
Historical Labels
Summary
Domain
Context Types
Created Date
Updated Date
Status
People
Products
Organisations
Brands
Relationships
Evidence Links
Signals
History
```

---

# Evidence Object

Each item entering EIP becomes evidence.

Possible sources:

```text
Meeting
Email
Chat
Document
Notebook
Confluence Page
Jira Item
SharePoint Page
Google Document
```

Evidence must remain immutable.

---

# Relationship Model

The system shall support:

```text
Subject
Relationship
Object
```

Examples:

```text
Theo
owns
MVP

Compliance
blocks
Release

Credit Notes
reduce
Factoring Capacity
```

Relationships supplement topic matching.

Relationships do not replace topics.

---

# People Awareness

The system must recognise people.

People must not become topics.

People are associated with topics.

Example:

```text
Topic
  SuperPen MVP

People
  Theo
  Mandar
  Peter
```

If a person leaves the company, topic history remains intact.

---

# Brand Awareness

Topics must support brand association.

Initial brands:

```text
C-Pen
Wizcom / SuperPen
e-pens
```

Cross-brand contamination must be detected and flagged.

---

# Topic Matching Engine

## Objective

Determine whether incoming evidence belongs to:

```text
Existing Topic
```

or

```text
New Topic
```

---

## Inputs

- Evidence record
- Topic catalogue
- Historical topic memory
- Classification metadata

---

## Matching Dimensions

The engine should evaluate:

### Semantic Similarity

Does the evidence discuss similar concepts?

### Entity Similarity

Does it reference similar people, products or organisations?

### Relationship Similarity

Does it describe the same relationships?

### Topic History Similarity

Does it continue prior work?

### Domain Similarity

Are classifications compatible?

### Context Similarity

Are contexts compatible?

### Brand Compatibility

Is the evidence part of the same product ecosystem?

---

## Match Outcomes

### Existing Topic

Evidence appended to topic.

### New Topic

New topic created.

### Uncertain

Topic requires review.

---

# Topic History

Every topic must maintain:

```text
Topic Creation
Topic Evolution
Topic Signals
Topic State Changes
Evidence History
```

History must be append-only.

No previous history may be deleted.

---

# Topic Signals

Future capability.

The system should identify:

```text
Repeated Risks
Repeated Actions
Repeated Decisions
Escalations
Stalled Work
Alignment Drift
Emerging Topics
Declining Topics
```

This builds on the existing EIP concept of trend analysis, stalled-work detection and deviation detection.

---

# User Stories

---

## US1 – Topic Creation

**As an analyst**

I want the system to create new topics

So that previously unseen business issues can be tracked.

### Acceptance Criteria

- New evidence can create a topic.
- Topic receives a unique ID.
- Topic receives initial summary.
- Topic is available for future matching.

---

## US2 – Topic Matching

**As an analyst**

I want evidence matched to existing topics

So that topic history accumulates automatically.

### Acceptance Criteria

- Evidence is evaluated against existing topics.
- Matching score is calculated.
- Matching decision is recorded.
- Evidence is linked to selected topic.

---

## US3 – Topic History

**As an executive**

I want topic history preserved

So that I can understand how issues evolve.

### Acceptance Criteria

- All topic changes are retained.
- Historical evidence is accessible.
- Topics show chronological development.

---

## US4 – Relationship Extraction

**As an analyst**

I want relationships extracted

So that matching quality improves.

### Acceptance Criteria

- Subject identified.
- Relationship identified.
- Object identified.
- Relationship stored against topic.

---

## US5 – People Awareness

**As an executive**

I want people associated with topics

So that ownership and involvement are visible.

### Acceptance Criteria

- People are recognised.
- Multiple people may be linked.
- Person references do not create duplicate topics.

---

## US6 – Brand Awareness

**As a portfolio manager**

I want topics linked to brands

So that cross-brand contamination is prevented.

### Acceptance Criteria

- Brand assigned where possible.
- Brand conflict rules enforced.
- Conflicts logged.

---

## US7 – Topic Retrieval

**As a user**

I want to retrieve topics

So that I can access organisational memory.

### Acceptance Criteria

- Search by topic.
- Search by person.
- Search by product.
- Search by organisation.
- Search by brand.

---

## US8 – Topic Evolution

**As an executive**

I want topic labels to evolve

Without losing history.

### Acceptance Criteria

- Topic label can change.
- Previous labels retained.
- Topic identity remains constant.

---

# Non-Functional Requirements

## NFR1 – Deterministic

Same evidence and same configuration must produce identical results.

---

## NFR2 – Explainable

Every match decision must be auditable.

---

## NFR3 – Append Only

Topic history must never be overwritten.

---

## NFR4 – Portable

Implementation must not depend on M365.

Connectors are external.

---

## NFR5 – Scalable

Architecture must support millions of evidence records and topics.

---

# Cloudflare Architecture (Logical)

```text
Connectors
(M365, Google, Atlassian)
          ↓
Evidence Pipeline
          ↓
Classification Layer
          ↓
Topic Matching Engine
          ↓
Topic Memory Store
          ↓
Signal Generation
          ↓
Intelligence Layer
```

## Cloudflare Services

```text
Workers
   Orchestration

D1
   Topic Memory
   Metadata

Vectorize
   Similarity Search
   Embeddings

R2
   Evidence Storage

Workers AI
   Extraction
   Embeddings
   Enrichment
```

---

# MVP Success Criteria

The MVP is successful when:

1. New evidence can be ingested.
2. Evidence can be matched to existing topics.
3. New topics can be created automatically.
4. Topic history accumulates over time.
5. People, brands and relationships are captured.
6. Topic retrieval is possible.
7. Matching decisions are explainable.
8. No manual topic catalogue is required.
9. No pre-defined topic IDs are required.
10. Topic memory persists independently of source systems.
