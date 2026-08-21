import type { D1Database } from '@cloudflare/workers-types';
import type { MemoryReconciliationRequest, MemoryReconciliationRow } from './memory-reconciliation';

const CONFIRMATION = 'RECONCILE_MEMORIES';

export async function applyMemoryReconciliation(
  db: D1Database,
  rows: MemoryReconciliationRow[],
  request: MemoryReconciliationRequest,
): Promise<{ dryRun: boolean; confirmationRequired?: string; applied: Array<{ memoryId: string; action: string }> }> {
  if (request.dryRun) return { dryRun: true, applied: [] };
  if (request.confirm !== CONFIRMATION) return { dryRun: false, confirmationRequired: CONFIRMATION, applied: [] };

  const applied: Array<{ memoryId: string; action: string }> = [];
  for (const row of rows) {
    if (row.classification === 'merged-or-pending-review') continue;
    const now = crypto.randomUUID();
    if (row.classification === 'orphan-candidate') {
      await db.batch([
        db.prepare(`INSERT INTO memory_reconciliation_audit
          (reconciliation_id,memory_id,classification,action,before_json,invalidated_meeting_ids_json)
          VALUES (?,?,?,?,?,?)`).bind(now, row.memoryId, row.classification, 'invalidate', JSON.stringify(row), JSON.stringify([row.firstSeenMeetingId, row.lastSeenMeetingId])),
        db.prepare("UPDATE topic_memory SET status='invalidated', updated_at=datetime('now') WHERE memory_id=?").bind(row.memoryId),
      ]);
      applied.push({ memoryId: row.memoryId, action: 'invalidated' });
    } else {
      await db.batch([
        db.prepare(`INSERT INTO memory_reconciliation_audit
          (reconciliation_id,memory_id,classification,action,before_json,invalidated_meeting_ids_json)
          VALUES (?,?,?,?,?,?)`).bind(now, row.memoryId, row.classification, 'rebuild-required', JSON.stringify(row), JSON.stringify([row.lastSeenMeetingId])),
        db.prepare("UPDATE topic_memory SET status='needs_rebuild', updated_at=datetime('now') WHERE memory_id=?").bind(row.memoryId),
      ]);
      applied.push({ memoryId: row.memoryId, action: 'marked-needs-rebuild' });
    }
  }
  return { dryRun: false, applied };
}
