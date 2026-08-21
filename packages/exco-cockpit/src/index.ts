// ============================================================
// EIP ExCo Cockpit — Worker entry point
// Phase 1 read-only runtime D1, Phase 2 append-only feedback D1, and Phase 3
// guarded Topic Memory review decisions.
// ============================================================

import { createRuntimeD1Reader } from './runtime-d1-reader';
import { routeRuntimeApiRequest } from './runtime-api';
import { createFeedbackD1Reader } from './feedback-d1';
import { createRuntimeReviewD1Writer } from './runtime-review-d1';

interface Env {
  // Wrangler static-assets binding (configured via assets.directory in wrangler.jsonc)
  ASSETS: Fetcher;
  // Runtime data binding. Reads use fixed allow-list queries; the narrow Phase
  // 3 decision writer alone can execute the guarded transition transaction.
  RUNTIME_DB: D1Database;
  // Isolated Phase 2 feedback binding. The runtime reader never receives it.
  FEEDBACK_DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // API routes take priority over static assets.
    const apiResponse = await routeRuntimeApiRequest(
      request,
      url,
      createRuntimeD1Reader(env.RUNTIME_DB),
      createFeedbackD1Reader(env.FEEDBACK_DB),
      createRuntimeReviewD1Writer(env.RUNTIME_DB),
    );
    if (apiResponse !== null) return apiResponse;

    // Delegate all non-API requests to the static assets binding.
    return env.ASSETS.fetch(request);
  },
};
