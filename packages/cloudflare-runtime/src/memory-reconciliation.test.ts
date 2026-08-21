import { describe, expect, test } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { parseMemoryReconciliationRequest, previewMemoryReconciliation } from './memory-reconciliation';

function fixtureDb() {
  const db = {
    prepare(sql: string) {
      return {
        async all<T>() {
          if (sql.includes('meeting_invalidations')) return { results: [{ meeting_id: 'bad-meeting' }] } as T;
          return { results: [] } as T;
        },
        bind(..._params: unknown[]) {
          return {
            async all<T>() {
              if (sql.includes('meeting_invalidations')) {
                return { results: [{ meeting_id: 'bad-meeting' }] } as T;
              }
              return { results: [
                { memory_id: 'orphan', canonical_statement: 'Orphan', first_seen_meeting_id: 'bad-meeting', last_seen_meeting_id: 'bad-meeting', meeting_count: 1, match_status: 'confirmed', status: 'open', merged_into_memory_id: null },
                { memory_id: 'history', canonical_statement: 'History', first_seen_meeting_id: 'good-meeting', last_seen_meeting_id: 'bad-meeting', meeting_count: 2, match_status: 'confirmed', status: 'open', merged_into_memory_id: null },
              ] } as T;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return db;
}

describe('memory reconciliation preview', () => {
  test('defaults to all invalidated meetings', () => {
    expect(parseMemoryReconciliationRequest({})).toEqual({ meetingIds: [], dryRun: true, confirm: null });
  });

  test('classifies orphan and longitudinal memories without mutation', async () => {
    const result = await previewMemoryReconciliation(fixtureDb(), { meetingIds: [], dryRun: true, confirm: null });
    expect(result.dryRun).toBe(true);
    expect(result.invalidatedMeetingIds).toEqual(['bad-meeting']);
    expect(result.rows.map((row) => row.classification).sort()).toEqual(['longitudinal-rebuild', 'orphan-candidate'].sort());
  });
});
