# Local Fixture Export Procedure

## Purpose

This procedure defines the **package contract** for a future manually approved Azure fixture export. It does not authorize an export, R2 upload, remote Cloudflare access, Azure invocation, deployment, Graph access, or publishing.

The fixture package is immutable input to the staging-only runtime shadow. Azure remains authoritative throughout Phases A–C.

## Required package layout

Use a new manifest hash for every correction. Never overwrite an approved package.

```text
fixtures/{fixture-id}/{manifest-sha256}/manifest.json
fixtures/{fixture-id}/{manifest-sha256}/input/transcript.vtt
fixtures/{fixture-id}/{manifest-sha256}/baseline/azure-normalized-output.json
fixtures/{fixture-id}/{manifest-sha256}/baseline/azure-publication-intent.json
fixtures/{fixture-id}/{manifest-sha256}/baseline/config-snapshot.json
```

## Export preparation

1. Select an Azure-processed meeting only after a human approves it for the fixture corpus.
2. Capture the source mode, non-sensitive source identity, transcript, frozen Azure normalized output, frozen publication intent, and processing/configuration version hashes.
3. Create `config-snapshot.json` from the exact non-secret taxonomy, rules, prompt, model, deployment, and processing-version context used for the Azure baseline.
4. Exclude credentials, bearer tokens, prompts containing sensitive content, external publishing URLs, Teams payloads, SharePoint/Confluence responses, Graph secrets, and legacy-sync responses.
5. Compute SHA-256 and byte length for every object before producing the manifest.
6. Record the approving identity, approval timestamp, and expiry timestamp. Expiry must be after approval and may not exceed the 30-day fixture retention policy.
7. Validate the package locally against the runtime schema and hash each object before any future remote upload.

## Manifest requirements

The `manifest.json` must include:

- fixture schema version, fixture ID, and revision;
- source system, native ID, acquisition mode, and permitted non-sensitive meeting metadata;
- object references and SHA-256 values for transcript, Azure baseline output, Azure publication intent, and configuration snapshot;
- Azure pipeline, prompt, model, deployment, taxonomy, and configuration version/hash identities;
- classification, approver identity, approval timestamp, and expiry timestamp.

The runtime validates every referenced fixture object under the `fixtures/` prefix and verifies each artifact hash before model invocation or comparison.

## Local-only readiness checks

From [`package.json`](package.json), run:

```sh
npm run typecheck
npm test
npm run deploy:dry-run
```

A future real-fixture export or staging operation still requires the separate written approval described in [`FIXTURE-RUNBOOK.md`](FIXTURE-RUNBOOK.md:91).
