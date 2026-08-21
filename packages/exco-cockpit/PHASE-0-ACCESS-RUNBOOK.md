# ExCo Cockpit Phase 0 — Cloudflare Access and Deployment Runbook

## Status

Phase 0 establishes the secure deployment boundary for the hosted Cockpit. It does **not** connect live runtime D1 data, persist reviewer feedback, or enable Topic Memory decisions.

The Worker remains synthetic-data-only until Phase 1 is explicitly approved and deployed.

## Target deployment topology

| Environment | Worker name | Intended hostname | Access groups | Runtime data binding |
| --- | --- | --- | --- | --- |
| Staging | `eip-exco-cockpit-staging` | `cockpit-staging.thejohanssons.nu` | `viewers`, `admin` | None in Phase 0 |
| Production | `eip-exco-cockpit` | `cockpit.thejohanssons.nu` | `viewers`, `admin` | None in Phase 0 |

Use separate hostnames and Cloudflare Access applications for staging and production. Do not expose either hostname publicly without Cloudflare Access.

## Deployment evidence and current release gate

- Staging is deployed at `cockpit-staging.thejohanssons.nu` with Worker version `826f3bd8-e4ce-4cce-9ef0-18d8a90a7d40`.
- The Worker has no public `workers.dev` or preview URL exposure because [`workers_dev`](wrangler.jsonc:15) is disabled.
- On 2026-08-18, the dedicated staging Access application was created for `cockpit-staging.thejohanssons.nu` using a Public DNS application target.
- Staging verification passed: `peter@thejohanssons.nu` completed Cloudflare One-time login and reached the Cockpit.
- The staging policy is intentionally a temporary single-user Allow policy while the Microsoft Entra group-claim configuration is deferred. It must be replaced with the approved `viewers` and `admin` Entra-backed policies before multi-user or production access.
- Do **not** deploy production until it has its own Access application and has passed the equivalent verification. Creating or changing Access resources requires a Cloudflare Zero Trust administrator credential with Access write permission; the authenticated Wrangler OAuth token has Access read permission only.

## Cloudflare Access configuration

### 1. Interim staging identity: Cloudflare One-time login

The current staging gate is deliberately limited to one identity while Entra integration is deferred:

1. Enable Cloudflare One-time login.
2. Create the staging application as a Public DNS Access application for `cockpit-staging.thejohanssons.nu`.
3. Add one Allow policy that includes only `peter@thejohanssons.nu` by email.
4. Rely on Access default-deny; do not add a catch-all Deny policy.

This is an interim staging control only. Cloudflare dashboard credentials are not used to authenticate to the Cockpit; the One-time login code is delivered to the allowed email address.

### 2. Target identity: Microsoft Entra ID

Before multi-user access or production release, configure Microsoft Entra ID as the identity provider, map the approved security groups to `viewers` and `admin`, and replace the interim email Allow policy with those group-backed policies.

### 3. Create one Access application per environment

Create a Cloudflare Access self-hosted application for each dedicated Cockpit hostname.

For **each** application, add only these Allow policies:

1. **Allow — Cockpit viewers**: include the `viewers` Entra-mapped Access group.
2. **Allow — Cockpit admins**: include the `admin` Entra-mapped Access group.

Cloudflare Access is default-deny: identities that match neither Allow policy are denied. Do **not** add a catch-all Deny policy, because Deny policies can override the intended Allow policies.

`admin` is reserved for later mutating review workflows. In Phase 0 and Phase 1, both roles have the same read-only Cockpit experience. Do not infer roles from unverified browser-provided headers.

### 4. Verify before release

For the current single-user staging gate:

- An unauthenticated request is redirected to Cloudflare Access rather than receiving Cockpit content.
- `peter@thejohanssons.nu` can complete One-time login and open the Cockpit.
- Any other email address is denied.
- The staging Access application cannot grant access to production by hostname overlap or shared policy scope.

Before multi-user or production release, repeat verification for an allowed `viewers` identity, an allowed `admin` identity, and an identity outside both groups.

Record the Access application ID, hostname, Entra group object IDs, policy IDs, verification date, and responsible owner in the organisation's secure operational register. Do not commit those identifiers or credentials to this repository.

## Deployment procedure

All commands below are run from [`packages/exco-cockpit/package.json`](package.json:1).

1. Authenticate a least-privilege deployment identity with Worker deploy permission for the target environment only.
2. Run local checks:

   ```sh
   npm run typecheck
   npm test
   ```

3. Deploy staging:

   ```sh
   npx wrangler deploy --env staging
   ```

4. Confirm the staging Worker and Access application use the intended dedicated hostname.
5. Perform the Access verification matrix above and record the result.
6. Deploy production only after staging approval:

   ```sh
   npx wrangler deploy
   ```

7. Confirm the production hostname remains protected by the production Access application.

Do not use preview URLs or a `workers.dev` hostname as an unprotected substitute for the Access-protected Cockpit hostname.

## Binding and secret guardrails

### Phase 0

- [`wrangler.jsonc`](wrangler.jsonc:1) deliberately declares no runtime D1, feedback D1, R2, queue, service, or secret bindings.
- `COCKPIT_ACCESS_MODE=cloudflare-access-required` is a non-secret deployment assertion, not an authorization control.
- Cloudflare Access is the network identity boundary; the Worker must not treat the assertion variable as proof of user identity.

### Phase 1: read-only runtime data

The constrained runtime D1 read model is implemented. [`runtime-d1-reader.ts`](src/runtime-d1-reader.ts:1) issues only fixed `SELECT` statements and maps explicit business-field allow-lists into Cockpit DTOs; it never returns raw D1 rows.

[`wrangler.jsonc`](wrangler.jsonc:1) binds distinct staging and production runtime D1 databases as `RUNTIME_DB`. The Worker may use this binding only through the approved reader. The Cockpit must never expose transcript text, transcript hashes, R2 keys, storage locators, source credentials, raw prompts, or hidden runtime metadata.

Before promotion, run the Cockpit typecheck and test suite, validate the staging response contract using actual staging records, and obtain staging approval. Phase 1 provides no mutation route; feedback and Topic Memory decisions remain deferred to their respective phases.

### Phase 2: feedback

Add a separate feedback D1 binding only after its append-only schema, retention rules, and reviewer identity provenance are approved. The feedback binding must remain separate from runtime source records.

### Phase 3: decisions

Use a narrowly scoped Worker service binding or authenticated internal command endpoint for Topic Memory decisions. The browser must never receive a decision credential. Enforce role authorization server-side from verified Access identity, plus source-version concurrency, idempotency, audit, and rollback controls.

## Credential and rotation controls

- Use dedicated deployment identities rather than personal long-lived API tokens.
- Scope each deployment token to the minimum account, Worker, and environment permissions required.
- Store production secrets only in Cloudflare Workers Secrets or the organisation's approved secret manager; never in source files, browser assets, `.env` files committed to Git, or Wrangler `vars`.
- Name secrets by purpose and environment, such as `RUNTIME_READ_SERVICE_TOKEN` and `REVIEW_COMMAND_SERVICE_TOKEN`; do not reuse values across environments.
- Record owner, creation date, expiry, rotation date, and emergency revocation procedure in the secure operational register.
- Rotate a secret by creating a replacement, deploying and verifying it, then revoking the previous value. Test staging rotation before production rotation.

## Rollback and incident response

### Worker rollback

If a deployment is unsafe, roll back through the Cloudflare dashboard or Wrangler to the previously known-good Worker version. Keep the Access application enabled while rolling back.

### Access incident

If access is over-broad or an Entra group mapping is suspect:

1. Disable or restrict the affected Access policy immediately.
2. Revoke affected sessions in Cloudflare Zero Trust.
3. Correct the Entra mapping or policy scope.
4. Re-run the verification matrix before restoring access.
5. Record the incident and remediation in the secure operational register.

## Phase 0 exit criteria

The current staging-only interim gate is complete when all of the following are true:

- Staging uses its dedicated Worker deployment, hostname, and Access application.
- Only `peter@thejohanssons.nu` can complete Cloudflare One-time login for staging.
- The staging verification matrix has passed.
- No production data binding or mutation capability has been introduced.

Full Phase 0 release readiness additionally requires a dedicated production Access application, Entra-backed `viewers` and `admin` group policies, staging and production verification, and deployment/emergency-access records outside Git in the secure operational register.
