import { describe, expect, test } from 'vitest';
import runtime from './index';
import type { Env } from './types';

type Memory = {
  memory_id: string; match_status: 'pending_review' | 'confirmed' | 'merged';
  proposed_match_memory_id: string | null; proposed_match_reason: string | null;
  merged_into_memory_id: string | null; updated_at: string; meeting_count: number;
  first_seen_date: string | null; last_seen_date: string | null;
  first_seen_meeting_id: string | null; last_seen_meeting_id: string | null;
  latest_outcome: string | null; latest_disposition: string | null; latest_executive_scope: string | null;
  review_event_id?: string;
};

function makeDb(race = false) {
  const memories = new Map<string, Memory>();
  const events: Array<Record<string, unknown>> = [];
  let beforeBatch: (() => void) | undefined;
  const db = {
    memories, events,
    setRaceHook(hook: () => void) { beforeBatch = hook; },
    prepare(sql: string) {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) { statement.params = params; return statement; },
        async first<T>() {
          const id = statement.params[0] as string;
          if (sql.includes('topic_memory_review_events')) return events.find(e => e.idempotency_key === id) as T | undefined;
          const memory = memories.get(id);
          if (sql.includes('SELECT updated_at FROM topic_memory')) return memory ? { updated_at: memory.updated_at } as T : undefined;
          return memory as unknown as T | undefined;
        },
        async run() { return { success: true, meta: { changes: 0 } }; },
      };
      return statement;
    },
    async batch(statements: Array<{ params: unknown[]; _sql?: string }>) {
      beforeBatch?.(); beforeBatch = undefined;
      const audit = statements[0];
      const candidateId = audit.params[1] as string;
      const targetId = audit.params[2] as string;
      const expectedVersion = audit.params[4] as string;
      const expectedTarget = audit.params[5] as string;
      const candidate = memories.get(candidateId);
      const target = memories.get(targetId);
      const eligible = candidate?.match_status === 'pending_review' && candidate.updated_at === expectedVersion &&
        candidate.proposed_match_memory_id === expectedTarget && target && target.match_status !== 'merged' &&
        !target.merged_into_memory_id;
      if (!eligible) return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
      const event = {
        review_event_id: audit.params[0], candidate_memory_id: candidateId, target_memory_id: targetId,
        decision: audit.params[3], expected_source_version: expectedVersion,
        expected_proposed_match_memory_id: expectedTarget, reviewer_name: audit.params[6],
        reviewer_note: audit.params[7], warning_acknowledged: 1, idempotency_key: audit.params[8],
        candidate_match_status_after: audit.params[9] === 'merged' ? 'merged' : 'confirmed', created_at: '2026-08-12T16:00:00Z',
      };
      events.push(event);
      if (event.decision === 'approve_match') {
        candidate.match_status = 'merged'; candidate.merged_into_memory_id = targetId; candidate.review_event_id = String(event.review_event_id);
        target.meeting_count += candidate.meeting_count;
      } else {
        candidate.match_status = 'confirmed'; candidate.proposed_match_memory_id = null; candidate.proposed_match_reason = null;
      }
      candidate.updated_at = '2026-08-12T16:00:01Z';
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }, ...(event.decision === 'approve_match' ? [{ meta: { changes: 1 } }] : [])];
    },
  };
  if (race) db.setRaceHook(() => { const m = memories.get('candidate'); if (m) m.updated_at = 'changed-by-race'; });
  return db;
}

function env(db: ReturnType<typeof makeDb>): Env {
  return {
    DB: db as unknown as D1Database,
    OUTPUT_BUCKET: {} as R2Bucket,
    PROCESSING_QUEUE: { send: async () => undefined } as unknown as Queue,
    ENVIRONMENT: 'test', AZURE_OPENAI_ENDPOINT: '', AZURE_OPENAI_DEPLOYMENT: '', AZURE_OPENAI_API_KEY: '',
    SUBMISSION_TOKEN: 'submit-token', REVIEW_DECISION_TOKEN: 'review-token',
  };
}

function request(decision: 'approve_match' | 'reject_match', idempotencyKey = 'review-1') {
  return new Request('http://localhost/v1/topic-memory/candidate/match', {
    method: 'PATCH', headers: { Authorization: 'Bearer review-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, expectedSourceVersion: 'v1', expectedProposedMatchMemoryId: 'target',
      reviewerName: 'Reviewer', note: 'Reviewed against the current queue evidence.', warningAcknowledged: true, idempotencyKey }),
  });
}

function seed(db: ReturnType<typeof makeDb>) {
  db.memories.set('candidate', { memory_id: 'candidate', match_status: 'pending_review', proposed_match_memory_id: 'target', proposed_match_reason: 'same thread', merged_into_memory_id: null, updated_at: 'v1', meeting_count: 2, first_seen_date: '2026-08-01', last_seen_date: '2026-08-10', first_seen_meeting_id: 'm1', last_seen_meeting_id: 'm2', latest_outcome: null, latest_disposition: null, latest_executive_scope: null });
  db.memories.set('target', { memory_id: 'target', match_status: 'confirmed', proposed_match_memory_id: null, proposed_match_reason: null, merged_into_memory_id: null, updated_at: 't1', meeting_count: 3, first_seen_date: '2026-07-01', last_seen_date: '2026-08-05', first_seen_meeting_id: 'm0', last_seen_meeting_id: 'm0', latest_outcome: null, latest_disposition: null, latest_executive_scope: null });
}

describe('topic-memory live review decisions', () => {
  test('approve merges candidate, preserves lineage, aggregates target trajectory, and audits once', async () => {
    const db = makeDb(); seed(db);
    const response = await runtime.fetch(request('approve_match'), env(db));
    expect(response.status).toBe(200);
    expect(db.memories.get('candidate')).toMatchObject({ match_status: 'merged', merged_into_memory_id: 'target' });
    expect(db.memories.get('target')?.meeting_count).toBe(5);
    expect(db.events).toHaveLength(1);
  });

  test('reject confirms candidate without changing target or retaining a proposed link', async () => {
    const db = makeDb(); seed(db);
    const before = db.memories.get('target')?.meeting_count;
    const response = await runtime.fetch(request('reject_match'), env(db));
    expect(response.status).toBe(200);
    expect(db.memories.get('candidate')).toMatchObject({ match_status: 'confirmed', proposed_match_memory_id: null });
    expect(db.memories.get('target')?.meeting_count).toBe(before);
    expect(db.events[0].decision).toBe('reject_match');
  });

  test('replays the same idempotency key without a second audit or transition', async () => {
    const db = makeDb(); seed(db);
    await runtime.fetch(request('reject_match'), env(db));
    const replay = await runtime.fetch(request('reject_match'), env(db));
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { idempotentReplay: boolean }).idempotentReplay).toBe(true);
    expect(db.events).toHaveLength(1);
  });

  test('rejects stale source version and target mismatch without writes', async () => {
    const db = makeDb(); seed(db);
    const stale = new Request('http://localhost/v1/topic-memory/candidate/match', { method: 'PATCH', headers: { Authorization: 'Bearer review-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'reject_match', expectedSourceVersion: 'old', expectedProposedMatchMemoryId: 'other', reviewerName: 'Reviewer', note: 'stale', warningAcknowledged: true, idempotencyKey: 'stale-1' }) });
    expect((await runtime.fetch(stale, env(db))).status).toBe(409);
    expect(db.events).toHaveLength(0);
    expect(db.memories.get('candidate')?.match_status).toBe('pending_review');
  });

});
