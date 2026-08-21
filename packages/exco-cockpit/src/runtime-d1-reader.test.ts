import { describe, expect, it } from 'vitest';
import { createRuntimeD1Reader } from './runtime-d1-reader';
import { createFeedbackD1Reader } from './feedback-d1';
import { routeRuntimeApiRequest } from './runtime-api';

const meetings = [{ meeting_id: 'meeting-1', subject: 'Live ExCo', organiser: 'Executive Office', event_date: '2026-08-18T09:00:00Z' }];
const topics = [{
  topic_id: 'topic-1', meeting_id: 'meeting-1', domain: 'Product', entity_type: 'Product', entity: 'SuperPen',
  aspect: 'Schedule', outcome: 'Risk', disposition: 'Action', executive_scope: 'Strategic',
  topic_statement: 'SuperPen launch timing is at risk.', summary: null,
  key_facts_json: '[{"id":"fact-1","text":"Supplier sign-off is pending."}]',
  decisions_json: '[]', actions_json: '[]', risks_json: '[{"id":"risk-1","text":"Launch may slip."}]',
  owners_json: '["COO"]', confidence: 'high', validation_status: 'warning',
  validation_reasons_json: '["Owner has not been confirmed."]',
}];
const actions = [{ action_id: 'action-1', meeting_id: 'meeting-1', topic_id: 'topic-1', owner: null, text: 'Confirm supplier sign-off.', due_date: null, status: 'open' }];
const decisions = [{ decision_id: 'decision-1', meeting_id: 'meeting-1', topic_id: 'topic-1', owner: 'CEO', text: 'Keep the launch date under review.' }];
const memory = [{
  memory_id: 'memory-1', domain: 'Product', entity_type: 'Product', entity: 'SuperPen', aspect: 'Schedule',
  canonical_statement: 'SuperPen launch timing is at risk.', first_seen_meeting_id: 'meeting-1', last_seen_meeting_id: 'meeting-1',
  first_seen_date: '2026-08-18', last_seen_date: '2026-08-18', meeting_count: 1, latest_outcome: 'Risk',
  latest_disposition: 'Action', latest_executive_scope: 'Strategic', match_status: 'pending_review',
  proposed_match_memory_id: null, proposed_match_reason: null, merged_into_memory_id: null,
  review_resolved_at: null, review_event_id: null, status: 'open', updated_at: '2026-08-18T10:00:00Z',
}, {
  memory_id: 'memory-merged', domain: 'Product', entity_type: 'Product', entity: 'SuperPen', aspect: 'Schedule',
  canonical_statement: 'Earlier SuperPen launch timing observation.', first_seen_meeting_id: 'meeting-1', last_seen_meeting_id: 'meeting-1',
  first_seen_date: '2026-08-17', last_seen_date: '2026-08-17', meeting_count: 1, latest_outcome: 'Risk',
  latest_disposition: 'Action', latest_executive_scope: 'Strategic', match_status: 'merged',
  proposed_match_memory_id: 'memory-1', proposed_match_reason: null, merged_into_memory_id: 'memory-1',
  review_resolved_at: '2026-08-18T10:00:00Z', review_event_id: 'review-1', status: 'closed', updated_at: '2026-08-18T10:00:00Z',
}];
const reviewEvents = [{
  review_event_id: 'review-1', candidate_memory_id: 'memory-merged', target_memory_id: 'memory-1',
  decision: 'approve_match', reviewer_name: 'Executive Reviewer', reviewer_note: 'Same operating trajectory.',
  candidate_match_status_after: 'merged', created_at: '2026-08-18T10:00:00Z',
}];

function mockDb(): { db: D1Database; sql: string[] } {
  const sql: string[] = [];
  const db = {
    prepare(query: string) {
      sql.push(query);
      let parameters: unknown[] = [];
      const rows = () => query.includes('FROM meetings') ? meetings
        : query.includes('FROM topics') ? topics
        : query.includes('FROM actions') ? actions
        : query.includes('FROM decisions') ? decisions
        : query.includes('FROM topic_memory_review_events') ? reviewEvents
        : query.includes('FROM topic_memory') && query.includes('WHERE memory_id = ?')
          ? memory.filter(row => row.memory_id === parameters[0])
          : query.includes('FROM topic_memory') ? memory
          : [];
      return {
        bind(...values: unknown[]) { parameters = values; return this; },
        async all() { return { results: rows(), success: true, meta: {} }; },
      };
    },
  } as unknown as D1Database;
  return { db, sql };
}

function mockFeedbackDb(): D1Database {
  return {
    prepare() {
      return {
        bind() { return this; },
        async all() { return { results: [], success: true, meta: {} }; },
        async run() { return { success: true, meta: {} }; },
      };
    },
  } as unknown as D1Database;
}

async function call(reader: ReturnType<typeof createRuntimeD1Reader>, path: string, method = 'GET') {
  const request = new Request(`https://cockpit.example${path}`, { method });
  const response = await routeRuntimeApiRequest(request, new URL(request.url), reader, createFeedbackD1Reader(mockFeedbackDb()));
  if (!response) throw new Error('Expected an API response');
  return { status: response.status, headers: response.headers, body: await response.json() };
}

describe('runtime D1 Cockpit reader', () => {
  it('maps a fixed allow-list of live D1 fields into Cockpit DTOs', async () => {
    const { db } = mockDb();
    const reader = createRuntimeD1Reader(db);
    const { status, body } = await call(reader, '/api/v1/topics');
    const topic = (body as { data: typeof topics }).data[0] as unknown as Record<string, unknown>;

    expect(status).toBe(200);
    expect(topic).toMatchObject({ topicId: 'topic-1', entity: 'SuperPen', summary: 'Not extracted' });
    expect(topic).not.toHaveProperty('transcriptSha256');
    expect(topic).not.toHaveProperty('r2OutputKey');
  });

  it('marks live API responses as non-cacheable', async () => {
    const { db } = mockDb();
    const reader = createRuntimeD1Reader(db);
    const response = await call(reader, '/api/v1/overview');

    expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0');
  });

  it('derives risk proxies and enriches actions and decisions without exposing raw rows', async () => {
    const { db } = mockDb();
    const reader = createRuntimeD1Reader(db);
    const risksActions = await call(reader, '/api/v1/risks-actions');
    const decisionsResponse = await call(reader, '/api/v1/decisions');
    const risks = (risksActions.body as { data: { risks: Array<Record<string, unknown>>; actions: Array<Record<string, unknown>> } }).data;
    const decision = (decisionsResponse.body as { data: Array<Record<string, unknown>> }).data[0];

    expect(risks.risks[0]).toMatchObject({ topicId: 'topic-1', riskText: 'Launch may slip.' });
    expect(risks.actions[0]).toMatchObject({ owner: 'Not extracted', dueDate: 'Not extracted', meetingSubject: 'Live ExCo' });
    expect(decision).toMatchObject({ meetingSubject: 'Live ExCo', topicEntity: 'SuperPen' });
  });

  it('only issues SELECT statements and rejects mutation HTTP methods', async () => {
    const { db, sql } = mockDb();
    const reader = createRuntimeD1Reader(db);
    await call(reader, '/api/v1/overview');
    const rejected = await call(reader, '/api/v1/topics', 'POST');

    expect(rejected.status).toBe(405);
    expect(sql).not.toHaveLength(0);
    expect(sql.every(statement => /^\s*SELECT\b/i.test(statement))).toBe(true);
  });

  it('keeps the topic-memory list root-based while merged records remain addressable by ID', async () => {
    const { db } = mockDb();
    const reader = createRuntimeD1Reader(db);
    const list = await call(reader, '/api/v1/topic-memory');
    const merged = await call(reader, '/api/v1/topic-memory/memory-merged');
    const memories = (list.body as { data: Array<Record<string, unknown>> }).data;

    expect(memories.map(item => item.memoryId)).toEqual(['memory-1']);
    expect((merged.body as { data: Record<string, unknown> }).data).toMatchObject({
      memoryId: 'memory-merged', mergedIntoMemoryId: 'memory-1', matchStatus: 'merged',
    });
  });

  it('returns pending review and authoritative runtime-decision audit history', async () => {
    const { db } = mockDb();
    const reader = createRuntimeD1Reader(db);
    const { body } = await call(reader, '/api/v1/review-queue');
    const queue = (body as { data: { awaitingReview: Array<Record<string, unknown>>; recordedDecisions: Array<Record<string, unknown>> } }).data;

    expect(queue.awaitingReview[0]).toMatchObject({ itemId: 'memory-1', sourceKind: 'd1', candidateStatus: 'pending_review' });
    expect(queue.recordedDecisions).toEqual([expect.objectContaining({
      reviewEventId: 'review-1', candidateMemoryId: 'memory-merged', reviewerName: 'Executive Reviewer',
      decision: 'approve_match', candidateMatchStatusAfter: 'merged',
    })]);
  });
});
