# Master Status — EIP Platform

**Canonical status file**

**Last updated:** 2026-08-17
**Authority:** This is the repository-wide master status and restart entry point. Read this file first when resuming work. Where another planning, handover, or session-log file conflicts with this file, this file takes precedence unless it has a later explicit `Last updated` date and is linked below as the current authority for its stated scope.

## Current position

Azure Function + PowerShell + SharePoint remains the primary production system and system of record. The Cloudflare runtime is live as an asynchronous processing extension with its own D1/R2/Queue path; it must not block, replace, or mutate the Azure/SharePoint system of record without a separately approved migration decision.

Three distinct Cloudflare packages exist and must not be conflated:

| Scope | Package | Current status | Current authority |
| --- | --- | --- | --- |
| Live processing runtime | [`packages/cloudflare-runtime/`](../packages/cloudflare-runtime/) | Existing live runtime; separate from cockpit delivery | [`plans/cloudflare-real-runtime-handover.md`](cloudflare-real-runtime-handover.md) |
| CEO/ExCo cockpit (synthetic) | [`packages/exco-cockpit/`](../packages/exco-cockpit/) | Synthetic-only implementation accepted; not deployed | [`plans/exco-cockpit-session-state-2026-08-11.md`](exco-cockpit-session-state-2026-08-11.md) |
| Local live-data cockpit POC | [`packages/local-cockpit-server/`](../packages/local-cockpit-server/) | **Active — localhost-only server and read-only runtime D1 reporting validated; production deployment remains prohibited** | [`plans/local-live-cockpit-feedback-poc-plan.md`](local-live-cockpit-feedback-poc-plan.md) |

## Verified progress since 2026-08-11

- **Cloudflare runtime:** Production health endpoint verified on 2026-08-14. Runtime D1 contained 100 meetings, 81 completed meetings, 633 topics, 633 topic-memory records, 576 actions, and 301 decisions at that verification point.
- **MeetingIntelligence ingestion:** MeetingIntelligence transcript headers are now parsed before duplicate detection. Subject/start metadata uses the shared Calendar `Get-MeetingLogId` identity; filename-derived identity remains the fallback when metadata is absent. Merged in PR #4 as `2178ee3`; Azure deployment workflow completed successfully on 2026-08-14.
- **Local runtime report:** `packages/local-cockpit-server/scripts/test-runtime-topic-lists.mjs` is committed as `4e5d75a`. It is read-only, supports owner/status/meeting/topic-memory filters, and renders topic-memory cards, owner-grouped actions, decisions, and risks.
- **Documentation:** `README.md` now links to this file as the canonical repository-wide status summary.
- **Validation:** Local Cockpit tests/build, PowerShell parsing, PSScriptAnalyzer, and the pipeline/runtime CI checks passed for the changes above.

## CEO/ExCo cockpit — accepted baseline

The synthetic cockpit has passed architect review.

- Two primary views: Overview and All Content.
- All Content supports conjunctive filtering by type, meeting, domain, entity family (`entityType`), and keyword.
- Evidence drill-down is read-only and excludes transcript-bearing fields.
- Feedback is browser-session-only, non-persistent, exportable JSON.
- No cockpit D1, R2, Queues, secrets, real data, Azure/SharePoint/Teams connection, Cloudflare Access configuration, or deployment was introduced.
- Verification baseline: 122 passing tests, comprising 60 API tests and 62 browser tests.
- Visual evidence: [`packages/exco-cockpit/screenshots/`](../packages/exco-cockpit/screenshots/).

## Next approved planning sequence

No production deployment, data mutation, or scope expansion is implicitly authorized by this list. Each gate requires product-owner approval.

1. Complete the localhost-only preflight baseline against an approved runtime D1 backup/export before a formal review session.
2. Run controlled read-only review sessions through `packages/local-cockpit-server/` and capture structured feedback without exposing raw transcripts or R2 keys.
3. Analyse the review evidence and decide whether the synthetic cockpit requires a private preview, Cloudflare Access, or further fixture changes.
4. Design and approve persistent feedback storage, retention, reviewer identity/access, a write API, and database migration before any feedback persistence beyond the dedicated local feedback D1.
5. Separately approve any production cockpit architecture, including a data-minimised read model, least-privilege access, retention, and prohibited-field boundaries.

## Restart protocol

1. Read this file.
2. Identify the active scope from the table above.
3. Read only that scope's current authority document.
4. Verify the relevant package's code and tests before changing scope, data source, deployment, or persistence.
5. Update this file and the applicable scope authority whenever a gate changes.

## Document roles and precedence

| Document | Role | Precedence note |
| --- | --- | --- |
| [`plans/STATUS.md`](STATUS.md) | Repository-wide current status and restart index | Canonical |
| [`plans/exco-cockpit-session-state-2026-08-11.md`](exco-cockpit-session-state-2026-08-11.md) | Current accepted cockpit baseline and continuation gates | Authoritative for cockpit detail |
| [`plans/cloudflare-real-runtime-handover.md`](cloudflare-real-runtime-handover.md) | Current live Cloudflare runtime handover | Authoritative for runtime detail; not cockpit status |
| [`plans/cloudflare-ceo-exco-cockpit-coding-handoff.md`](cloudflare-ceo-exco-cockpit-coding-handoff.md) | Original implementation handoff | Historical/superseded where it conflicts with the accepted two-view cockpit baseline |
| [`session-log.txt`](../session-log.txt) | Historical developer handover and session chronology | Context only; not current master status |

## Local live-data cockpit POC — active scope

The localhost-only live-data POC in [`packages/local-cockpit-server/`](../packages/local-cockpit-server/) is approved, implemented, and validated. It is explicitly **not a production deployment**. The package now includes a read-only runtime D1 report for local spot checks. Key constraints:

- Binds only to `127.0.0.1`; non-loopback host headers rejected at the HTTP layer.
- Reads production runtime D1 (read-only) using a separately provisioned credential. R2 is not used.
- Writes feedback only to a dedicated isolated D1 database (append-only, no update/delete).
- CI guard (`scripts/ci-guard.mjs`) fails if Wrangler config or Worker bindings appear in the package.
- Production deployment of this package is explicitly deferred and requires a separate approval.

**To activate:** follow `packages/local-cockpit-server/RUNBOOK.md` — provision two credentials (D1 read, feedback D1 read+write), copy `.env.local.example` to `.env.local`, run `npm run preflight`, then `npm start`.

## Non-negotiable boundary

Neither this localhost POC nor the synthetic cockpit may be promoted to production without a separately approved architecture that defines a data-minimised read model, least-privilege native bindings, reviewer identity enforcement, retention, and an explicit privileged-evidence policy. Raw transcripts, transcript hashes, retrieval URLs, R2 keys, and equivalent transcript-derived metadata must remain outside any production-deployed cockpit read model.

> Note: the localhost POC itself does not access R2 or transcripts. The above constraint applies to any future production design.
