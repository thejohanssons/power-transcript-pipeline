# EIP Cloudflare Runtime — Component Version Policy

**Effective:** 2026-08-07  
**Applies to:** `ContinuousNormalizedOutput.processing` version fields  
**Status:** Approved

---

## Overview

Each Topic Record produced by the Cloudflare runtime carries a set of component version fields in its `processing` block. These fields allow future engineers, governance reviewers, and automated comparison tools to understand exactly which version of each component produced a given record — without re-running the pipeline.

Version fields use **integer strings** (`"1"`, `"2"`, `"3"`). Not semver. Semver is reserved for `runtimeVersion` only, which describes the overall platform release.

Taxonomy vocabulary (Domain, EntityType, Aspect, Outcome, Disposition, ExecutiveScope) is a **system-level constant**, not a per-record version field. The taxonomy standard is defined at the repository boundary: Azure=v4.2, Cloudflare=v0.2. It does not change until a formal governance decision creates v0.3.

---

## Version Fields

### `runtimeVersion` (semver: `"1.0.0"`)

**Increment when:** The deployed Cloudflare runtime behaviour changes in a way that is externally observable and not fully explained by another version field.

Examples that warrant a bump:
- Queue orchestration logic changes (retry strategy, batch size policy)
- Worker routing or pipeline sequencing changes
- A combination of multiple component version bumps in a single release

Examples that do NOT warrant a bump:
- A prompt change (→ bump `classificationPromptVersion` only)
- A topic matching logic change (→ bump `topicMatchingVersion` only)
- A dependency upgrade with no behaviour change

**Governance:** Engineering decision. Log in CHANGELOG.

---

### `classificationPromptVersion` (integer: `"1"`)

**Increment when:** The system prompt or few-shot examples sent to the LLM for topic classification change in any way that could alter output.

This includes:
- Changes to vocabulary instructions
- Changes to output format instructions
- Addition or removal of examples
- Changes to axis definitions or descriptions in the prompt

This does NOT include:
- Model or deployment changes (→ `runtimeVersion` if behaviour changes)
- Bug fixes that restore intended behaviour without changing output semantics

**Governance:** Engineering decision. Log in CHANGELOG.

---

### `classificationEngineVersion` (integer: `"1"`)

**Increment when:** The classification workflow logic changes — specifically how the LLM response is parsed, validated, retried, or post-processed after the raw LLM call.

Examples:
- Changes to response parsing (e.g. how JSON is extracted from the completion)
- Changes to validation rules applied to LLM output
- Changes to retry or fallback logic on malformed responses
- Changes to how classification results are merged with normalized output

**Governance:** Engineering decision. Log in CHANGELOG.

---

### `topicMatchingVersion` (integer: `"1"`)

**Increment when:** The logic for matching incoming topics against existing Topic Records changes in any way — including similarity threshold, key fields used for matching, merge rules, or deduplication policy.

This is the **highest-impact version field**. Topic matching determines whether knowledge accumulates into an existing topic or fragments into new ones. A change here directly affects Topic Memory integrity across all historical records.

**Comparison policy:** `topicMatchingVersion` differences between two runs are always `blocking` in the shadow comparison — they are never permitted divergences. This ensures matching changes are always caught before production.

**Governance:** Requires a written governance note in `plans/` before deployment. Engineering + sign-off.

---

### `normalisationVersion` (integer: `"1"`)

**Increment when:** The extraction and transformation rules change — specifically how raw transcript content is converted into normalized fields (people, topics, assertions, validation).

Examples:
- Changes to transcript parsing rules
- Changes to people resolution logic
- Changes to assertion extraction
- Changes to validation checks applied during normalisation

**Governance:** Engineering decision. Log in CHANGELOG.

---

### `contractVersion` (integer: `"3"`)

**Increment when:** The `ContinuousNormalizedOutput` TypeScript interface changes in a way that affects stored or compared data — specifically when fields are added, removed, or renamed.

Starting at `3` because:
- Contract `1.0.0` was the initial schema
- Contract `2.0.0` added `configurationContent` and topic matching fixes (2026-08-05)
- Contract `3` introduces v0.2 taxonomy fields and the revised processing block (2026-08-07)

**Governance:** Engineering decision. Requires test suite update and migration for existing records.

---

## Configuration Hashes (internal, not in contract)

`configurationHashes` are **removed from `ContinuousNormalizedOutput`** (they were part of the processing block in contract v2). However, they are retained internally for diagnostics:

- `promptHash` — SHA256 of the classification prompt at deployment time
- `topicMatchingHash` — SHA256 of the topic matching configuration
- `normalisationHash` — SHA256 of the normalisation rules

These are stored in deployment metadata and Worker logs, not in Topic Records. They are invaluable for diagnosing subtle output differences between deployments without exposing internal configuration in the public contract.

---

## When NOT to Bump

| Scenario | Action |
|---|---|
| Bug fix that restores intended behaviour, no output change | No bump |
| Dependency update, no behaviour change | No bump |
| Config or secret rotation | No bump |
| Taxonomy vocabulary (frozen at v0.2) | Never bump — taxonomy is system-level |
| Adding observability/logging only | No bump |
| Wrangler config change (routes, compatibility date) | No bump |

---

## Starting Values (Production v1.0.0 — 2026-08-07)

| Field | Value |
|---|---|
| `runtimeVersion` | `"1.0.0"` |
| `classificationPromptVersion` | `"1"` |
| `classificationEngineVersion` | `"1"` |
| `topicMatchingVersion` | `"1"` |
| `normalisationVersion` | `"1"` |
| `contractVersion` | `"3"` |

---

## Governance Summary

| Field | Bump authority | Requires governance note? |
|---|---|---|
| `runtimeVersion` | Engineering + sign-off | For major changes only |
| `classificationPromptVersion` | Engineering | No |
| `classificationEngineVersion` | Engineering | No |
| `topicMatchingVersion` | Engineering + sign-off | **Yes — always** |
| `normalisationVersion` | Engineering | No |
| `contractVersion` | Engineering | No (but requires test + migration) |
