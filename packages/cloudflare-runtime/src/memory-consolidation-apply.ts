import type { D1Database } from '@cloudflare/workers-types';
import type { ConsolidationProposal, RootTopicProposal } from './memory-consolidation';

const CONFIRMATION = 'APPLY_TOPIC_MEMORY_CONSOLIDATION';

type Override = string;

export interface ConsolidationApplyRequest {
  confirm: string | null;
  applyHighConfidence: boolean;
  createNewMemoryCandidates: boolean;
  overrides: Record<string, Override>;
}

export interface ConsolidationApplyResult {
  confirmationRequired?: string;
  linked: number;
  created: number;
  pending: number;
  merged: number;
  errors: Array<{ topicId: string; error: string }>;
}

export function parseConsolidationApplyRequest(body: unknown): ConsolidationApplyRequest {
  const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const overrides = value.overrides && typeof value.overrides === 'object' ? value.overrides as Record<string, Override> : {};
  return {
    confirm: typeof value.confirm === 'string' ? value.confirm : null,
    applyHighConfidence: value.applyHighConfidence === true,
    createNewMemoryCandidates: value.createNewMemoryCandidates === true,
    overrides,
  };
}

export async function applyMemoryConsolidation(
  db: D1Database,
  proposals: ConsolidationProposal[],
  roots: RootTopicProposal[],
  request: ConsolidationApplyRequest,
): Promise<ConsolidationApplyResult> {
  if (request.confirm !== CONFIRMATION) return { confirmationRequired: CONFIRMATION, linked: 0, created: 0, pending: 0, merged: 0, errors: [] };
  let linked = 0; let created = 0; let pending = 0; let merged = 0;
  const errors: Array<{ topicId: string; error: string }> = [];

  for (const proposal of proposals) {
    let memoryId: string | null = null;
    const override = request.overrides[proposal.topicId];
    if (override === 'pending') { pending += 1; continue; }
    if (override && override !== 'new-memory') memoryId = override;
    else if (proposal.confidence === 'high' && request.applyHighConfidence) memoryId = proposal.memoryId;
    else if (proposal.confidence === 'new-memory-candidate' && request.createNewMemoryCandidates || override === 'new-memory') {
      const topic = await db.prepare(`SELECT topic_id,meeting_id,domain,entity_type,entity,aspect,topic_statement,outcome,disposition,executive_scope
        FROM topics WHERE topic_id = ?`).bind(proposal.topicId).first<Record<string, string | null>>();
      if (!topic) { pending += 1; continue; }
      if (!topic.meeting_id || !topic.entity_type || !topic.entity || !topic.topic_statement) {
        pending += 1;
        continue;
      }
      memoryId = crypto.randomUUID();
      try {
        await db.prepare(`INSERT OR IGNORE INTO topic_memory
          (memory_id,root_topic_id,domain,entity_type,entity,aspect,canonical_statement,first_seen_meeting_id,first_seen_date,last_seen_meeting_id,last_seen_date,meeting_count,latest_outcome,latest_disposition,latest_executive_scope,match_status,status)
          SELECT ?,t.topic_id,t.domain,t.entity_type,t.entity,t.aspect,t.topic_statement,t.meeting_id,m.event_date,t.meeting_id,m.event_date,1,t.outcome,t.disposition,t.executive_scope,'confirmed','open'
          FROM topics t JOIN meetings m ON m.meeting_id=t.meeting_id WHERE t.topic_id=?`).bind(memoryId, proposal.topicId).run();
        created += 1;
      } catch (error) {
        errors.push({ topicId: proposal.topicId, error: error instanceof Error ? error.message : String(error) });
        pending += 1;
        continue;
      }
    }
    if (memoryId) {
      await db.prepare("UPDATE topics SET memory_id = ?, updated_at = datetime('now') WHERE topic_id = ? AND memory_id IS NULL")
        .bind(memoryId, proposal.topicId).run();
      linked += 1;
    } else if (proposal.confidence !== 'high') pending += 1;
  }

  for (const root of roots) {
    if (root.rootTopicId) {
      await db.prepare('UPDATE topic_memory SET root_topic_id = ?, updated_at = datetime(\'now\') WHERE memory_id = ? AND status <> \'invalidated\'')
        .bind(root.rootTopicId, root.memoryId).run();
    }
    for (const duplicateMemoryId of root.duplicateMemoryIds) {
      await db.prepare("UPDATE topic_memory SET status='merged', merged_into_memory_id=?, updated_at=datetime('now') WHERE memory_id=? AND status <> 'invalidated'")
        .bind(root.memoryId, duplicateMemoryId).run();
      merged += 1;
    }
  }
  return { linked, created, pending, merged, errors };
}
