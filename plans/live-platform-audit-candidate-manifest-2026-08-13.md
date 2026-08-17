# Live Platform Audit Candidate Manifest

**Date:** 2026-08-13  
**Purpose:** Review-only manifest for the explicitly approved AUD-01/AUD-02 housekeeping scope.  
**Authority:** `plans/live-platform-audit-remediation-backlog-2026-08-13.md` and the approval recorded in the task conversation.

## Review boundaries

This document is a candidate manifest only. It does **not** stage files, create a commit, push changes, apply migrations, or deploy any resource.

The manifest separates source, tests, configuration, CI, authority documentation, audit documentation, and held evidence. “Include in this change” means an approved candidate for normal review and selective staging; it is not an instruction to stage automatically.

No candidate below authorizes:

- production API migration `0008_topic_summary_variants.sql`;
- deployment or execution of runtime migrations `0002` or `0003`;
- Cloudflare Worker deployment;
- Azure deployment;
- a commit or push.

## Candidate manifest

| Repository-relative path | Status | Functional scope | Intended disposition | Required verification | Deployment/migration impact | Sensitivity review |
|---|---|---|---|---|---|---|
| `.github/workflows/ci.yml` | modified | CI | include in this change | `yamllint`/workflow review; run package CI-equivalent tests | none | Reviewed as workflow text; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/cloudflare-runtime/src/index.ts` | modified | runtime review | include in this change | `cd packages/cloudflare-runtime && npm test -- --run` | none; release later requires approval | Source review required; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/cloudflare-runtime/src/types.ts` | modified | runtime review | include in this change | `cd packages/cloudflare-runtime && npm test -- --run` | none; release later requires approval | Type definitions only; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/cloudflare-runtime/src/index.test.ts` | modified | runtime review | include in this change | `cd packages/cloudflare-runtime && npm test -- --run` | none; migration/deployment explicitly excluded | Tests/fixtures reviewed; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/cloudflare-runtime/src/topic-memory-review.test.ts` | untracked | runtime review | include in this change | `cd packages/cloudflare-runtime && npm test -- --run` | none; migration/deployment explicitly excluded | Test source reviewed; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/cloudflare-runtime/src/topic-memory-review.d1.integration.test.ts` | untracked | runtime review | include in this change | `cd packages/cloudflare-runtime && npm test -- --run`; integration test only with separately approved environment | migration/deployment explicitly excluded | Integration test source reviewed; no credentials or production data exports included. |
| `packages/cloudflare-runtime/src/node-test-shims.d.ts` | untracked | runtime review | include in this change | `cd packages/cloudflare-runtime && npm run typecheck` | none | Type shim only; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/cloudflare-runtime/migrations/0002_topic_memory_live_review_decisions.sql` | untracked | runtime review | include in this change — commit candidate only | SQL review and migration test review; do not execute | **Migration execution explicitly excluded; later approved release gate required** | Schema SQL reviewed as source; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/cloudflare-runtime/migrations/0003_topic_memory_review_transaction_guard.sql` | untracked | runtime review | include in this change — commit candidate only | SQL review and migration test review; do not execute | **Migration execution explicitly excluded; later approved release gate required** | Schema SQL reviewed as source; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/cloudflare-runtime/wrangler.jsonc` | modified | runtime review | include in this change | `cd packages/cloudflare-runtime && ./node_modules/.bin/wrangler deploy --dry-run` only if separately approved; otherwise config review | deployment explicitly excluded; later approval required | Binding/config review required; no secret values included. |
| `packages/exco-cockpit/public/app.js` | modified | cockpit | include in this change | `cd packages/exco-cockpit && npm test -- --run` | none; cockpit deployment explicitly deferred | Frontend source reviewed; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/exco-cockpit/public/index.html` | modified | cockpit | include in this change | `cd packages/exco-cockpit && npm test -- --run` | none; cockpit deployment explicitly deferred | Static markup reviewed; no secrets or production data included. |
| `packages/exco-cockpit/src/api.ts` | modified | cockpit | include in this change | `cd packages/exco-cockpit && npm test -- --run` | none; cockpit deployment explicitly deferred | Source reviewed; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/exco-cockpit/src/browser.test.ts` | modified | cockpit | include in this change | `cd packages/exco-cockpit && npm test -- --run` | none; cockpit deployment explicitly deferred | Browser tests/fixtures reviewed; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/exco-cockpit/src/fixtures.ts` | modified | cockpit | include in this change | `cd packages/exco-cockpit && npm test -- --run` | none; synthetic cockpit remains undeployed | Synthetic fixture source reviewed; no raw transcripts, production exports, secrets, or credential-shaped values included. |
| `packages/exco-cockpit/src/index.test.ts` | modified | cockpit | include in this change | `cd packages/exco-cockpit && npm test -- --run` | none; cockpit deployment explicitly deferred | Tests reviewed; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/exco-cockpit/src/types.ts` | modified | cockpit | include in this change | `cd packages/exco-cockpit && npm test -- --run` | none; cockpit deployment explicitly deferred | Type definitions only; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/local-cockpit-server/.env.local.example` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run`; template key review | none; production promotion explicitly deferred | Sanitized template only; no secret values, raw transcripts, production exports, or credential-shaped values included. |
| `packages/local-cockpit-server/.gitignore` | untracked | local cockpit | include in this change | `git check-ignore -v packages/local-cockpit-server/.env.local`; package guard tests | none | Ignore policy reviewed; protects local credentials, dependencies, build output, and logs. |
| `packages/local-cockpit-server/RUNBOOK.md` | untracked | local cockpit | include in this change | Documentation review; package tests | none; production promotion explicitly deferred | Review for operational identifiers before staging; no credential values or production exports may be included. |
| `packages/local-cockpit-server/migrations/0001_feedback_schema.sql` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run`; SQL review only | local schema execution/deployment later requires approval | Schema source reviewed; no secrets, raw transcripts, or production exports included. |
| `packages/local-cockpit-server/package.json` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run && npm run typecheck` | none; production promotion explicitly deferred | Manifest contains dependency metadata only; no secrets or production data. |
| `packages/local-cockpit-server/package-lock.json` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm ci --ignore-scripts` in clean review environment | none | Dependency lock metadata; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/local-cockpit-server/scripts/ci-guard.mjs` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none | Guard source reviewed; no secrets or production data included. |
| `packages/local-cockpit-server/tsconfig.json` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm run typecheck` | none | Build configuration only; no secrets or production data included. |
| `packages/local-cockpit-server/vitest.config.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none | Test configuration only; no secrets or production data included. |
| `packages/local-cockpit-server/src/preflight.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none; preflight must remain separately authorized | Source reviewed; credentials are read from environment, not embedded. |
| `packages/local-cockpit-server/src/review-queue.test.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none | Test source reviewed; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/local-cockpit-server/src/review-queue.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none; feedback persistence later requires approval | Source reviewed; no secrets or production exports included. |
| `packages/local-cockpit-server/src/types/db-rows.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm run typecheck` | none | Type definitions only; no secrets or production data included. |
| `packages/local-cockpit-server/src/env.test.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none | Test source reviewed; no secret values included. |
| `packages/local-cockpit-server/src/env.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none | Environment handling source; values remain external and no secrets are embedded. |
| `packages/local-cockpit-server/src/router.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none; production promotion explicitly deferred | Source reviewed; no secrets or production exports included. |
| `packages/local-cockpit-server/src/loopback-guard.test.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none | Test source reviewed; no secrets or production data included. |
| `packages/local-cockpit-server/src/loopback-guard.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none | Source reviewed; no secrets or production data included. |
| `packages/local-cockpit-server/src/server.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none; production promotion explicitly deferred | Source reviewed; environment credentials remain external. |
| `packages/local-cockpit-server/src/adapters/runtime-review-client.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none; runtime write API use remains separately gated | Source reviewed; endpoint/credentials must remain environment-provided. |
| `packages/local-cockpit-server/src/adapters/feedback-d1.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none; feedback D1 use later requires approval | Source reviewed; no credentials or production data exports included. |
| `packages/local-cockpit-server/src/adapters/feedback-d1.test.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none | Test source reviewed; no secrets or production data included. |
| `packages/local-cockpit-server/src/adapters/runtime-d1.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none; runtime access remains separately gated | Source reviewed; credentials are external and no exports are embedded. |
| `packages/local-cockpit-server/src/adapters/runtime-d1.test.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none | Test source reviewed; no secrets or production exports included. |
| `packages/local-cockpit-server/src/api/index.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none; production promotion explicitly deferred | Source reviewed; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `packages/local-cockpit-server/src/api/mappers.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none | Source reviewed; no secrets or production exports included. |
| `packages/local-cockpit-server/src/api/mappers.test.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none | Test source reviewed; no secrets or production data included. |
| `packages/local-cockpit-server/src/api/review-queue.test.ts` | untracked | local cockpit | include in this change | `cd packages/local-cockpit-server && npm test -- --run` | none | Test source reviewed; no secrets or production data included. |
| `plans/STATUS.md` | untracked | documentation | include in this change | Markdown/link review; preserve explicit non-deployment gates | none | Authority document; review identifiers before staging; no secrets, raw transcripts, or production exports included. |
| `plans/cloudflare-ceo-exco-cockpit-coding-handoff.md` | modified | documentation | include in this change | Markdown/link review | none; cockpit deployment deferred | Authority document; no credential values, raw transcripts, or production exports included. |
| `plans/composed-review-queue-poc-handoff-2026-08-12.md` | untracked | documentation | include in this change | Markdown/link review | none; local promotion later requires approval | Authority document; sensitivity review required for identifiers; no secrets or production exports included. |
| `plans/exco-cockpit-session-state-2026-08-11.md` | untracked | documentation | include in this change | Markdown/link review | none; synthetic cockpit deployment deferred | Authority document; no secrets, raw transcripts, or production exports included. |
| `plans/live-platform-audit-remediation-backlog-2026-08-13.md` | untracked | audit | include in this change | Markdown/link review | none; gates preserved | Audit document; no secrets, raw transcripts, or production exports included. |
| `plans/live-platform-audit-runbook-2026-08-13.md` | untracked | audit | include in this change | Markdown/link review; verify read-only command boundaries | none; deployment/migration commands explicitly prohibited | Audit procedure; no secret values included. |
| `plans/live-platform-audit-candidate-manifest-2026-08-13.md` | untracked | audit | include in this change | Markdown/link review; verify candidate paths against `git status` | none; this manifest authorizes no release action | This manifest contains paths and procedural metadata only; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `plans/local-live-cockpit-feedback-poc-plan.md` | untracked | documentation | include in this change | Markdown/link review | none; production promotion deferred | Review for external identifiers before staging; no secrets or production exports included. |
| `plans/topic-memory-live-review-write-handoff-2026-08-12.md` | untracked | documentation | include in this change | Markdown/link review; migration gate review | migration execution explicitly excluded | Review for operational identifiers; no secrets, raw transcripts, or production exports included. |
| `specification and plans/EIP_Spec_Governance.md` | modified | documentation | include in this change | Markdown/link review | none; governance only | Authority document; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `specification and plans/WIP-roadmap.md` | modified | documentation | include in this change | Markdown/link review | none; roadmap only | Planning document; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `specification and plans/EIP_Change_Request_Lens_Hierarchy_Escalation.md` | untracked | documentation | include in this change | Markdown/link review | none; implementation later requires approval | Specification review required; no secrets, raw transcripts, production exports, or credential-shaped values included. |
| `specification and plans/EIP_Change_Request_Lens_Hierarchy_Escalation_v0_2.md` | untracked | documentation | include in this change | Markdown/link review | none; implementation later requires approval | Specification review required; no secrets, raw transcripts, production exports, or credential-shaped values included. |

## Already-verified housekeeping entry

| Repository-relative path | Status | Functional scope | Intended disposition | Required verification | Deployment/migration impact | Sensitivity review |
|---|---|---|---|---|---|---|
| `.gitignore` | modified | audit | include in this change | `git diff --check` passed; `git check-ignore -v packages/pipeline/pipeline_config.json` returned no match (exit 1); `git ls-files -ci --exclude-standard` returned empty | none | Ignore policy only; no secrets, raw transcripts, production exports, or credential-shaped values included. |

## Explicitly held locally / excluded

These are not candidates for this housekeeping change and must remain local pending separate classification:

- `artifacts/verification/STAGING_RUNTIME_PRE_MIGRATION_0003_20260812/`
- `artifacts/verification/STAGING_RUNTIME_PRE_MIGRATION_20260812/`
- `session-log.txt`
- `packages/local-cockpit-server/.env.local`
- `packages/local-cockpit-server/node_modules/`
- `packages/local-cockpit-server/dist/`
- `packages/local-cockpit-server/run-logs/`
- Any other local dependencies, generated output, build artifacts, or run logs covered by ignore rules.

The held pre-migration SQL evidence is excluded because it may contain sensitive schema or production-related data. The session log and operational material remain held until their external identifiers and credential-like content receive a separate sensitivity review. No held item is asserted to be secret-free.

## Explicit migration and release exclusions

- `packages/cloudflare-runtime/migrations/0002_topic_memory_live_review_decisions.sql` and `0003_topic_memory_review_transaction_guard.sql` are **commit candidates only**. They must not be executed or deployed as part of this housekeeping change.
- Production API migration `0008_topic_summary_variants.sql` is an independent AUD-03 decision and is not included in this manifest’s housekeeping scope.
- No Cloudflare Worker, Azure Function, D1 database, or other production resource may be changed by this manifest.
- No staging, commit, push, merge, or deployment action is authorized by this document.

## Review handoff

Before any staging or commit, a reviewer should:

1. Confirm the candidate paths still match `git status --short`.
2. Review every documentation candidate for identifiers and credential-like content.
3. Confirm no held local path is added accidentally.
4. Run the package tests/typechecks listed above.
5. Confirm the two runtime migrations remain unexecuted and that AUD-03 migration `0008` is absent from the change.
6. Perform normal code review before any separately approved release action.
