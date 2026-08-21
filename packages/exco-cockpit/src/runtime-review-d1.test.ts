import { describe, expect, it } from 'vitest';
import {
  createRuntimeReviewD1Writer,
  ReviewDecisionConflictError,
} from './runtime-review-d1';
import type { TopicMemoryReviewDecisionRequest } from './types';

type Memory = {
  memory_id: string;
  match_status: 'pending_review' | 'confirmed' | 'merged';
  proposed_match_memory_id: string | null;
  merged_into_memory_id: string | null;
  updated_at: string;
  meeting_count: number;
  first_seen_date: string | null;
  last_seen_date: string | null;
  first_seen_meeting_id: string | null;
  last_seen_meeting_id: string | null;
  latest_outcome: string | null;
  latest_disposition: string | null;
  latest_executive_scope: string | null;
};

function makeDb() {
  const memories = new Map<string, Memory>();
  const events: Array<Record<string, unknown>> = [];
  const db = {
    prepare(sql: string) {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) { statement.params = params; return statement; },
        async first<T>() {
          const id = statement.params[0] as string;
          if (sql.includes('topic_memory_review_events')) return events.find(event => event.idempotency_key === id) as T | undefined;
          const memory = memories.get(id);
          if (sql.includes('SELECT updated_at FROM topic_memory')) return memory ? { updated_at: memory.updated_at } as T : undefined;
          return memory as unknown as T | undefined;
        },
      };
      return statement;
    },
    async batch(statements: Array<{ params: unknown[] }>) {
      const audit = statements[0];
      const candidateId = audit.params[1] as string;
      const targetId = audit.params[2] as string;
      const expectedVersion = audit.params[4] as string;
      const expectedTarget = audit.params[5] as string;
      const candidate = memories.get(candidateId);
      const target = memories.get(targetId);
      const eligible = candidate?.match_status === 'pending_review' && candidate.updated_at === expectedVersion &&
        candidate.proposed_match_memory_id === expectedTarget && target && target.match_status !== 'merged' && !target.merged_into_memory_id;
      if (!eligible) return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];

      const event = {
        review_event_id: audit.params[0], candidate_memory_id: candidateId, target_memory_id: targetId,
        decision: audit.params[3], expected_source_version: expectedVersion,
        expected_proposed_match_memory_id: expectedTarget, reviewer_name: audit.params[6],
        reviewer_note: audit.params[7], warning_acknowledged: 1, idempotency_key: audit.params[8],
        candidate_match_status_after: audit.params[9],
        target_meeting_count_before: target.meeting_count,
        target_meeting_count_after: audit.params[11],
        created_at: '2026-08-19T11:30:00Z',
      };
      events.push(event);
      if (event.decision === 'approve_match') {
        candidate.match_status = 'merged';
        candidate.merged_into_memory_id = targetId;
        target.meeting_count += candidate.meeting_count;
      } else {
        candidate.match_status = 'confirmed';
        candidate.proposed_match_memory_id = null;
      }
      candidate.updated_at = '2026-08-19T11:30:01Z';
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }, ...(event.decision === 'approve_match' ? [{ meta: { changes: 1 } }] : [])];
    },
  };
  return { db: db as unknown as D1Database, memories, events };
}

function seed(testDb: ReturnType<typeof makeDb>) {
  testDb.memories.set('candidate', {
    memory_id: 'candidate', match_status: 'pending_review', proposed_match_memory_id: 'target', merged_into_memory_id: null,
    updated_at: 'version-1', meeting_count: 2, first_seen_date: '2026-08-01', last_seen_date: '2026-08-10',
    first_seen_meeting_id: 'meeting-1', last_seen_meeting_id: 'meeting-2', latest_outcome: null,
    latest_disposition: null, latest_executive_scope: null,
  });
  testDb.memories.set('target', {
    memory_id: 'target', match_status: 'confirmed', proposed_match_memory_id: null, merged_into_memory_id: null,
    updated_at: 'target-version-1', meeting_count: 3, first_seen_date: '2026-07-01', last_seen_date: '2026-08-05',
    first_seen_meeting_id: 'meeting-0', last_seen_meeting_id: 'meeting-0', latest_outcome: null,
    latest_disposition: null, latest_executive_scope: null,
  });
}

function decision(overrides: Partial<TopicMemoryReviewDecisionRequest> = {}): TopicMemoryReviewDecisionRequest {
  return {
    decision: 'approve_match', expectedSourceVersion: 'version-1', expectedProposedMatchMemoryId: 'target',
    reviewerName: 'Executive Reviewer', note: 'Reviewed current evidence and trajectory.', warningAcknowledged: true,
    idempotencyKey: 'review-1', ...overrides,
  };
}

describe('guarded runtime Topic Memory review writer', () => {
  it('approves a current match, preserves candidate lineage, aggregates the target, and appends one audit event', async () => {
    const testDb = makeDb();
    seed(testDb);

    const result = await createRuntimeReviewD1Writer(testDb.db).applyDecision('candidate', decision());

    expect(result).toMatchObject({ decision: 'approve_match', candidateMatchStatus: 'merged', idempotentReplay: false });
    expect(testDb.memories.get('candidate')).toMatchObject({ match_status: 'merged', merged_into_memory_id: 'target' });
    expect(testDb.memories.get('target')?.meeting_count).toBe(5);
    expect(testDb.events).toHaveLength(1);
    expect(testDb.events[0]).toMatchObject({ target_meeting_count_before: 3, target_meeting_count_after: 5 });
  });

  it('rejects a current match without changing the target and clears the proposed link', async () => {
    const testDb = makeDb();
    seed(testDb);

    const result = await createRuntimeReviewD1Writer(testDb.db).applyDecision('candidate', decision({ decision: 'reject_match' }));

    expect(result).toMatchObject({ decision: 'reject_match', candidateMatchStatus: 'confirmed' });
    expect(testDb.memories.get('candidate')).toMatchObject({ match_status: 'confirmed', proposed_match_memory_id: null });
    expect(testDb.memories.get('target')?.meeting_count).toBe(3);
    expect(testDb.events).toHaveLength(1);
    expect(testDb.events[0]).toMatchObject({ target_meeting_count_before: 3, target_meeting_count_after: 3 });
  });

  it('replays an identical idempotency key without another transition or audit event', async () => {
    const testDb = makeDb();
    seed(testDb);
    const writer = createRuntimeReviewD1Writer(testDb.db);
    await writer.applyDecision('candidate', decision({ decision: 'reject_match' }));

    const replay = await writer.applyDecision('candidate', decision({ decision: 'reject_match' }));

    expect(replay.idempotentReplay).toBe(true);
    expect(testDb.events).toHaveLength(1);
  });

  it('rejects stale preconditions without an audit event or partial transition', async () => {
    const testDb = makeDb();
    seed(testDb);

    await expect(createRuntimeReviewD1Writer(testDb.db).applyDecision('candidate', decision({ expectedSourceVersion: 'stale' })))
      .rejects.toBeInstanceOf(ReviewDecisionConflictError);
    expect(testDb.events).toHaveLength(0);
    expect(testDb.memories.get('candidate')?.match_status).toBe('pending_review');
  });
});
