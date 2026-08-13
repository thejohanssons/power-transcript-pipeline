// ============================================================
// EIP Local Cockpit Server — Pre-flight baseline check (Step 4)
//
// Run before and after a review session to confirm that production
// D1 source records are unchanged.
//
// Usage: node --env-file=.env.local dist/preflight.js
//
// Output is written to run-logs/<timestamp>-baseline.json
// A missing or failed baseline is a STOP condition — do not start
// the POC session until it passes.
//
// Required env:
//   PREFLIGHT_OPERATOR   — your name/handle (must be non-empty)
//   PREFLIGHT_BACKUP_REF — reference to approved backup/export (must be non-empty)
//                          e.g. "D1 export 2026-08-11T09:00Z stored at s3://eip-backups/..."
// ============================================================

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { createRuntimeD1Adapter } from './adapters/runtime-d1.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const LOGS_DIR = join(__dirname, '..', 'run-logs');

async function main(): Promise<void> {
  console.log('[preflight] Loading environment...');
  const env = loadEnv();

  // ── Operator and backup evidence are required ──────────────
  const operator = (process.env.PREFLIGHT_OPERATOR ?? '').trim();
  const backupRef = (process.env.PREFLIGHT_BACKUP_REF ?? '').trim();

  if (!operator) {
    throw new Error(
      '[preflight] PREFLIGHT_OPERATOR must be set to a non-empty name/handle.\n' +
      'Example: PREFLIGHT_OPERATOR="alice" npm run preflight'
    );
  }
  if (!backupRef) {
    throw new Error(
      '[preflight] PREFLIGHT_BACKUP_REF must be set to a reference to an approved\n' +
      'backup or export of the production runtime D1 database.\n' +
      'Example: PREFLIGHT_BACKUP_REF="D1 export 2026-08-11T09:00Z via wrangler d1 export"'
    );
  }

  console.log(`[preflight] Operator: ${operator}`);
  console.log(`[preflight] Backup reference: ${backupRef}`);

  const runtimeD1 = createRuntimeD1Adapter({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    token: env.CLOUDFLARE_D1_READ_TOKEN,
    databaseId: env.RUNTIME_D1_DATABASE_ID,
  });

  // ── D1 baseline counts ─────────────────────────────────────
  console.log('[preflight] Running D1 baseline counts...');
  const counts = await runtimeD1.baselineCounts();
  console.log('[preflight] D1 counts:', counts);

  // ── D1 most-recent meeting IDs (deterministic spot check) ──
  console.log('[preflight] Fetching 5 most-recent meeting IDs...');
  const recentMeetings = await runtimeD1.listMeetings();
  const recentMeetingIds = recentMeetings.slice(0, 5).map(m => ({
    meetingId: m.meeting_id,
    eventDate: m.event_date,
    state: m.state,
    updatedAt: m.updated_at,
  }));

  // R2 is not used in this POC — no R2 baseline is captured.
  // D1 baseline counts and recent-meeting spot-check are sufficient to
  // detect unexpected writes to the production database.

  const baseline = {
    capturedAt: new Date().toISOString(),
    operator,
    backupRef,
    runtimeD1DatabaseId: env.RUNTIME_D1_DATABASE_ID,
    d1Counts: counts,
    d1RecentMeetingSpotCheck: recentMeetingIds,
  };

  console.log('\n[preflight] Baseline snapshot:');
  console.log(JSON.stringify(baseline, null, 2));

  // ── Persist to run-logs/ ──────────────────────────────────
  await mkdir(LOGS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = join(LOGS_DIR, `${ts}-baseline.json`);
  await writeFile(logPath, JSON.stringify(baseline, null, 2));
  console.log(`\n[preflight] ✅ Baseline saved to: ${logPath}`);
  console.log('[preflight] Compare this file to a post-session run to verify no writes occurred.');
}

main().catch(err => {
  console.error('[preflight] ❌ Preflight FAILED:', err);
  console.error('[preflight] Do NOT start the POC session until preflight passes.');
  process.exit(1);
});
