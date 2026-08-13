# Contributor and Release Practices

**Status:** Approved repository practice
**Last reviewed:** 2026-08-13

## 1. Purpose

These practices keep the repository and running components aligned while preventing unreviewed or accidental production changes.

The system has three connected parts:

1. **Azure Function pipeline** — receives and prepares transcripts, then sends transcript copies to Cloudflare R2.
2. **Cloudflare runtime** — reads transcript submissions, processes them, and writes meetings, topics, actions, decisions, risks, and topic memory to D1.
3. **Local Cockpit** — runs only on the operator's local machine, reads runtime D1 through server-side credentials, writes feedback only to a separate feedback database, and sends controlled review decisions to the runtime.

The synthetic-data ExCo Cockpit Worker is not a deployed production component at this time. Its future release process must be documented before automatic deployment is enabled.

## 2. Main-line rules

- `main` is the repository source of truth.
- Do not push directly to `main`.
- Every change uses a focused pull request and squash merge.
- Do not combine provider credentials, database migrations, UI changes, and repository cleanup in one pull request.
- Delete temporary development branches after merging.
- `.github/CODEOWNERS` identifies Peter (`@thejohanssons`) as the owner of all repository content. Owner approval is not currently required because this is a one-person repository.
- GitHub branch protection, required checks, and branch deletion must be configured in GitHub repository settings; this document does not enforce those settings.

## 3. Starting new work

Before starting work:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
```

Create a separate branch with a clear purpose, for example:

```text
ci/add-runtime-tests
fix/azure-openai-settings
feat/cockpit-review-flow
docs/update-handover
```

Do not reuse an old branch without reviewing its commits and changed files.

## 4. Protected running areas

Treat the following as production-impacting unless the pull request explicitly identifies and approves the impact:

- `packages/pipeline/` and Azure deployment configuration.
- `packages/cloudflare-runtime/`.
- `packages/api-worker/`.
- `packages/exco-cockpit/`.
- `packages/local-cockpit-server/`.
- Runtime, API, and Cockpit database migrations.
- Worker, D1, R2, queue, Azure, and GitHub deployment configuration.

Cleanup work must not delete, replace, or silently change a running version.

## 5. Secrets and production data

Never commit Azure OpenAI keys, Cloudflare API tokens, Worker secrets, D1 tokens, Azure Function settings, local Cockpit credentials, private keys, connection strings, or raw production transcript data. The GitHub `CLOUDFLARE_API_TOKEN` secret used for Worker deployment must be narrowly scoped to the minimum permissions and resources required to deploy the approved Worker; it must not be a general account-administrator token.

Safe examples may contain variable names, non-sensitive resource identifiers where necessary, and explicit values such as `REPLACE_WITH_LOCAL_SECRET`. The real local Cockpit environment file is ignored by Git.

Before submitting a pull request:

```bash
git diff --check
git status --short
```

Review every changed file for secret-shaped values and unintended production data.

If a real credential is committed locally, even if it has not reached GitHub:

1. Stop the release.
2. Revoke or rotate it when exposure is possible.
3. Remove it from unsent Git history.
4. Replace it with a safe placeholder.
5. Re-run the checks before pushing.

## 6. Required checks

The current CI workflow runs these checks for pull requests and pushes targeting `main`:

- API Worker TypeScript checking.
- Local Cockpit safety guard.
- Local Cockpit TypeScript checking and tests.
- Cloudflare runtime tests.
- ExCo Cockpit tests.
- Azure pipeline PowerShell linting.

Run the relevant package checks locally before opening a pull request:

```bash
cd packages/cloudflare-runtime
npm test -- --run
npm run typecheck

cd ../exco-cockpit
npm test -- --run
npm run typecheck

cd ../local-cockpit-server
npm test -- --run
npm run typecheck

cd ../api-worker
npm run typecheck
```

Repository administrators must configure the CI checks required for merging in GitHub. A pull request must not merge while a required check is failing or missing.

## 7. Provider changes

### Azure OpenAI

- Keep endpoint, deployment name, and keys in Azure Function App settings.
- Do not put credentials in `packages/pipeline/config/llm_config.json`.
- Confirm whether `FOUNDRY_API_KEY` or the fallback key setting is active.
- Configure the deployment name, not merely the model family name.
- Run a controlled pipeline test and inspect diagnostics without printing secret values.
- Retain the old credential throughout the rollback window and revoke it only after confirmation.

### Cloudflare runtime

- Keep endpoint and deployment as non-secret Worker environment values.
- Keep the API key as a Worker secret.
- Do not change `packages/runtime-shadow/` unless separately approved.
- Run the focused runtime test suite before merging.
- Validate a controlled transcript in staging before a provider or processing change is merged. Staging validation is currently a controlled manual process and is not performed by the automatic production deployment workflow.
- Confirm queue completion, valid R2 output, valid D1 records, and correct `processing.model` and `processing.deployment` values.
- Retain the old credential during the rollback window.

## 8. Database changes

A database migration requires all of the following:

- A reviewed migration file with its purpose and affected tables.
- Local test coverage.
- A backup or recovery reference.
- Staging validation.
- Explicit production approval.
- Post-application verification.

Recording a migration file does not apply it. Do not apply production migrations as housekeeping or documentation work. A code rollback does not reverse a database migration.

## 9. Cockpit and local server controls

The Local Cockpit must:

- Read runtime D1 data through its server without sending credentials to the browser.
- Keep feedback in its isolated feedback D1 database.
- Keep review credentials on the local server.
- Bind only to the local machine.
- Avoid raw transcript text in feedback notes.
- Preserve the Pending Review workflow and its tests.

The Local Cockpit server must not use Wrangler deployment configuration, write directly to runtime D1 except through the approved review command, expose runtime tokens to browser code, or be deployed to production.

## 10. Pull request description

Every pull request states what changed, why it changed, affected running components, tests run, Azure/Cloudflare/Cockpit impact, migration status, deployment effect, rollback method, and whether secrets or production data are involved.

## 11. Release sequence

1. Start from current `main` and run the relevant local checks.
2. Open a focused pull request and wait for required checks and review.
3. Squash merge to `main`.
4. A qualifying `main` change automatically deploys the Azure pipeline, API Worker, or Cloudflare runtime to production according to that workflow's path filters. These workflows are production release mechanisms.
5. The Cloudflare runtime workflow may also be started manually only as an intentional production retry or emergency redeployment mechanism. Manual execution uses the same production checks and validation as an automatic release.
6. The deployment workflow validates the deployed component, records its deployment result in the GitHub Actions job summary, and fails when validation fails. The runtime `/health` check confirms only availability and production configuration; it does not prove queue processing, R2 access, D1 writes, Azure OpenAI compatibility, or successful transcript processing.
7. For Cloudflare runtime provider, processing, or database-impacting releases, complete and record a controlled post-release processing check that verifies queue completion, R2 output, D1 records, and processing metadata.
8. Review the deployment result and record release-specific operational details and rollback information in the handover notes.
9. Delete the merged branch and confirm GitHub and the repository are aligned.

The Local Cockpit server has no deployment workflow. The ExCo Cockpit Worker also has no automatic deployment workflow until it has an approved deployment target and validation endpoint.

## 12. Rollback

Every provider or database change identifies the previous deployment or configuration, previous credential status, rollback type (code, configuration, or database restoration), old-key availability, and recovery verification.

For a Worker code rollback, use the Cloudflare Worker version history or `wrangler rollback` under the applicable change-control procedure. Exercise and record the rollback procedure at least once before relying on it during an incident. Do not assume a Worker rollback reverses data changes.

## 13. Handover and repository health

A new developer must be able to identify the Azure-to-Cloudflare-to-Cockpit flow, run local checks, find protected live areas, understand where credentials are supplied without seeing values, distinguish staging from production, locate current infrastructure settings, find release and rollback information, and deliver a focused pull request.

The repository is healthy when `main` is protected; required checks pass; changes use reviewed pull requests and squash merges; temporary branches are removed; secrets and raw production data are absent; repository content matches deployed versions; release status is documented; and migrations have explicit approval and recovery plans.
