// ============================================================
// EIP Local Cockpit Server — Entry point
//
// IMPORTANT: This is a localhost-only POC server.
// - Binds ONLY to 127.0.0.1 (loopback).
// - Has no Wrangler configuration, no Worker bindings.
// - Reads production D1 with locally-held credentials.
// - Writes feedback ONLY to a dedicated isolated D1 database.
// - Must NEVER be deployed or exposed beyond the local machine.
// ============================================================

import { createServer } from 'node:http';
import { loadEnv } from './env.js';
import { enforceLoopback } from './loopback-guard.js';
import { createRuntimeD1Adapter } from './adapters/runtime-d1.js';
import { createFeedbackD1Adapter } from './adapters/feedback-d1.js';
import { createRuntimeReviewClient } from './adapters/runtime-review-client.js';
import { createRouter } from './router.js';

async function main(): Promise<void> {
  // ── 1. Load and validate credentials ──────────────────────
  const env = loadEnv();

  const HOST = env.HOST ?? '127.0.0.1';
  const PORT = parseInt(env.PORT ?? '4321', 10);

  // ── 2. Enforce loopback binding ───────────────────────────
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
    throw new Error(
      `[local-cockpit-server] Refusing to bind to non-loopback host "${HOST}". ` +
      `This server must only bind to 127.0.0.1 or localhost.`
    );
  }

  // ── 3. Create read-only source adapters ───────────────────
  const runtimeD1 = createRuntimeD1Adapter({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    token: env.CLOUDFLARE_D1_READ_TOKEN,
    databaseId: env.RUNTIME_D1_DATABASE_ID,
  });

  // NOTE: R2 is not used in this POC. The management API listing contract
  // is unverified (the documented truncated/cursor/objects schema is for
  // the Workers binding, not the REST endpoint). R2 access is deferred to
  // a future production design using native Workers R2 bindings.

  // ── 4. Create feedback adapter (append-only, isolated DB) ─
  const feedbackD1 = createFeedbackD1Adapter({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    token: env.CLOUDFLARE_FEEDBACK_TOKEN,
    databaseId: env.FEEDBACK_D1_DATABASE_ID,
  });

  // ── 5. Create the only runtime mutation client ────────────
  const runtimeReviewClient = createRuntimeReviewClient({
    apiUrl: env.RUNTIME_REVIEW_API_URL,
    decisionToken: env.RUNTIME_REVIEW_DECISION_TOKEN,
  });

  // ── 6. Build router ───────────────────────────────────────
  const router = createRouter({ runtimeD1, feedbackD1, runtimeReviewClient });

  // ── 6. Start HTTP server, loopback-only ───────────────────
  const server = createServer((req, res) => {
    // Enforce loopback at the HTTP layer (defence in depth)
    if (!enforceLoopback(req, res)) return;
    router(req, res);
  });

  server.listen(PORT, HOST, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  EIP Local Cockpit Server — LOCALHOST ONLY POC               ║
║  Bound to: http://${HOST}:${PORT}                                  ║
║                                                              ║
║  ⚠  This server reads LIVE PRODUCTION data.                 ║
║  ⚠  Reads live production D1 data. Keep port private.       ║
║  ⚠  Do NOT expose this port. Do NOT deploy this server.     ║
║  ⚠  Feedback is permanently retained in a dedicated D1 DB.  ║
╚══════════════════════════════════════════════════════════════╝
    `.trim());
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[local-cockpit-server] Shutting down...');
    server.close(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}

main().catch(err => {
  console.error('[local-cockpit-server] Fatal startup error:', err);
  process.exit(1);
});
