# EIP 1.1 Change Implementation Plan

## Objective

Generate a dedicated Topic Record file for every extracted topic in addition to the existing meeting summary output.

No other changes are in scope.

---

## Step 1 — Create the Topic Record Model

Define a fixed Topic Record schema.

```yaml
TOPIC:
DOMAIN:

STATUS:
TRAJECTORY:

SUMMARY:

KEY_FACTS:

DECISIONS:

ACTIONS:

RISKS:

OPPORTUNITIES:

NEXT_STEPS:

PEOPLE:
PROJECTS:
PRODUCTS:
SYSTEMS:
DEPENDENCIES:

SOURCE:
  MEETING_ID:
  DATE:
```

Freeze this schema before proceeding.

---

## Step 2 — Map Existing EIP Fields

Create field mappings:

```text
Current Topic Content      → SUMMARY / KEY_FACTS
Decisions                  → DECISIONS
Actions                    → ACTIONS
Risks / Issues             → RISKS
Next Direction             → NEXT_STEPS
Topic Label                → TOPIC
Canonical Topic            → DOMAIN
```

No new analysis required.

---

## Step 3 — Extract Entities Explicitly

Add deterministic extraction for:

```text
PEOPLE
PROJECTS
PRODUCTS
SYSTEMS
DEPENDENCIES
```

These will become retrieval anchors for Copilot.

---

## Step 4 — Generate One Topic File per Topic

Current:

```text
Meeting Summary
 ├─ Topic A (Links to Topic Records/[MeetingID]/T02.md)
 ├─ Topic B (Links to Topic Records/[MeetingID]/T03.md)
 └─ Topic C (Links to Topic Records/[MeetingID]/T04.md)
```

Add:

```text
Topic Records/[MeetingID]/
 ├─ T02-TopicName.md (Links back to Meeting Summary)
 ├─ T03-TopicName.md (Links back to Meeting Summary)
 ├─ T04-TopicName.md (Links back to Meeting Summary)
 └─ T07-TopicName.md (Links back to Meeting Summary)
```

**Naming Convention:** `Topic Records/[MeetingID]/[TopicID]-[SanitizedTopicName].md` to preserve historical versions and prevent collisions.

**Mutual Linking:**
- Every topic block in the **Meeting Summary** must include a direct Markdown link to its corresponding **Topic Record**.
- Every **Topic Record** must include a `SOURCE_LINK` back to the parent **Meeting Summary** in its metadata or footer.

Generated directly from the already extracted topic structures.

No additional LLM pass required.

---

## Step 5 — Publish Alongside Existing Output

Do not modify:

```text
Meeting Summary
Master Log
```

Add only:

```text
Topic Records
```

This keeps rollback risk extremely low.

---

## Step 6 — Validate Retrieval

Run practical Copilot tests:

```text
What is the latest status of Firmware 2.06?

What are the current risks around SuperPen pilots?

What has Mandar been discussing about storage constraints?
```

Measure whether retrieval returns:

```text
Topic Record
```

instead of:

```text
Entire Meeting Summary
```

---

## Success Criteria

A single meeting produces:

```text
1 Meeting Summary

+

N Topic Records
```

**Mutual Integrity:**
- Both files must exist and contain verified mutual links.
- The `Topic Record` must be able to stand alone and answer:

```text
What is this?
Why does it matter?
What was decided?
What needs doing?
Who is involved?
```

If that works consistently, the change is considered complete.


---
*Copyright © 2026 Virrata AB. All rights reserved. Proprietary and confidential.*
