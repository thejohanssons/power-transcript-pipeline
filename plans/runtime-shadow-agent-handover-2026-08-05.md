# Runtime Shadow Agent Handover — 2026-08-05

## Current decision and authority

This handover covers two deliberately separate Runtime Shadow lanes:

1. **Frozen-fixture parity** — approved synthetic, immutable fixture packages are processed only by the isolated staging Worker.
2. **Continuous Azure-export shadow** — after Azure has completed its existing staging artifact writes, Azure submits a reference-only package manifest. The Runtime Shadow Worker reads only the declared staging artifacts and produces comparison evidence.

Azure remains the authoritative processor, publisher, and rollback runtime. Cloudflare remains staging-only and review-only. Neither lane may publish to Microsoft Graph, SharePoint, Confluence, Teams, Topic Memory, legacy sync, or any other external system. A completed run demonstrates transport and evidence collection—not semantic parity, approval for production, or a transfer of authority.

The programme gates and boundaries remain in [`cloudflare-runtime-replacement-parallel-comparison-plan.md`](cloudflare-runtime-replacement-parallel-comparison-plan.md). The synthetic-fixture acceptance rules remain in [`FIXTURE-RUNBOOK.md`](../packages/runtime-shadow/FIXTURE-RUNBOOK.md), but its local-only operational wording is now stale for the provisioned staging fixture lane; do not treat that document as authorization for an operational change.

## Repository state and safe commit scope

- Current checked-out branch: `main`, at `d915947` (`fix(runtime-shadow): handle topic name version suffix, duplicate topicId, and confidence field collision`), matching `origin/main` at inspection time.
- The completed direct-Azure fixture checkpoint work exists at `origin/develop` commit `d75fedd` (`feat(runtime-shadow): verify direct Azure checkpoint flow`). It is not the current local `main` HEAD.
- Existing uncommitted diagnostics and evidence must remain outside any normal source commit: [`local-pipeline-output.txt`](../local-pipeline-output.txt), [`session-log.txt`](../session-log.txt), [`config/pipeline_Azure_output.txt`](../config/pipeline_Azure_output.txt), [`packages/runtime-shadow/.tmp-*`](../packages/runtime-shadow/), and [`packages/runtime-shadow/runs/`](../packages/runtime-shadow/runs/).
- Only sanitized synthetic fixtures are eligible for version control. Never force-add the ignored root `classification_rules.json`; obtain it only through the approved configuration channel.
- Use explicit allowlisted paths with `git add <paths>`; never use `git add .` in this repository.

## Implemented architecture

### 1. Immutable frozen-fixture parity lane

The isolated Worker implementation is rooted at [`packages/runtime-shadow/src/index.ts`](../packages/runtime-shadow/src/index.ts). It accepts an authenticated `POST /v1/fixture-runs` request referencing an approved immutable manifest, queues work, validates every object hash, invokes Azure OpenAI, persists a versioned model checkpoint, compares output with the frozen Azure baseline, and records Cloudflare output plus comparison artifacts.

The core fixture contract is in [`contracts.ts`](../packages/runtime-shadow/src/contracts.ts), validation in [`fixture-validation.ts`](../packages/runtime-shadow/src/fixture-validation.ts), source parsing in [`fixture-processing.ts`](../packages/runtime-shadow/src/fixture-processing.ts), lifecycle/idempotency in [`fixture-run-lifecycle.ts`](../packages/runtime-shadow/src/fixture-run-lifecycle.ts), and comparison policy in [`comparison.ts`](../packages/runtime-shadow/src/comparison.ts).

Important fixture-lane controls:

- Fixture packages are immutable and hash-addressed; a changed transcript, baseline, configuration snapshot, processing contract, or manifest is a new approved revision.
- The Worker uses output-contract version `normalized-output-v4` in the current [`index.ts`](../packages/runtime-shadow/src/index.ts). New instructions or shape changes require a new versioned checkpoint key; prior checkpoints must not be overwritten.
- `publicationIntent` is the Azure business intent, not proof of a Cloudflare write. Cloudflare inherits the verified baseline intent solely for comparison and separately emits `actualPublication`, which must be all false. This preserves the no-publisher boundary.
- Delayed Queue deliveries are no-ops once a reservation has been claimed or completed. Failed runs recover under the original immutable run ID and reuse only a compatible validated checkpoint.
- Reviewer dispositions are limited to existing **material** differences on completed fixture runs; they do not alter baseline evidence or publish output.

The approved synthetic fixture is versioned under [`synthetic-revision-2`](../packages/runtime-shadow/fixtures/synthetic-fixture-0001/synthetic-revision-2/). Its current manifest, baseline normalized output, publication-intent projection, and configuration snapshot are [`manifest.json`](../packages/runtime-shadow/fixtures/synthetic-fixture-0001/synthetic-revision-2/manifest.json), [`azure-normalized-output.json`](../packages/runtime-shadow/fixtures/synthetic-fixture-0001/synthetic-revision-2/baseline/azure-normalized-output.json), [`azure-publication-intent.json`](../packages/runtime-shadow/fixtures/synthetic-fixture-0001/synthetic-revision-2/baseline/azure-publication-intent.json), and [`config-snapshot.json`](../packages/runtime-shadow/fixtures/synthetic-fixture-0001/synthetic-revision-2/baseline/config-snapshot.json).

### 2. Continuous Azure-export shadow lane

The current `main` also contains an additional continuous staging path. After Azure's ordinary staging artifacts have already been written, the Azure pipeline emits a **reference-only** package through [`buildExistingAzureExportPackage()`](../packages/runtime-shadow/src/azure-export-handoff.ts:48). It does not upload, mirror, delete, or modify Azure artifact bodies.

The intended Azure pipeline callback is documented by the implementation at [`power-transcript-pipeline.ps1`](../packages/pipeline/power-transcript-pipeline.ps1); it uses `RUNTIME_SHADOW_SUBMISSION_TOKEN` from the process environment, posts to `POST /v1/azure-export-runs`, and must not make normal Azure publication fail when Runtime Shadow is unavailable.

Continuous ingress and processing work as follows:

1. `POST /v1/azure-export-runs` authenticates with `SHADOW_CONTINUOUS_SUBMISSION_TOKEN`, validates the package, stores an immutable manifest in the shadow R2 bucket, reserves an idempotent D1 lifecycle row, and queues an `AzureExportJob`.
2. The Worker uses the staging-only, bearer-token-protected artifact reader at [`packages/api-worker/src/index.ts`](../packages/api-worker/src/index.ts) to retrieve only manifest-declared keys beneath the established `transcripts/`, `summaries/`, `people/`, and `topic-records/` prefixes.
3. [`projectAzureExportPackage()`](../packages/runtime-shadow/src/azure-export-processing.ts:146) parses the existing Azure transcript, summary, people, and topic-record artifacts into an Azure semantic projection while excluding external publication links.
4. [`processAzureExportJob()`](../packages/runtime-shadow/src/azure-export-runtime.ts:246) invokes Azure OpenAI, persists a `continuous-normalized-output-v1` checkpoint before comparison artifacts, writes Azure/Cloudflare projections plus the comparison, and completes the D1 lifecycle state.
5. [`compareContinuousNormalizedOutputs()`](../packages/runtime-shadow/src/comparison.ts:161) deliberately compares semantic processing only; Azure publishing and Cloudflare persistence are outside this lane's comparison boundary.

Continuous lifecycle state is stored in [`0002_azure_export_runs.sql`](../packages/runtime-shadow/migrations/0002_azure_export_runs.sql). Processing ownership is conditional and idempotent in [`azure-export-run-lifecycle.ts`](../packages/runtime-shadow/src/azure-export-run-lifecycle.ts). Evidence keys are:

```text
runs/<run-id>/continuous/azure-normalized-output.json
runs/<run-id>/continuous/cloudflare-normalized-output.json
runs/<run-id>/continuous/comparison.json
runs/<run-id>/continuous/model-response-checkpoints/continuous-normalized-output-v2.json
```

## Provisioned staging-only resources and configuration

The Runtime Shadow staging environment is separate from Phase 1 and production resources:

- Worker: `eip-runtime-shadow-staging` at `https://eip-runtime-shadow-staging.homeassistant-8d3.workers.dev`.
- D1: `eip-runtime-shadow-staging` (`c7474ecb-ff28-4788-9108-15d29a022c7b`).
- R2: `eip-runtime-shadow-staging-fixtures`.
- Fixture Queue: `eip-runtime-shadow-staging-jobs`.
- Continuous Queue: `eip-runtime-shadow-staging-continuous-export-jobs`.
- Staging artifact reader base URL: `https://eip-api-worker-staging.homeassistant-8d3.workers.dev/internal/runtime-shadow/azure-artifacts/`.

The declarative bindings are in [`wrangler.jsonc`](../packages/runtime-shadow/wrangler.jsonc). Fixture lifecycle tables originate in [`0001_shadow_runs.sql`](../packages/runtime-shadow/migrations/0001_shadow_runs.sql); continuous lifecycle rows originate in [`0002_azure_export_runs.sql`](../packages/runtime-shadow/migrations/0002_azure_export_runs.sql).

Required secret names—never values—are:

| Purpose | Secret or environment variable |
| --- | --- |
| Fixture ingress | `SHADOW_SUBMISSION_TOKEN` |
| Fixture reviewer disposition | `SHADOW_REVIEWER_TOKEN` |
| Continuous Azure-export ingress | `SHADOW_CONTINUOUS_SUBMISSION_TOKEN` |
| Staging artifact reader | `SHADOW_ARTIFACT_READ_TOKEN` |
| Azure OpenAI invocation | `AZURE_OPENAI_API_KEY` |
| Azure callback process environment | `RUNTIME_SHADOW_SUBMISSION_TOKEN` |

Azure OpenAI uses the direct API-key Chat Completions adapter in [`azure-openai.ts`](../packages/runtime-shadow/src/azure-openai.ts). The fixture path has verified the direct Azure deployment route and compatibility API version. Azure endpoint and deployment are non-secret staging variables; API keys and all bearer tokens remain write-only external secrets.

## Evidence obtained to date

### Frozen synthetic fixture path

The immutable synthetic fixture run `788eb37a-5454-4f13-94b3-7ec29286e396` completed through direct Azure OpenAI. It demonstrated request authentication, hash/schema validation, Queue processing, checkpoint persistence and reuse, comparison artifact writes, and completed D1 state. It remains parity evidence, not a publishing flow.

A prior comparison was blocked by publication-intent differences caused by a contract-design defect: a non-publishing shadow run was being compared as if it should have suppressed Azure's business-intent projection. The fixture path corrected that design by preserving verified `publicationIntent` and asserting all-false `actualPublication` separately. This correction introduced versioned checkpoint contracts rather than overwriting earlier evidence.

The remaining known fixture semantic findings must be evaluated against the approved evidence policy rather than automatically forcing Cloudflare to reproduce Azure behavior. The local governance record at [`governance-decision.md`](../packages/runtime-shadow/runs/fae20183-13f8-49ed-bd9b-73a2c006d706/governance-decision.md) records:

- an unresolved blocking assertion discrepancy where Azure treats an imperative as a completed decision, while the explicit-evidence policy treats it as an action;
- locally resolved topic-count guidance of zero topic projections for the synthetic text; and
- locally resolved classification guidance of `internal` / `high`.

That record does **not** modify remote comparison evidence, a frozen baseline, the Worker, or approval scope. Its stated remote run remains blocked and no publication occurred.

### Continuous Azure-export path

At least one continuous Azure-export staging run, `3c0225a3-3934-4bcb-aa2e-74ac3575e9f6`, completed end-to-end: Azure/local staging artifacts existed, Azure submitted a manifest, Runtime Shadow authenticated/reserved/queued the work, retrieved declared artifacts through the restricted reader, invoked the configured model, compared projections, and wrote R2 evidence. Its comparison was `blocked` with **2 blocking** and **45 material** differences. This validates the mechanism only.

## Continuous-parity defect — status after 2026-08-05 session

Items 1–5 and 7 from the original required implementation list were completed in commit `feat(runtime-shadow): fix continuous lane controlled vocabulary, classification, and topic matching` (2026-08-05). The following were resolved:

1. ✅ [`AzureExportPackageManifest`](../packages/runtime-shadow/src/contracts.ts) extended with optional `configurationContent?: Record<string, unknown>` in `processing`. The Azure pipeline now embeds the actual taxonomy, mapping_rules, and roles content at submission time.
2. ✅ [`continuousPrompt()`](../packages/runtime-shadow/src/azure-export-runtime.ts) now extracts and injects controlled vocabulary (domains, topic names, categories, contextTypes, owner role codes) from `manifest.processing.configurationContent`. Falls back with an explicit `warning` flag when absent.
3. ✅ [`normalizeContinuousModelOutput()`](../packages/runtime-shadow/src/azure-export-runtime.ts) now validates every controlled field (domain, topic, category, contextType, confidence, owner roles) against the governed vocabulary. Unknown values are nulled and the topic's `validation.status` is degraded to at least `warning` — never silently passes.
4. ✅ [`azureProjection()`](../packages/runtime-shadow/src/azure-export-runtime.ts) now calls `parseAzureClassification()` to read real `MEETING_TYPE`/`CLASSIFICATION` and `CONFIDENCE` header fields from the Azure summary artifact. Per-topic validation is aggregated from `EIP_VALIDATION` already parsed by `parseAzureTopicRecord`. No invented values.
5. ✅ [`compareContinuousNormalizedOutputs()`](../packages/runtime-shadow/src/comparison.ts) now matches topics by stable `topicId` (ID-keyed map). Unmatched topics on either side are `material` differences. Null-topicId topics fall back to positional with a note.
7. ✅ New regression tests added in `azure-export-processing.test.ts` covering classification parsing, vocabulary rejection, and ID-based topic matching. Integration test updated to `continuous-normalized-output-v2`.

Output contract bumped to `continuous-normalized-output-v2`. Prior `v1` checkpoint keys are preserved.

Three additional defects were discovered by inspecting real Azure staging R2 artifacts and fixed in commit `d915947`:

- **Topic name version suffix**: Azure topic records carry names like `'Resource Allocation v1.0'` while the taxonomy has `'Resource Allocation'`. `controlledValue()` now strips trailing version suffixes (e.g. ` v1.0`) before matching and returns the canonical taxonomy name.
- **Duplicate `topicId`**: Azure reuses the same `topicId` across different categories (e.g. `T13/Risk` and `T13/Dependency` are distinct entries). Topic matching now uses a composite `topicId+category` key rather than `topicId` alone.
- **`confidence` field collision**: `parseAzureTopicRecord` puts the `EIP_VALIDATION` status string (`pass`/`warning`/`fail`) into the `confidence` field. `azureProjection()` now moves that value to `topic.validation.status` and clears `confidence` to `null`, so both sides use consistent field semantics.

### Deployment status (as of 2026-08-05 ~18:00 UTC)

- ✅ Runtime Shadow Worker deployed: `eip-runtime-shadow-staging` at Version `287c8343` (commit `d915947`).
- ✅ Azure pipeline deployed: CI `deploy-pipeline.yml` triggered automatically on push to `main`; `Submit-RuntimeShadowAzureExport` now embeds `configurationContent` (taxonomy, mapping_rules, roles) in every manifest.

### Evidence run status (2026-08-05)

A manual pipeline run was executed locally (`-FromDate 2026-08-05 -ToDate 2026-08-05 -ForceRerun`) after deployment. Two meetings were processed (Sales Call, Mandar-Peter channel meeting). Both submitted manifests to the new Worker but received **`409 Conflict`** — both meetings had already been submitted by the earlier automated run at `13:3x` UTC, and the D1 idempotency guard correctly rejected the duplicate submissions.

**This is correct behaviour.** The first staging evidence run against the fixed Worker with `configurationContent` will occur when new, previously-unsubmitted meetings are processed — expected automatically in the next daily run (~02:00 UTC 2026-08-06).

When the first post-fix run completes, inspect it with:
```sh
cd packages/runtime-shadow
npx wrangler d1 execute eip-runtime-shadow-staging --remote --command "SELECT run_id, package_id, state, comparison_status, blocking_count, material_count, created_at FROM azure_export_runs WHERE created_at > '2026-08-05T20:00:00Z' ORDER BY created_at DESC LIMIT 10"
npx wrangler r2 object get eip-runtime-shadow-staging-fixtures/runs/<run-id>/continuous/comparison.json --remote
```

Expect blocking/material counts to change significantly from the `3c0225a3` baseline (2 blocking, 45 material). The `topicId` field is confirmed present in real Azure topic records (verified from R2 artifact inspection) — stable ID matching will work.

### Remaining open items

6. **Governance decision on assertion matching policy** — decide whether summary assertions require canonical IDs/exact text match or a separately approved semantic-equivalence policy. The comparator currently uses normalized exact text. This has not been changed and requires explicit governance approval before relaxing.

7. **First post-fix evidence run** — review comparison results from the next daily automated run (expected 2026-08-06 ~02:00 UTC). Record a governance disposition for every remaining material divergence.

## Operational cautions and known drift

- The staging Worker deployment is real. Do not use the old local-only claims in [`FIXTURE-RUNBOOK.md`](../packages/runtime-shadow/FIXTURE-RUNBOOK.md) as evidence that remote staging resources do not exist.
- A Wrangler `--env staging` secret command previously had an environment/name resolution problem despite [`wrangler.jsonc`](../packages/runtime-shadow/wrangler.jsonc) defining `env.staging`. The workaround used the explicit deployed Worker name. Reconcile declarative environment naming with the deployed Worker before future secret operations; do not rotate a secret merely to test it.
- The hosted Azure Function is not reproducible yet: it previously failed because `/home/site/wwwroot/classification_rules.json` was absent, while local runs depend on the ignored root file. Establish a secure approved packaging/runtime-provisioning mechanism before treating a hosted deployment as current.
- A historical hosted Azure log used the production API Worker URL while local configuration is staging-oriented. Treat the hosted package/configuration as stale until rebuilt and verified from committed source.
- The Continuous lane reads Azure's existing Cloudflare staging artifacts. Its restricted reader must stay bearer-protected, key-declared, prefix-restricted, and read-only. Do not add listing, write, or delete authority.

## Validation and review procedure

From [`packages/runtime-shadow/`](../packages/runtime-shadow/), source validation is:

```sh
npm ci
npm run typecheck
npm test
npm run deploy:dry-run
```

The source test suite covers fixture lifecycle and synthetic integration as well as the continuous Azure-export handoff, lifecycle, processing, and artifact-reader behavior. Validate both Worker projects from a fresh environment when practical:

```sh
cd packages/runtime-shadow && npm ci && npm run typecheck && npm test && npm run deploy:dry-run
cd ../api-worker && npm ci && npm run typecheck && npm test
```

Do not deploy, apply a remote migration, create/rotate a secret, submit a run, upload a real fixture, query remote D1/R2, or alter Azure/publishing configuration as part of basic validation. Each is an operational action requiring explicit authorization.

For an already-authorized staging evidence review, do not commit downloaded outputs:

```sh
cd packages/runtime-shadow
npx wrangler d1 execute eip-runtime-shadow-staging --remote --command "SELECT run_id, package_id, state, comparison_status, blocking_count, material_count, error_class, created_at, updated_at FROM azure_export_runs ORDER BY created_at DESC LIMIT 50"
npx wrangler r2 object get eip-runtime-shadow-staging-fixtures/runs/<run-id>/continuous/comparison.json --remote
```

## Non-negotiable promotion gates

No Phase D direct-Graph shadow, publisher readiness, production deployment, authority transfer, or cutover is approved. Before any further phase can be proposed, the applicable approved corpus must demonstrate:

- zero blocking semantic divergences against an equivalent, governed Azure contract;
- a recorded governance disposition for every material divergence;
- successful idempotency, duplicate-delivery, retry, recovery, checkpoint, hash, and no-publication evidence;
- retained review artifacts subject to approved data handling and expiry; and
- explicit approval of the next phase.

Azure remains authoritative until all gates are met and a separate ownership-switch decision is explicitly approved.
