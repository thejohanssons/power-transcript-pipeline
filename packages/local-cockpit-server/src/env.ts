// ============================================================
// EIP Local Cockpit Server — Environment / credential types
// All credentials live in .env.local (git-ignored).
// This file only declares types and validation — no secrets here.
// ============================================================

export interface LocalEnv {
  // Cloudflare account credentials
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_D1_READ_TOKEN: string;       // Token for production runtime D1 reads only

  // Production runtime D1
  RUNTIME_D1_DATABASE_ID: string;         // e.g. 953bd671-7f96-450c-96da-736ecbfdf19d

  // NOTE: R2 credentials are not used in this POC.
  // R2 access is deferred to a future production design using Workers bindings.

  // Feedback D1 (separate dedicated database — append-only writes)
  CLOUDFLARE_FEEDBACK_TOKEN: string;      // Token scoped only to the feedback D1
  FEEDBACK_D1_DATABASE_ID: string;        // Dedicated feedback database ID

  // Narrow runtime review command (never exposed to browser)
  RUNTIME_REVIEW_API_URL: string;
  RUNTIME_REVIEW_DECISION_TOKEN: string;

  // Server config
  PORT?: string;                          // Default: 4321
  HOST?: string;                          // Default: 127.0.0.1
}

/**
 * Reads and validates required env vars. Throws clearly if any are missing.
 * Call once at startup; pass the result everywhere else.
 */
export function loadEnv(): LocalEnv {
  const required: Array<keyof LocalEnv> = [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_D1_READ_TOKEN',
    'RUNTIME_D1_DATABASE_ID',
    'CLOUDFLARE_FEEDBACK_TOKEN',
    'FEEDBACK_D1_DATABASE_ID',
    'RUNTIME_REVIEW_API_URL',
    'RUNTIME_REVIEW_DECISION_TOKEN',
  ];

  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[local-cockpit-server] Missing required environment variables:\n` +
      missing.map(k => `  - ${k}`).join('\n') +
      `\n\nCreate packages/local-cockpit-server/.env.local with the above variables.` +
      `\nSee the operator runbook in RUNBOOK.md for credential provisioning instructions.`
    );
  }

  return {
    CLOUDFLARE_ACCOUNT_ID:    process.env.CLOUDFLARE_ACCOUNT_ID!,
    CLOUDFLARE_D1_READ_TOKEN: process.env.CLOUDFLARE_D1_READ_TOKEN!,
    RUNTIME_D1_DATABASE_ID:   process.env.RUNTIME_D1_DATABASE_ID!,
    CLOUDFLARE_FEEDBACK_TOKEN: process.env.CLOUDFLARE_FEEDBACK_TOKEN!,
    FEEDBACK_D1_DATABASE_ID:  process.env.FEEDBACK_D1_DATABASE_ID!,
    RUNTIME_REVIEW_API_URL:    process.env.RUNTIME_REVIEW_API_URL!,
    RUNTIME_REVIEW_DECISION_TOKEN: process.env.RUNTIME_REVIEW_DECISION_TOKEN!,
    PORT:                     process.env.PORT,
    HOST:                     process.env.HOST,
  };
}
