import { describe, expect, it } from 'vitest';
import { createFeedbackD1Reader } from './feedback-d1';
import { routeRuntimeApiRequest } from './runtime-api';
import { createRuntimeD1Reader } from './runtime-d1-reader';

function runtimeDb(): D1Database {
  return {
    prepare() {
      return {
        bind() { return this; },
        async all() { return { results: [], success: true, meta: {} }; },
      };
    },
  } as unknown as D1Database;
}

function feedbackDb() {
  const sql: string[] = [];
  const bound: unknown[][] = [];
  const rows = [{
    feedback_id: 'feedback-1', item_type: 'topic', item_id: 'topic-1', source_kind: 'd1',
    source_version: '2026-08-19T08:00:00Z', reviewer_name: 'Executive Reviewer',
    verdict: 'incomplete', affected_field: 'Summary', note: 'Add the unresolved dependency.',
    warning_acknowledged: 1, corrects_feedback_id: null, source_location: 'topic-1',
    created_at: '2026-08-19T08:01:00Z',
  }];
  const db = {
    prepare(query: string) {
      sql.push(query);
      let parameters: unknown[] = [];
      return {
        bind(...values: unknown[]) { parameters = values; bound.push(values); return this; },
        async all() { return { results: rows, success: true, meta: {} }; },
        async run() { return { success: true, meta: { changes: 1 } }; },
        parameters: () => parameters,
      };
    },
  } as unknown as D1Database;
  return { db, sql, bound };
}

async function call(feedback: ReturnType<typeof createFeedbackD1Reader>, path: string, init?: RequestInit) {
  const request = new Request(`https://cockpit.example${path}`, init);
  const response = await routeRuntimeApiRequest(
    request,
    new URL(request.url),
    createRuntimeD1Reader(runtimeDb()),
    feedback,
  );
  if (!response) throw new Error('Expected an API response');
  return { response, body: await response.json() };
}

describe('dedicated feedback D1 API', () => {
  it('inserts an acknowledged feedback record only into the feedback binding', async () => {
    const { db, sql, bound } = feedbackDb();
    const { response, body } = await call(createFeedbackD1Reader(db), '/api/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemType: 'topic', itemId: 'topic-1', sourceKind: 'd1', sourceVersion: '2026-08-19T08:00:00Z',
        reviewerName: ' Executive Reviewer ', verdict: 'incomplete', affectedField: 'Summary',
        note: ' Add the unresolved dependency. ', warningAcknowledged: true,
        correctsFeedbackId: null, sourceLocation: 'topic-1',
      }),
    });

    expect(response.status).toBe(201);
    expect((body as { data: { created: boolean; feedbackId: string } }).data).toMatchObject({ created: true });
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/^INSERT INTO feedback/i);
    expect(sql[0]).not.toMatch(/\b(UPDATE|DELETE)\b/i);
    expect(bound[0]).toEqual(expect.arrayContaining(['Executive Reviewer', 'Add the unresolved dependency.', 1]));
  });

  it('rejects missing provenance and acknowledgement without writing feedback', async () => {
    const { db, sql } = feedbackDb();
    const { response, body } = await call(createFeedbackD1Reader(db), '/api/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemType: 'topic', itemId: 'topic-1', sourceKind: 'd1', sourceVersion: '',
        reviewerName: 'Executive Reviewer', verdict: 'accurate', affectedField: 'Summary',
        note: 'Looks correct.', warningAcknowledged: false,
      }),
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: expect.stringContaining('warningAcknowledged') });
    expect(sql).toHaveLength(0);
  });

  it('returns item history in an API envelope and exports an attachment payload', async () => {
    const { db, sql, bound } = feedbackDb();
    const feedback = createFeedbackD1Reader(db);
    const history = await call(feedback, '/api/v1/feedback/item/topic/topic-1');
    const exported = await call(feedback, '/api/v1/feedback/export');

    expect(history.response.status).toBe(200);
    expect(history.body).toMatchObject({ apiVersion: 'v1', data: [expect.objectContaining({ feedback_id: 'feedback-1' })] });
    expect(exported.response.headers.get('Content-Disposition')).toContain('attachment; filename="feedback-export-');
    expect(exported.body).toEqual([expect.objectContaining({ feedback_id: 'feedback-1' })]);
    expect(sql.every(statement => /^\s*SELECT\b/i.test(statement))).toBe(true);
    expect(bound).toEqual([['topic', 'topic-1']]);
  });

  it('does not permit feedback mutations other than POST', async () => {
    const { db } = feedbackDb();
    const { response } = await call(createFeedbackD1Reader(db), '/api/v1/feedback', { method: 'DELETE' });

    expect(response.status).toBe(405);
  });
});
