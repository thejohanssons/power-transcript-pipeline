// ============================================================
// EIP ExCo Cockpit — Worker entry point
// Synthetic-fixture POC. No real data, no mutations.
// Real-data promotion blocked until Cloudflare Access is
// configured and a constrained D1 read-model is approved.
// ============================================================

import { routeApiRequest } from './api';

interface Env {
  // Wrangler static-assets binding (configured via assets.directory in wrangler.jsonc)
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // API routes take priority over static assets
    const apiResponse = routeApiRequest(request, url);
    if (apiResponse !== null) return apiResponse;

    // Delegate all non-API requests to the static assets binding
    return env.ASSETS.fetch(request);
  },
};
