# Runtime-shadow fixture and local validation runbook

## Status and scope

This runbook supports approved Cloudflare runtime-shadow **Phases A–C only**. It is a procedure for preparing a manually approved immutable fixture package and validating the implementation locally.

It does **not** authorize or perform any of the following:

- Cloudflare resource provisioning, remote D1 access, R2 upload, Queue creation, secret creation, or Worker deployment;
- Microsoft Graph access or changes to Azure processing;
- SharePoint, Confluence, Teams, Topic Memory, legacy-sync, or any other publication;
- production execution, data cutover, or mutation of the Azure baseline.

Azure remains authoritative. The runtime shadow produces comparison artifacts only and has no publisher implementation.

## Required approvals before handling a real fixture

Obtain and record approval for each fixture package before it is made available to the runtime shadow:

1. The source owner approves the selected meeting/transcript and its permitted use.
2. The Azure baseline run is identified and frozen.
3. The fixture classification, retention period, reviewers, and expiry date are approved.
4. The fixture manifest, transcript hash, and every baseline/configuration object hash are independently checked.
5. The package is marked immutable after approval. Any changed object, hash, processing version, or manifest requires a new revision and approval.

Until separate approval is granted, do not export real data, upload objects, invoke a remote Worker, or configure credentials.

## Immutable package layout

When a separately approved fixture package is prepared, its logical object layout must be:

```text
fixtures/{fixture-id}/{manifest-sha256}/manifest.json
fixtures/{fixture-id}/{manifest-sha256}/input/transcript.vtt
fixtures/{fixture-id}/{manifest-sha256}/baseline/azure-normalized-output.json
fixtures/{fixture-id}/{manifest-sha256}/baseline/azure-publication-intent.json
fixtures/{fixture-id}/{manifest-sha256}/baseline/config-snapshot.json
```

The runtime validates all manifest references with the `fixtures/` prefix. Object keys must be relative keys under that prefix and must not contain absolute paths, `..`, or backslashes.

Do not include these values in the manifest, artifacts, logs, prompts, telemetry, screenshots, or source control:

- credentials, bearer tokens, keys, cookies, or connection strings;
- direct external URLs or tenant identifiers;
- raw transcript content outside the approved fixture object;
- raw LLM prompts or responses;
- unredacted personal data not approved for the fixture.

## Manifest requirements

The manifest must comply with schema version `1.0.0` and include:

- a non-empty fixture ID and immutable revision;
- source identifiers and approved acquisition mode (`calendar`, `vtt_inbox`, or `direct_vtt`);
- SHA-256 values for the transcript and all frozen Azure baseline/configuration objects;
- processing version references for the normalization/prompt configuration;
- an approved classification (`internal` or `confidential`);
- valid ISO timestamps where `expiresAt` is strictly after `approvedAt`.

Use lowercase hexadecimal SHA-256 digests with exactly 64 characters. Record a distinct manifest SHA-256 in the package path after the final manifest content is frozen.

## Baseline and comparison requirements

The Azure baseline must be produced before the Cloudflare fixture run and must remain unchanged for that fixture revision. It must include the normalized output and a publication-intent projection. A runtime-shadow comparison must classify differences as follows:

- **blocking**: source identity/hash/mode, assertions, validation, or publication-intent changes;
- **material**: controlled topic fields, ownership/confidence, people, or classification changes;
- **permitted**: explicitly approved non-semantic presentation differences.

Only existing material differences may receive a reviewer disposition. Reviewer disposition records are limited to one disposition per comparison path and run. They never publish any output.

## Local-only validation

Run these commands only from the local project directory. They validate source, tests, and local Miniflare D1 state; none uses `--remote` or deploys a Worker.

```sh
npm run typecheck
npm test
npm run deploy:dry-run
npx wrangler d1 migrations apply eip-runtime-shadow-staging --local --env staging
```

Expected local D1 tables after the migration:

- `fixture_runs`
- `comparison_dispositions`

Local Wrangler state is stored beneath `.wrangler/` and is ignored by version control. Do not add local database state, `.dev.vars`, `*.local.vars`, credentials, real fixtures, or generated run artifacts containing sensitive data to source control.

## Future actions requiring separate explicit approval

Do not run any command that provisions, accesses, or mutates a remote Cloudflare resource, including commands with `--remote`, deployment commands without `--dry-run`, or secret/resource creation commands. A separate written approval is also required before:

- supplying `AZURE_OPENAI_API_KEY`, `SHADOW_SUBMISSION_TOKEN`, or `SHADOW_REVIEWER_TOKEN`;
- uploading an approved fixture package to R2;
- sending a fixture job to the Queue;
- invoking Azure OpenAI with a real fixture;
- enabling direct Graph shadow behavior;
- adding publishing integrations or any production traffic.

Maintain the documented isolation boundary: only dedicated future staging bindings named in `wrangler.jsonc` may be considered after approval; Phase 1 resources and Topic Memory assets must remain untouched.
