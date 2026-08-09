# Phase 4 — Cloudflare Runtime Worker Deployment & Secrets Provisioning

Purpose
- Deploy the Cloudflare Runtime Worker ("runtime") that accepts `POST /v1/meetings` and wire up secrets so the Azure pipeline can submit transcripts.

Prerequisites
- Cloudflare account and account ID, zone, and Workers access.
- Access to the repository and CI that deploys the Cloudflare Worker.
- Azure Function App (pipeline) configuration privileges to set app settings/secrets.

Secrets and config
1. Cloudflare Worker
- `CF_API_TOKEN` (for publishing via `wrangler` or GitHub Actions) — scoped to upload/deploy.
- In-worker secret: `SUBMISSION_TOKEN` (the runtime's bearer token that the pipeline will accept) — set in Cloudflare Worker via `wrangler secret put SUBMISSION_TOKEN` or via Cloudflare UI.

2. Azure Pipeline / Function App
- `CLOUDFLARE_SUBMISSION_TOKEN` — set to the same value as the worker's `SUBMISSION_TOKEN`.
- Ensure `pipeline_config.json` contains `eip_cloudflare_runtime_url` with the runtime URL (e.g. `https://eip-cloudflare-runtime.<env>.workers.dev`).

Deployment steps (Cloudflare runtime)
1. Build & test the Cloudflare runtime code locally (unit tests / lint).
2. Deploy using `wrangler` or GitHub Actions; example with modern Wrangler (v3+):

```bash
# ensure CF_API_TOKEN is configured in the environment
npx wrangler deploy --env production
```

3. Set runtime secrets:

```bash
# required: runtime submission token
npx wrangler secret put SUBMISSION_TOKEN

# required: Azure OpenAI API key used by the runtime for LLM calls
npx wrangler secret put AZURE_OPENAI_API_KEY

# optional: Teams webhook for notifications
npx wrangler secret put TEAMS_WEBHOOK_URL
# paste each secret value when prompted
```

4. Confirm runtime is reachable at `https://<runtime-host>/v1/meetings`.

Azure Function App / Pipeline configuration
1. Set `CLOUDFLARE_SUBMISSION_TOKEN` in Function App settings (Application settings / Configuration in Azure portal) — mark as secret.
2. Verify `packages/pipeline/pipeline_config.json` (or Azure-provided config) contains `eip_cloudflare_runtime_url` pointing to the runtime URL.

CI / GitHub Actions
- If you have a CI step that deploys runtime or manages environment config, ensure it does NOT reset `eip_cloudflare_runtime_url` to a different value.
- Add a secrets provisioning step (optional) to rotate `CLOUDFLARE_SUBMISSION_TOKEN` securely.

Verification / Smoke tests
- After deployment and secret provisioning, run a smoke submission from a safe environment:

```bash
curl -X POST "https://<runtime-host>/v1/meetings" \
  -H "Authorization: Bearer <SUBMISSION_TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{"meetingId":"TEST-smoke-001","sourceSystem":"azure","nativeId":"native-smoke-001","subject":"Smoke Test","organiser":"test@org.com","eventDate":"2026-08-09T00:00:00Z","transcript":"This is a smoke test transcript submitted to verify the Cloudflare runtime worker is accepting requests correctly."}'
```

- Expect 2xx and a JSON body with the created record ID. If 4xx/401 -> check token mismatch; if 404 -> confirm runtime path and hostname.

Rollback
- If problems occur, disable pipeline submissions by removing `CLOUDFLARE_SUBMISSION_TOKEN` from the Function App (submissions will be skipped), and rollback the worker deployment to previous version.

Notes / Transition
- Remove any remaining fallback to `RUNTIME_SHADOW_SUBMISSION_TOKEN` after `CLOUDFLARE_SUBMISSION_TOKEN` is in place in all environments.
- Consider adding a small health-check endpoint on the runtime (GET /health) that returns status for automated monitoring.

Contact
- Add contact details or on-call for runtime ops and the pipeline owner.