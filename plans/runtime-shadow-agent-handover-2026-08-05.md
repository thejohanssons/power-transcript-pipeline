# Runtime Shadow Agent Handover — 2026-08-05

## Purpose and current authority

This handover covers the in-progress Azure-to-Cloudflare Runtime Shadow path. Azure remains the authoritative processor, publisher, and rollback system. Cloudflare is staging-only, review-only, and must not publish to Graph, SharePoint, Confluence, Teams, or Topic Memory.

The intended architecture and gates are defined in [cloudflare-runtime-replacement-parallel-comparison-plan.md](cloudflare-runtime-replacement-parallel-comparison-plan.md). Do not treat a successful remote run as semantic parity or permission to promote Cloudflare authority.

## Repository and backup scope

- Repository: `https://github.com/thejohanssons/power-transcript-pipeline.git`
- Working branch at handover: `main`.
- Before this handover commit, local `main` was one commit ahead of `origin/main` (`d75fedd`).
- This commit intentionally includes source, tests, migrations, sanitized synthetic fixtures, plans, and this document.
- This commit intentionally excludes generated local logs, temporary outputs, and run evidence under `packages/runtime-shadow/runs/`.
- The root `classification_rules.json` is ignored and is not included. Obtain it only through the approved configuration channel.

## What has been implemented

### Azure pipeline handoff

The Azure pipeline posts a reference-only manifest after its normal artifact writes in [power-transcript-pipeline.ps1](../packages/pipeline/power-transcript-pipeline.ps1). The callback:

- uses `RUNTIME_SHADOW_SUBMISSION_TOKEN` only from the process environment;
- posts to `POST /v1/azure-export-runs` on the staging Runtime Shadow Worker;
- leaves Azure artifact publication unchanged;
- catches callback failure so the ordinary Azure pipeline does not fail because the shadow path is unavailable.

The manifest supplies referenced transcript, summary, people, and topic-record artifacts, plus configuration versions and hashes.

### Runtime Shadow staging path

The Runtime Shadow Worker in [index.ts](../packages/runtime-shadow/src/index.ts) provides authenticated continuous ingress, writes a lifecycle entry to D1, and queues continuous processing. The worker configuration is in [wrangler.jsonc](../packages/runtime-shadow/wrangler.jsonc). The staging deployment uses:

- Worker: `eip-runtime-shadow-staging`
- D1: `eip-runtime-shadow-staging`
- R2: `eip-runtime-shadow-staging-fixtures`
- Queue: `eip-runtime-shadow-staging-continuous-export-jobs`
- Staging artifact reader: `https://eip-api-worker-staging.homeassistant-8d3.workers.dev/internal/runtime-shadow/azure-artifacts/`

The D1 lifecycle schema is [0002_azure_export_runs.sql](../packages/runtime-shadow/migrations/0002_azure_export_runs.sql). Review completed evidence in R2 using:

```text
runs/<run-id>/continuous/azure-normalized-output.json
runs/<run-id>/continuous/cloudflare-normalized-output.json
runs/<run-id>/continuous/comparison.json
runs/<run-id>/continuous/model-response-checkpoints/<contract-version>.json
```

### Restricted artifact reader

The API Worker contains a staging-only, bearer-token-protected, prefix-restricted reader in [index.ts](../packages/api-worker/src/index.ts). It only retrieves declared artifact keys. It must remain read-only; do not broaden it into list/write/delete authority for Runtime Shadow.

### Tests and synthetic fixtures

The source includes focused continuous-export tests and safe synthetic fixtures under [packages/runtime-shadow](../packages/runtime-shadow). The synthetic fixture transcript contains only two intentionally synthetic statements and is safe to version.

## Remote validation performed

At least one continuous Azure export completed end-to-end:

1. Azure/local pipeline wrote its ordinary staging artifacts.
2. Azure submitted a manifest to Runtime Shadow.
3. Runtime Shadow authenticated ingress, inserted D1 lifecycle state, queued work, read declared artifacts, invoked the configured model, compared output, and wrote review evidence to R2.
4. A real comparison was produced for run `3c0225a3-3934-4bcb-aa2e-74ac3575e9f6`.

The run was `blocked` with 2 blocking and 45 material differences. That proves the mechanism works. It does **not** prove parity.

## Critical unresolved defect: Azure-reference contract mismatch

Azure is the reference. The current Runtime Shadow contract is not yet a valid measurement of Azure parity.

The root causes are:

1. [continuousPrompt()](../packages/runtime-shadow/src/azure-export-runtime.ts) sends configuration hashes rather than the actual Azure taxonomy, mapping rules, role/ownership vocabulary, confidence vocabulary, classification rules, and validation semantics.
2. The Cloudflare model output schema permits arbitrary strings for controlled fields such as `topicId`, domain, category, owners, and confidence.
3. The normalizer preserves those arbitrary values instead of validating them against an Azure-provided controlled vocabulary.
4. [azureProjection()](../packages/runtime-shadow/src/azure-export-runtime.ts) hard-codes Azure classification to null and validation to pass, rather than parsing the actual Azure metadata/validation state.
5. The comparator in [comparison.ts](../packages/runtime-shadow/src/comparison.ts) uses exact normalized assertion equality and positional topic comparison after sorting. This is strict but invalid when the two outputs are generated under non-equivalent controlled contracts.

Do **not** weaken the comparator merely to make the run pass. First make the input contract and semantics equivalent.

### Recommended next implementation

1. Extend the manifest with immutable, content-bearing Azure configuration snapshot references (or include the content under explicit governance), not only hashes.
2. Make the prompt require values from Azure’s controlled taxonomy, role/owner, confidence, classification, and validation vocabulary.
3. Reject unknown controlled values during normalization.
4. Preserve Azure’s actual classification and validation values in the Azure projection, or remove those fields from the comparison boundary only if Azure has no equivalent recorded artifact.
5. Match topics with stable Azure-controlled identifiers rather than array position.
6. Decide explicitly whether assertions require canonical IDs/exact text or an approved semantic-equivalence policy. Do not silently permit missing or fabricated claims.

## Known operational issues

### Wrangler environment naming

`wrangler secret put ... --env staging` previously failed with an environment/name resolution error even though [wrangler.jsonc](../packages/runtime-shadow/wrangler.jsonc) defines `env.staging`. The successful operational workaround used the explicit deployed Worker name, but the declarative config and command behavior need reconciliation before relying on it.

Verify from `packages/runtime-shadow`:

```sh
npm run typecheck
npm test
npx wrangler deploy --env staging --dry-run
```

Do not deploy or rotate secrets without authorization.

### Hosted Azure Function deployment is not reproducible yet

A hosted Azure Function run previously failed because `/home/site/wwwroot/classification_rules.json` was absent. Local runs succeed because the ignored root `classification_rules.json` exists. A new deployment needs a secure, approved packaging or runtime-provisioning method for this file.

A previous hosted log also used the production API Worker URL while the current local configuration is staging-oriented. Treat the hosted Function configuration/package as stale until it is rebuilt and verified from the committed source.

### Runbook drift

[FIXTURE-RUNBOOK.md](../packages/runtime-shadow/FIXTURE-RUNBOOK.md) still describes earlier local-only restrictions, but staging resources and a remote shadow run have now been used. Update the runbook only under appropriate approval, retaining the non-publication and real-data controls.

## Secrets and configuration — never commit values

A fresh clone is source-complete but not executable until an authorized operator configures the following external prerequisites.

| Purpose | Required variable or secret |
| --- | --- |
| Microsoft Graph app authentication | `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` |
| Azure pipeline to Runtime Shadow ingress | `RUNTIME_SHADOW_SUBMISSION_TOKEN` |
| Runtime Shadow model access | Worker secret `AZURE_OPENAI_API_KEY` |
| Runtime Shadow continuous ingress | Worker secret `SHADOW_CONTINUOUS_SUBMISSION_TOKEN` |
| Runtime Shadow artifact reader | Worker secret `SHADOW_ARTIFACT_READ_TOKEN` |
| Existing fixture/reviewer endpoints, if used | Worker secrets `SHADOW_SUBMISSION_TOKEN`, `SHADOW_REVIEWER_TOKEN` |
| Azure classification rules | approved non-versioned `classification_rules.json` |
| Teams notification, if desired | `TEAMS_WEBHOOK_URL` |

The repository configuration no longer contains a Teams webhook value. [power-transcript-pipeline.ps1](../packages/pipeline/power-transcript-pipeline.ps1) reads `TEAMS_WEBHOOK_URL` first and only falls back to the legacy config property if one is supplied locally.

Worker secrets are write-only. Their current plaintext cannot be read back from Cloudflare. Rotate or obtain them through the approved secret owner; do not put them in Git, logs, fixtures, issue comments, or this document.

## Fresh-environment bootstrap

1. Clone the repository and check out the pushed commit/branch.
2. Install Node dependencies separately:

```sh
cd packages/runtime-shadow && npm ci
cd ../api-worker && npm ci
```

3. Ensure macOS tooling includes PowerShell (`pwsh`), Node/npm, Git, and a compatible Wrangler version supplied by the locked project dependencies.
4. Obtain the approved non-versioned `classification_rules.json` and place it at the repository root for local pipeline execution. Do not commit it.
5. Set the required secrets only in the shell/process that runs the pipeline. For PowerShell, use `$env:NAME = 'value'`; a zsh `export` does not populate an existing PowerShell process.
6. Verify the source without remote effects:

```sh
cd packages/runtime-shadow && npm run typecheck && npm test && npm run deploy:dry-run
cd ../api-worker && npm run typecheck && npm test
```

7. Before a controlled local pipeline run, confirm `eip_cloudflare_sync` is `staging`, `skip_sharepoint` is `true`, and the Runtime Shadow staging URL is set in [pipeline_config.json](../packages/pipeline/pipeline_config.json).
8. Do not run with production publishing, real-data export, or secret rotation unless separately authorized.

## Safe review commands

Use the staging D1 and R2 names only after an authorized Cloudflare login:

```sh
cd packages/runtime-shadow
npx wrangler d1 execute eip-runtime-shadow-staging --remote --command "SELECT run_id, package_id, state, comparison_status, blocking_count, material_count, error_class, created_at, updated_at FROM azure_export_runs ORDER BY created_at DESC LIMIT 50"
npx wrangler r2 object get eip-runtime-shadow-staging-fixtures/runs/<run-id>/continuous/comparison.json --remote
```

Do not commit downloaded real run artifacts. They may contain customer/meeting data.

## Git safety rules for continued work

- Use an allowlist with `git add <paths>`; never use `git add .` for this project.
- Keep generated local output excluded: `local-pipeline-output.txt`, `session-log.txt`, `config/pipeline_Azure_output.txt`, `packages/runtime-shadow/.tmp-*`, and `packages/runtime-shadow/runs/`.
- Inspect any future fixture before tracking it. Only sanitized synthetic fixtures may be committed.
- Do not add ignored `classification_rules.json` with force.
- Keep secrets in environment variables or Cloudflare/Azure secret stores only.
- Before push, run `git diff --check`, tests, `git diff --cached --check`, and a targeted secret-pattern scan.

## Immediate next actions

1. Confirm the pushed commit and branch are present on GitHub.
2. Reproduce local test/typecheck/dry-run validation from a clean checkout if practical.
3. Reconcile the Wrangler staging environment/deployed Worker naming discrepancy.
4. Design the Azure-controlled configuration snapshot and schema validation before requesting another parity judgement.
5. Update the runbook/deployment documentation under approval to distinguish current staging operations from earlier local-only fixture rules.
6. Keep Azure authoritative until the plan’s parity gates are satisfied and explicitly approved.
