import type { D1Database } from '@cloudflare/workers-types';

export interface MemoryReconciliationRequest {
  meetingIds: string[];
  dryRun: boolean;
  confirm: string | null;
}

export type MemoryReconciliationClass = 'orphan-candidate' | 'longitudinal-rebuild' | 'merged-or-pending-review';

export interface MemoryReconciliationRow {
  memoryId: string;
  classification: MemoryReconciliationClass;
  recommendedAction: string;
  canonicalStatement: string;
  firstSeenMeetingId: string | null;
  lastSeenMeetingId: string | null;
  meetingCount: number;
  matchStatus: string;
  status: string;
  mergedIntoMemoryId: string | null;
}

export function parseMemoryReconciliationRequest(body: unknown): MemoryReconciliationRequest {
  const value = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  return {
    meetingIds: Array.isArray(value.meetingIds)
      ? value.meetingIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).slice(0, 50)
      : [],
    dryRun: value.dryRun !== false,
    confirm: typeof value.confirm === 'string' ? value.confirm : null,
  };
}

export async function previewMemoryReconciliation(
  db: D1Database,
  request: MemoryReconciliationRequest,
): Promise<{ dryRun: true; invalidatedMeetingIds: string[]; rows: MemoryReconciliationRow[] }> {
  const invalidated = request.meetingIds.length > 0
    ? request.meetingIds
    : (await db.prepare('SELECT DISTINCT meeting_id FROM meeting_invalidations ORDER BY meeting_id').all<{ meeting_id: string }>())
      .results.map((row) => row.meeting_id);

  if (invalidated.length === 0) return { dryRun: true, invalidatedMeetingIds: [], rows: [] };

  const placeholders = invalidated.map(() => '?').join(', ');
  const memories = await db.prepare(`SELECT memory_id,canonical_statement,first_seen_meeting_id,last_seen_meeting_id,
      meeting_count,match_status,status,merged_into_memory_id
    FROM topic_memory
    WHERE first_seen_meeting_id IN (${placeholders})
       OR last_seen_meeting_id IN (${placeholders})
    ORDER BY memory_id`).bind(...invalidated, ...invalidated).all<{
      memory_id: string;
      canonical_statement: string;
      first_seen_meeting_id: string | null;
      last_seen_meeting_id: string | null;
      meeting_count: number;
      match_status: string;
      status: string;
      merged_into_memory_id: string | null;
    }>();

  const rows = memories.results.map((memory): MemoryReconciliationRow => {
    const firstInvalidated = memory.first_seen_meeting_id !== null && invalidated.includes(memory.first_seen_meeting_id);
    const lastInvalidated = memory.last_seen_meeting_id !== null && invalidated.includes(memory.last_seen_meeting_id);
    const reviewSensitive = memory.match_status !== 'confirmed' || memory.merged_into_memory_id !== null;
    if (reviewSensitive) {
      return {
        memoryId: memory.memory_id,
        classification: 'merged-or-pending-review',
        recommendedAction: 'Leave unchanged and review manually after topic-memory links are rebuilt',
        canonicalStatement: memory.canonical_statement,
        firstSeenMeetingId: memory.first_seen_meeting_id,
        lastSeenMeetingId: memory.last_seen_meeting_id,
        meetingCount: memory.meeting_count,
        matchStatus: memory.match_status,
        status: memory.status,
        mergedIntoMemoryId: memory.merged_into_memory_id,
      };
    }
    if (firstInvalidated && lastInvalidated && memory.meeting_count <= 1) {
      return {
        memoryId: memory.memory_id,
        classification: 'orphan-candidate',
        recommendedAction: 'Quarantine memory after confirming no surviving topic observations',
        canonicalStatement: memory.canonical_statement,
        firstSeenMeetingId: memory.first_seen_meeting_id,
        lastSeenMeetingId: memory.last_seen_meeting_id,
        meetingCount: memory.meeting_count,
        matchStatus: memory.match_status,
        status: memory.status,
        mergedIntoMemoryId: memory.merged_into_memory_id,
      };
    }
    return {
      memoryId: memory.memory_id,
      classification: 'longitudinal-rebuild',
      recommendedAction: 'Recalculate first/last seen, meeting count, and latest fields from surviving topic observations',
      canonicalStatement: memory.canonical_statement,
      firstSeenMeetingId: memory.first_seen_meeting_id,
      lastSeenMeetingId: memory.last_seen_meeting_id,
      meetingCount: memory.meeting_count,
      matchStatus: memory.match_status,
      status: memory.status,
      mergedIntoMemoryId: memory.merged_into_memory_id,
    };
  });

  return { dryRun: true, invalidatedMeetingIds: invalidated, rows };
}
