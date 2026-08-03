# Runtime-Shadow Review Checklist

**Review targets:** local commits `597e441` (`feat: add runtime shadow parity foundation`), `d93954a` (`fix: serialize runtime shadow fixture claims`), `6bd4984` (`test: add synthetic runtime shadow integration flow`), and the local review-correction follow-up.

## Scope and non-actions

- [ ] Confirm the change is limited to approved runtime-shadow Phases A–C.
- [ ] Confirm Azure remains authoritative; this commit does not change Azure processing.
- [ ] Confirm no push, deployment, Cloudflare provisioning, remote D1/R2/Queue access, secret configuration, Graph access, real-fixture handling, or publishing is authorized by this review.

## Isolation and configuration

- [ ] Confirm `wrangler.jsonc` names only dedicated future staging resources and does not reuse Phase 1 or production resources.
- [ ] Confirm the all-zero D1 database ID is an intentional placeholder, not a deployable resource identifier.
- [ ] Confirm no credentials, endpoint values, submission tokens, or reviewer tokens are committed.
- [ ] Confirm fixture-run submission requires a distinct authorized bearer token before it can enqueue model work.

## Fixture integrity and processing controls

- [ ] Confirm fixture manifests enforce supported schema, approval/expiry ordering, SHA-256 values, safe `fixtures/` object keys, and frozen Azure baselines.
- [ ] Confirm comparison output is normalized and classifies differences as blocking, material, or permitted.
- [ ] Confirm fixture submission is idempotent: active/completed runs replay, while failed runs recover using the existing immutable run ID.
- [ ] Confirm a persisted model-response checkpoint is reused after downstream comparison-artifact persistence failure, avoiding a repeat model invocation after that checkpoint exists.
- [ ] Confirm local coverage races failed-run recovery against a delayed delivery and verifies that only one claimant processes the run.

## Review and publication boundaries

- [ ] Confirm reviewer dispositions require authorization and target existing material differences only.
- [ ] Confirm the codebase has no Graph, SharePoint, Confluence, Teams, Topic Memory, legacy-sync, or publisher implementation.
- [ ] Confirm the runbook documents that a separate explicit approval is required before handling a real fixture or performing any remote action.

## Local evidence

- [ ] Verify the recorded local checks passed: `npm run typecheck`, `npm test` (11 tests, including one synthetic local Worker-flow integration test), `npm run deploy:dry-run`, and local D1 migration apply/list.
- [ ] Verify the dry-run was not a deployment and migration commands did not use `--remote`.

## Decision

- [ ] Approve the local commit for retention and a future separately authorized push/review.
- [x] Request changes before any further action.
- [x] Require separate operational approval before provisioning, deployment, fixture handling, Azure invocation, Graph work, or publishing.

**Recorded disposition:** The fixture-run recovery race identified in review was corrected locally: conditional D1 transitions grant one processing/recovery claimant, while delayed competing deliveries no-op. The follow-up correction also requires a distinct submission token and persists a model-response checkpoint before comparison artifacts and completion-state writes, so retryable downstream persistence failures reuse the model response. The synthetic local integration test covers authorized and rejected submission, a recovery/delayed-delivery race, checkpoint reuse after a synthetic local R2 failure, completed state, and duplicate-delivery no-op behavior. Neither local commit nor this checklist authorizes a push, provisioning, deployment, real-fixture handling, Azure invocation, Graph work, or publishing.
