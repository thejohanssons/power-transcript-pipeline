# Local Cockpit Server — Operator Runbook

**Classification:** Internal operational document  
**Scope:** `packages/local-cockpit-server` localhost-only POC  
**Production status:** Explicitly deferred — see `plans/local-live-cockpit-feedback-poc-plan.md`

---

## Before you start: READ THIS

This server reads **live production D1 data**. It must:
- Run only on your local machine, bound to `127.0.0.1`
- Never be deployed to Cloudflare or any remote host
- Never have its port forwarded, tunnelled, or proxied
- Credentials must never be shared, committed, or logged

---

## 1. Provision credentials

You need **two separate Cloudflare API tokens** with minimal scopes:

### Token 1 — Runtime D1 read-only
- Go to: Cloudflare Dashboard → My Profile → API Tokens → Create Token
- Template: Custom token
- Permissions: `D1 — Read` for database `eip-cloudflare-runtime` (ID: `953bd671-7f96-450c-96da-736ecbfdf19d`)
- No other permissions
- Set expiry: 30 days (review and rotate)
- Copy to `.env.local` as `CLOUDFLARE_D1_READ_TOKEN`

> **Note:** Cloudflare API tokens cannot enforce SQL `SELECT`-only access for D1.
> The structural read-only guarantee (no write methods in the adapter) is defence in depth,
> not a complete protection against a compromised credential. Treat this token with care.

### Token 2 — Runtime review decision secret

Provision `REVIEW_DECISION_TOKEN` as a Worker secret on the runtime Worker. Store the equivalent `RUNTIME_REVIEW_DECISION_TOKEN` only in the operator workstation's git-ignored `.env.local`. The browser and local server logs must never receive or print the token. The local server has no runtime D1 management write token; it only calls the fixed Worker command endpoint.

Set `RUNTIME_REVIEW_API_URL` to the approved staging or production Worker URL. Validate staging first, then provision production only after the runtime D1 backup/export gate is complete.

### Token 3 — Feedback D1 read+write (dedicated DB only)

> ⚠️ **Administrative prerequisite — run Wrangler commands outside this package.**  
> The `local-cockpit-server` package prohibits Wrangler. The database provisioning and  
> migration commands below must be run from the repository root or a separate  
> administrative context, not from inside `packages/local-cockpit-server/`.

**One-time database setup (run from repo root):**
```bash
# From repository root — NOT from packages/local-cockpit-server/
wrangler d1 create eip-local-feedback
# Copy the database_id output to .env.local as FEEDBACK_D1_DATABASE_ID

wrangler d1 migrations apply eip-local-feedback \
  --remote \
  --migrations-dir packages/local-cockpit-server/migrations
```

**Then provision the API token:**
- Permissions: `D1 — Read + Write` for the feedback database **only**
- **Must NOT** include the runtime D1
- Set expiry: 30 days
- Copy to `.env.local` as `CLOUDFLARE_FEEDBACK_TOKEN`

---

## 2. Set up .env.local

```bash
cp packages/local-cockpit-server/.env.local.example packages/local-cockpit-server/.env.local
# Edit .env.local with the real values from step 1
```

Verify `.env.local` is in `.gitignore` (it is — but double-check before any commit).

---

## 3. Run the pre-flight baseline check

**Do not start the server without this step.**

Both `PREFLIGHT_OPERATOR` and `PREFLIGHT_BACKUP_REF` are **required** — preflight will hard-fail if either is empty.

`PREFLIGHT_BACKUP_REF` must reference an approved, recoverable backup or export of the production runtime D1 database that exists *before* this session starts. For example:
- `"wrangler d1 export eip-cloudflare-runtime --output=backup-2026-08-11.sql"`

```bash
cd packages/local-cockpit-server
npm install
npm run build
PREFLIGHT_OPERATOR=your-name \
PREFLIGHT_BACKUP_REF="D1 export 2026-08-11T08:00Z via wrangler d1 export" \
npm run preflight
```

This captures D1 row counts and recent-meeting spot-check into `run-logs/<timestamp>-baseline.json`.
Record the baseline file path and counts in your session log.

**Stop if preflight fails.** Investigate and resolve before proceeding.

---

## 4. Start the server

```bash
npm run build
npm start
```

Open http://127.0.0.1:4321 in your browser.

The server logs a warning banner on startup. Confirm it shows `127.0.0.1`.

---

## 5. During the review session

### Topic Memory review semantics

- A Topic Memory is a durable canonical trajectory across one or more meetings, not merely a matched pair.
- **Match** means `merge candidate into existing Topic Memory trajectory`; the Runtime Worker is the only component permitted to perform that write.
- **No match** means `confirm separate Topic Memory`; it preserves the candidate as an independent root.
- The local D1 adapter is read-only and uses fixed `SELECT` statements. Do not modify Runtime D1 directly from the Cockpit or workstation.
- Merged source observations remain retained for provenance but are not counted as additional Topic Memory trajectories in the default All Content view.
- After a successful decision, verify that Overview, All Content, Topic Memories, Topics, and Pending review all refresh from the live snapshot.

### Read-only merged-target diagnostic

If the Cockpit shows `target unavailable` for a merged source observation, run the read-only report in `packages/cloudflare-runtime/diagnostics/topic-memory-merge-integrity.sql` against the Runtime D1 database using an approved read-only operational procedure. Inspect the SQL before execution; it contains `SELECT` statements only and must not be modified into a repair script.

The report classifies records as:

- `merged_missing_target`: merged status but no `merged_into_memory_id`;
- `merged_missing_audit`: no review event with a target ID;
- `merged_target_audit_mismatch`: stored target differs from the latest audit target;
- `merged_target_missing`: stored target ID does not resolve to a Topic Memory;
- `merged_target_is_merged`: target is itself a merged child;
- `healthy_merged`: target and audit relationship are present.

Capture the report output for review. Do not repair rows through the local D1 adapter or by editing the diagnostic query; any correction must use an approved Runtime Worker-authorized maintenance operation.

- Do not paste raw transcripts into feedback notes
- Do not share the server port with other machines
- Do not run `wrangler deploy` or any Wrangler command from this package

---

## 6. After the review session

Run the post-session baseline and compare:

```bash
PREFLIGHT_OPERATOR=your-name \
PREFLIGHT_BACKUP_REF="D1 export <timestamp> via wrangler d1 export" \
npm run preflight
```

Compare the new baseline JSON to the pre-session one:
```bash
diff run-logs/<pre-session>-baseline.json run-logs/<post-session>-baseline.json
```

**Any difference in D1 counts is an incident** until explained. The cockpit must not be used
as a recovery mechanism or treated as a source of truth.

---

## 7. Credential scope and expiry record

| Token | Scope | Expiry | Rotation due |
|-------|-------|--------|--------------|
| D1 read | Runtime D1 read only | 30 days from provisioning | — |
| Feedback D1 | Feedback DB read+write | 30 days from provisioning | — |

Update this table when credentials are rotated.

---

## 8. Residual risks (acknowledged)

- The D1 read token's permissions are enforced structurally in code, not by Cloudflare's API
  token permission system. A compromised token with wider Cloudflare scope would not be
  constrained by the adapter's `SELECT`-only queries.
- Reviewer notes are permanently retained and may contain sensitive content despite the
  warning. The feedback D1 must be treated as sensitive operational data.
- Package scripts prevent accidental Wrangler invocation but cannot prevent a developer from
  running `wrangler deploy` manually outside the package scripts.
