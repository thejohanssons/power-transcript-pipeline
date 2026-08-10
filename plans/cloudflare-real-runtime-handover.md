# Cloudflare Runtime — Handover Document

**Last updated:** 2026-08-10  
**Status:** Production live. All 5 phases complete. Topic Memory populated.

---

## Production endpoints

| Resource | Value |
|---|---|
| Worker URL | `https://eip-cloudflare-runtime.homeassistant-8d3.workers.dev` |
| D1 database | `eip-cloudflare-runtime` |
| R2 bucket | `eip-cloudflare-runtime-output` |
| Processing queue | `eip-cloudflare-runtime-processing` |
| Dead letter queue | `eip-cloudflare-runtime-processing-dlq` |

---

## Current Topic Memory state (2026-08-10)

| Metric | Value |
|---|---|
| Meetings processed | 72 |
| Topic Memory records | 516 confirmed |
| Pending review | 0 |
| Date range covered | 2026-01-05 to 2026-08-10 |

---

## Architecture

```
Azure Pipeline (daily 02:00 UTC)
  └→ POST /v1/meetings (raw transcript + metadata only)
        ↓  202 immediately
  Worker: validates auth, writes transcript to R2, enqueues meetingId
        ↓
  Queue: eip-cloudflare-runtime-processing (max_batch_size=1, max_retries=2)
        ↓
  Queue consumer: fetches transcript from R2, calls processMeeting()
        ↓
  Azure OpenAI (gpt-5.6-terra, v0.2 taxonomy, classificationPromptVersion=2)
        ↓
  D1: meetings(completed), topics, people, actions, decisions, topic_memory
  R2: meetings/{id}/transcript.txt, meetings/{id}/meeting-output.json
        ↓
  Teams: Adaptive Card notifications for proposed topic matches
```

---

## Key design decisions (locked)

1. **Taxonomy:** v0.2 frozen production standard. `TAXONOMY_V02` in `types.ts` is the source of truth.
2. **Topic matching:** Primary = entity+entityType exact match. Secondary = ≥2 keyword overlap (stopwords filtered). No auto-merge — all proposals require human review.
3. **Version fields:** `classificationPromptVersion`, `topicMatchingVersion`, `contractVersion` per `plans/versioning-policy.md`.
4. **Accept/reject:** `PATCH /v1/topic-memory/:id/match` endpoint live. `reject` implemented. `accept` returns 501 (Phase 6).
5. **Queue-based processing:** `ctx.waitUntil` was insufficient for full transcripts. Queue consumer handles all LLM processing.
6. **Azure pipeline unchanged:** Still writes to SharePoint (v4.2 taxonomy). Cloudflare runtime is independent.

---

## Files

| File | Purpose |
|---|---|
| `packages/cloudflare-runtime/src/index.ts` | Worker entry point, routes, queue handler |
| `packages/cloudflare-runtime/src/types.ts` | All TypeScript contracts + TAXONOMY_V02 + version constants |
| `packages/cloudflare-runtime/src/db.ts` | D1 SQL builders |
| `packages/cloudflare-runtime/src/meeting-processing.ts` | LLM call + v0.2 normalisation (promptVersion=2) |
| `packages/cloudflare-runtime/src/topic-memory.ts` | Cross-meeting matching + Teams Adaptive Card |
| `packages/cloudflare-runtime/wrangler.jsonc` | Worker config, bindings, queues |
| `packages/cloudflare-runtime/migrations/0001_initial_schema.sql` | D1 schema (6 tables) |
| `packages/cloudflare-runtime/backfill-from-transcriptexport.ps1` | Backfill script for historical meetings |
| `packages/pipeline/power-transcript-pipeline.ps1` | Azure pipeline (Submit-TranscriptToCloudflare) |

---

## Secrets (production Worker)

| Secret | Purpose |
|---|---|
| `SUBMISSION_TOKEN` | Bearer token for POST /v1/meetings — must match `CLOUDFLARE_SUBMISSION_TOKEN` env var in pipeline |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key for LLM processing |
| `TEAMS_WEBHOOK_URL` | Teams webhook for match notifications (optional) |

---

## Role structure

- **Peter (product owner):** Directs, sets objectives, runs pipeline from authenticated terminal, reviews topic matches
- **Rovo Dev (orchestrator/reviewer):** Designs, specifies, reviews code. Does not implement.
- **Developer:** Implements against specifications, submits for review before merge/deploy

---

## Next session priorities (Phase 6)

1. **Query endpoints** — `GET /v1/meetings`, `GET /v1/topic-memory` with filtering (by entity, entity_type, date range, status). Required for dashboard and spot-checks.
2. **Accept merge logic** — `PATCH /v1/topic-memory/:id/match` with `decision: accept`. Should merge the new record into the existing one (update `last_seen_meeting_id`, `last_seen_date`, `meeting_count`, `canonical_statement`, `latest_outcome`).
3. **Prompt quality review** — after 10+ more overnight runs, assess entity/topic_statement consistency across meeting types. May need prompt tuning for specific meeting types (compliance, sales, NPI).
4. **Dashboard foundation** — once query endpoints exist, build a minimal read-only view of Topic Memory.

---

## Azure pipeline status — confirmed

`pipeline_config.json` (committed to main, deployed to Azure Function App via CI):
```json
"eip_cloudflare_sync": "production",
"skip_sharepoint": false,
"eip_cloudflare_runtime_url": "https://eip-cloudflare-runtime.homeassistant-8d3.workers.dev"
```

Deploy workflow (`deploy-pipeline.yml`) resets to production values on every deploy including `eip_cloudflare_runtime_url`.

**One outstanding manual action before overnight run works automatically:**  
Azure Function App → Configuration → `CLOUDFLARE_SUBMISSION_TOKEN` must be set to the current `SUBMISSION_TOKEN` value on the production Worker. If not set, the overnight run will submit to the Cloudflare runtime but get 401 silently — meetings will still process via Azure/SharePoint, but won't appear in Cloudflare D1.

---

## Topic matching — Aspect Candidate Register

`Alignment` candidate — 3 instances observed (threshold: 10). Still correctly rejected.
See `Topic Classification and Governance Framework.txt` Section 7A for full register.

---

## Known issues / technical debt

| Item | Priority | Notes |
|---|---|---|
| `accept` merge not implemented | Phase 6 | Returns 501. Manual D1 update as workaround. |
| Confluence mirror failing 404 | Low | `SpaceKey='PWMN' ParentPageId='2102919177'` — parent page doesn't exist. Non-blocking. |
| `eip-runtime-shadow` (production) | Deprecation | Still receiving submissions from old pipeline config path. To be decommissioned after Cloudflare runtime is proven. |
| Staging env not yet wired | Phase 6 | Staging D1/R2 provisioned but Worker never deployed to staging env. |
