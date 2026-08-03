# Phase 1 — Azure Canonical Topic Memory Dual-Write Status

## Implemented increment

The Azure pipeline now contains an opt-in canonical submission path in [`power-transcript-pipeline.ps1`](../../packages/pipeline/power-transcript-pipeline.ps1). It is separate from the legacy Cloudflare file, topic, transcript, and participant sync helper.

The path produces a version `2.0.0` envelope for [`POST /v2/submissions`](../../packages/api-worker/src/index.ts:222), containing:

- deterministic SHA-256 content, evidence, case, claim, and submission identities;
- M365 source identity and a stable `m365://meetings/{MeetingId}#transcript` locator;
- source evidence metadata without copying source content into R2;
- only contract-valid ContextType and Category candidates;
- an explicit `Unclassified`/null-topic representation for legacy `T00` or missing topics; and
- review-required provenance for all automated candidate claims.

The pipeline submits only when `eip_canonical_topic_memory_sync` is explicitly set to `staging` or `production` in the ignored runtime [`pipeline_config.json`](../../packages/pipeline/pipeline_config.json). That setting selects the corresponding Worker URL independently of the legacy sync setting. Azure/SharePoint output remains authoritative; the canonical submission never changes the pipeline result.

## Secret and durable-retry controls

The pipeline reads the Worker bearer token exclusively from the Azure app-setting/environment variable `EIP_TOPIC_MEMORY_SUBMISSION_TOKEN`. It must match the Worker secret `TOPIC_MEMORY_SUBMISSION_TOKEN`; neither value belongs in source control.

Before transport, the exact submission envelope is written to the durable directory named by `EIP_TOPIC_MEMORY_RECONCILIATION_DIR`. Successful submissions update that record to `Accepted` with the Worker receipt. Failed transports update it to `TransportFailed`; HTTP 4xx rejections update it to `ValidationRejected`. Both retain the original stable envelope for reconciliation without blocking Azure processing. If durable reconciliation storage, a Worker URL, or the token is unavailable, the submission is skipped without blocking Azure processing.

## Explicit non-actions

This increment does **not**:

- deploy the Worker;
- apply D1 migrations to Cloudflare;
- provision either secret;
- enable the runtime flag;
- upload additional source content to R2; or
- make Cloudflare authoritative.

## Operational prerequisites before enabling

1. Apply and verify [`0009_canonical_topic_memory.sql`](../../packages/d1/migrations/0009_canonical_topic_memory.sql) and [`0010_seed_taxonomy_v2.sql`](../../packages/d1/migrations/0010_seed_taxonomy_v2.sql) in the intended non-production D1 database.
2. Provision identical values for `TOPIC_MEMORY_SUBMISSION_TOKEN` in the Worker secret store and `EIP_TOPIC_MEMORY_SUBMISSION_TOKEN` in Azure app settings.
3. Configure a durable Azure-backed location for `EIP_TOPIC_MEMORY_RECONCILIATION_DIR`; do not point it at an ephemeral function filesystem.
4. Configure `eip_canonical_topic_memory_sync: "staging"` only in a non-production ignored runtime configuration after the preceding prerequisites are verified.
5. Reconcile the generated record with the authenticated [`GET /v2/submissions/{id}`](../../packages/api-worker/src/index.ts:368) receipt endpoint before increasing the pilot scope.

## Known limitations

- The initial envelope builds candidate claims from existing topic records rather than emitting source-span-level claims. The VAT fixture remains the review-safe vertical-slice evidence example in [`vat-decision-vertical-slice-submission.json`](vat-decision-vertical-slice-submission.json).
- The pipeline retains the legacy `T00` output for backward compatibility, but maps it to the v2 `Unclassified`/null-topic representation only within the canonical envelope.
- Source-content supersession needs a reconciliation worker that detects a changed source locator and submits `supersedes_evidence_id`; this pipeline increment deliberately does not guess that relationship.
- The durable directory retains content-bearing envelopes. Its Azure storage account/container must enforce the transcript’s access classification and retention policy.
