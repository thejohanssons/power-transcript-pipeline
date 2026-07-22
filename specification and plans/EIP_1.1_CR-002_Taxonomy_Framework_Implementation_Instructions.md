# EIP 1.1 Change Request
## CR-002: Taxonomy Framework Implementation

### Objective

Replace the current taxonomy model with a configuration-driven taxonomy framework supporting:

```text
DOMAIN
TOPIC
CATEGORY
CONTEXT_TYPE
TAGS
```

and Topic Families.

This change is independent of Topic Record generation and applies only to classification and storage metadata.

---

# Design Principles

## Stable

The following must remain controlled vocabularies:

```text
DOMAIN
CATEGORY
CONTEXT_TYPE
TAGS
```

## Expandable

The following must support controlled growth without code changes:

```text
TOPIC FAMILY
TOPIC
```

All vocabulary must be loaded from configuration files.

No taxonomy values may be hardcoded.

---

# Required Taxonomy Structure

```yaml
DOMAIN
TOPIC
CATEGORY
CONTEXT_TYPE
TAGS
```

---

# DOMAIN Vocabulary

Purpose:

```text
Where in the business
```

Allowed values:

```yaml
Product:
Sales:
Marketing:
Technology:
IT:
Operations:
SupplyChain:
Finance:
People:
Governance:
```

Rules:

- Mandatory
- Exactly one DOMAIN per Topic Record
- DOMAIN is intended for organisational analytics
- DOMAIN must remain stable over time

---

# TOPIC Model

Purpose:

```text
What is being discussed
```

Structure:

```yaml
TOPIC:
  FAMILY:
  NAME:
```

Example:

```yaml
TOPIC:
  FAMILY: Product
  NAME: Firmware
```

Example:

```yaml
TOPIC:
  FAMILY: Process
  NAME: NPI
```

Rules:

- Mandatory
- Exactly one Topic Family
- Exactly one Topic Name
- Topic Name may expand over time
- Topic Family must come from configuration

---

# Topic Families

## Product

```yaml
- MVP
- Roadmap
- Feature
- Firmware
- Hardware
- Software
- User Experience
- Architecture
- Quality
- Compliance
- Performance
- Security
```

## Delivery

```yaml
- Readiness
- Milestone
- Dependency
- Timeline
- Release
- Pilot
- Trial
- Validation
- Production
- Deployment
```

## Commercial

```yaml
- Sales Performance
- Sales Forecast
- Pricing
- Pipeline
- Revenue
- Margin
- Budget
- Market Opportunity
- Partner
- Channel
```

## Customer

```yaml
- Adoption
- Feedback
- Support
- Onboarding
- Retention
- Usage
- Training
- Customer Success
```

## People

```yaml
- Recruitment
- Retention
- Capability
- Capacity
- Career Framework
- Team Structure
- Leadership
- Competence
```

## Process

```yaml
- NPI
- Stage Gate
- Governance
- Decision Making
- Risk Management
- Quality Process
- Change Control
- Continuous Improvement
```

## Technology

```yaml
- AI
- Automation
- Data
- Cloud
- Infrastructure
- Developer Tooling
- Integration
- Security
```

## Operations

```yaml
- Manufacturing
- Supply Chain
- Inventory
- Procurement
- Logistics
- Service
- Support Operations
```

## Strategy

```yaml
- Business Model
- Growth
- Transformation
- Innovation
- Portfolio
- Investment
- Market Position
- Competition
```

---

# CATEGORY Vocabulary

Purpose:

```text
Why it matters
```

Allowed values:

```yaml
- Risk
- Issue
- Action
- Decision
- Progress
- Opportunity
- Dependency
- Strategy
- Insight
```

Rules:

- Mandatory
- Exactly one value

---

# CONTEXT_TYPE Vocabulary

Purpose:

```text
What type of statement it is
```

Allowed values:

```yaml
- Discussion
- Update
- Decision
- Agreement
- Proposal
- Concern
- Commitment
- Observation
- Assumption
```

Rules:

- Mandatory
- Exactly one value

---

# TAG Vocabulary

Purpose:

```text
Cross-cutting themes
```

Allowed values:

```yaml
- AI
- Automation
- Strategy
- NPI
- Governance
- Compliance
- Security
- Quality
- Cost
- Revenue
- Customer
- Pilot
- Trial
- Product
- Operations
```

Rules:

- Optional
- Multiple values allowed

---

# Configuration Requirements

Create:

```text
taxonomy/
|
|-- domains.yaml
|-- topic_families.yaml
|-- categories.yaml
|-- context_types.yaml
`-- tags.yaml
```

All classification must load from configuration files.

No taxonomy values may be embedded in prompts, code, or parser logic.

---

# Topic Record Integration

Every Topic Record must include:

```yaml
DOMAIN:
TOPIC:
  FAMILY:
  NAME:

CATEGORY:
CONTEXT_TYPE:

TAGS:
```

before content fields.

---

# Acceptance Criteria

The implementation is complete when:

```text
✓ Configuration files exist

✓ No hardcoded vocabulary remains

✓ DOMAIN classification works

✓ TOPIC FAMILY classification works

✓ CATEGORY classification works

✓ CONTEXT_TYPE classification works

✓ TAG assignment works

✓ Topic Records include all taxonomy elements

✓ New taxonomy values can be added through configuration only
```

No other behavioural changes are part of this change request.


---
*Copyright © 2026 Virrata AB. All rights reserved. Proprietary and confidential.*
