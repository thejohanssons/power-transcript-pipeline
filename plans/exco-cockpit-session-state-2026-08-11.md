# ExCo Cockpit — Session State

**Recorded:** 2026-08-11
**Status:** Synthetic cockpit implementation accepted; no preview deployment authorized or performed in this session.

## Completed in this session

The independent, synthetic-only CEO/ExCo cockpit in [`packages/exco-cockpit/`](../packages/exco-cockpit/) has passed architect review.

- Exactly two primary views are implemented: Overview and All Content.
- All Content supports conjunctive client-side filtering by content type, meeting, domain, entity family (`entityType`), and keyword.
- Linked topic metadata is propagated to Decisions, Actions, and Risks for filtering and keyword search.
- Topic Memory supports first-seen and last-seen meeting matching. Domain filtering intentionally excludes Topic Memory because the memory contract does not extract or derive a domain.
- Evidence drill-down remains synthetic-only and excludes transcript-bearing fields.
- Feedback remains non-persistent browser-session state with validation, JSON export, and confirmed reset.
- The API is read-only; no D1, R2, Queues, secrets, real-data connections, or Azure/SharePoint/Teams integrations were introduced into this cockpit package.
- Verification reported 122 passing tests: 60 API tests and 62 browser tests.
- Visual evidence is retained in [`packages/exco-cockpit/screenshots/`](../packages/exco-cockpit/screenshots/).

## Deliberately not done

- No Cloudflare Worker preview or production deployment was authorized.
- No Cloudflare Access configuration was performed.
- No real meeting data has been exposed to the cockpit.
- No persistent feedback datastore or feedback API has been added.
- No changes were made to the primary Azure Function, PowerShell, Teams retrieval, or SharePoint publishing path.

## Superseded by: Local live-data cockpit POC (active)

The live-data and persistent-feedback workstreams previously listed as "next continuation" have been approved and scaffolded as a **localhost-only POC** in [`packages/local-cockpit-server/`](../packages/local-cockpit-server/).

This POC explicitly supersedes the synthetic-only cockpit boundary **for the specifically approved localhost review use case**. It does not constitute a production cockpit and does not satisfy the gates listed below for production deployment.

### What the POC delivers (localhost-only)

- A Node.js server bound only to `127.0.0.1` — no Wrangler, no Worker, no remote deployment.
- Read-only D1 adapter for production runtime (meetings, topics, people, actions, decisions, topic memory) using fixed `SELECT` queries. Storage locator columns (r2_output_key, transcript_sha256) excluded from all DTOs. R2 is not used.
- An append-only feedback D1 adapter writing to a dedicated isolated database — reviewer name, verdict, affected field, note, warning acknowledgement, and optional correction reference.
- Live-data API: `/api/v1/overview`, `/api/v1/meetings`, `/api/v1/topics`, `/api/v1/decisions`, `/api/v1/risks-actions`, `/api/v1/topic-memory`, feedback CRUD. No R2 or transcript endpoints.
- Pre-flight baseline tool (`npm run preflight`) capturing D1 counts and recent-meeting spot-check before and after each session. Requires `PREFLIGHT_OPERATOR` and `PREFLIGHT_BACKUP_REF`.
- CI guard (`scripts/ci-guard.mjs`) — fails build if Wrangler config or Worker bindings appear in this package.
- 51 passing tests covering loopback guard, D1 adapter immutability (no write/update/delete methods, SELECT-only queries), feedback validation (required fields, no update/delete), DTO mappers, and overview counts.

### To start the POC

See `packages/local-cockpit-server/RUNBOOK.md`:
1. Provision two Cloudflare API tokens (D1 read-only, feedback D1 read+write).
2. Copy `.env.local.example` → `.env.local` and fill in credentials.
3. Create and migrate the feedback D1: `wrangler d1 create eip-local-feedback`.
4. Run preflight (requires PREFLIGHT_OPERATOR and PREFLIGHT_BACKUP_REF) — do not proceed if this fails.
5. Run `npm run build && npm start` and open http://127.0.0.1:4321.

## Required gates before production deployment

These gates remain unchanged — the localhost POC does NOT satisfy them:

- A separately approved production architecture with a data-minimised read model.
- Cloudflare Access design and configuration before any remote review.
- Least-privilege native Worker bindings (not local credentials).
- Reviewer identity enforcement and retention policy.
- An explicit privileged-evidence policy (no raw transcripts in a deployed cockpit).

## Architecture reminder

Azure Function + PowerShell + SharePoint remains the primary production system and system of record. The Cloudflare cockpit and processing runtime remain asynchronous, independently evaluated extensions. They must not block, replace, or mutate the Azure/SharePoint path unless a future explicit migration decision is approved.
