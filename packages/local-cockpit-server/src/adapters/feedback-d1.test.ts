// ============================================================
// EIP Local Cockpit Server — Feedback D1 adapter tests (Step 9)
//
// Proves that the adapter:
// 1. Has no update or delete methods
// 2. Rejects feedback without warningAcknowledged
// 3. Rejects feedback without reviewerName
// 4. Rejects feedback without note
// 5. Correctly inserts valid feedback (append-only INSERT)
// 6. Does not call the runtime D1 database
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFeedbackD1Adapter } from './feedback-d1.js';
import type { FeedbackSubmission } from './feedback-d1.js';

const CONFIG = {
  accountId: 'test-account',
  token: 'test-feedback-token',
  databaseId: 'test-feedback-db-id',
};

function makeD1Response(results: unknown[] = []) {
  return {
    success: true,
    errors: [],
    result: [{ results, success: true, meta: { duration: 1, rows_read: 0, rows_written: 1 } }],
  };
}

function mockFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => makeD1Response([]),
    text: async () => '',
  });
}

const VALID_SUBMISSION: FeedbackSubmission = {
  feedbackId: 'test-uuid-001',
  itemType: 'topic',
  itemId: 'topic-123',
  sourceKind: 'd1',
  sourceVersion: '2026-08-11T10:00:00',
  reviewerName: 'Alice',
  verdict: 'incomplete',
  affectedField: 'summary',
  note: 'The summary misses the key risk discussed.',
  warningAcknowledged: true,
  correctsFeedbackId: null,
  sourceLocation: null,
};

// ── Immutability: no update/delete methods ─────────────────

describe('FeedbackD1Adapter — immutability contract', () => {
  it('has no update method', () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    expect((adapter as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).updateFeedback).toBeUndefined();
  });

  it('has no delete method', () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    expect((adapter as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).deleteFeedback).toBeUndefined();
  });

  it('exposes only the expected methods', () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    const keys = Object.keys(adapter).sort();
    expect(keys).toEqual([
      'exportAll',
      'insertFeedback',
      'listFeedback',
      'listFeedbackForItem',
      'listFeedbackForReviewQueue',
    ].sort());
  });
});

// ── Required field validation ──────────────────────────────

describe('FeedbackD1Adapter — required field validation', () => {
  beforeEach(() => vi.stubGlobal('fetch', mockFetch()));

  it('rejects when warningAcknowledged is false', async () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    await expect(adapter.insertFeedback({ ...VALID_SUBMISSION, warningAcknowledged: false }))
      .rejects.toThrow('warningAcknowledged must be true');
  });

  it('rejects when reviewerName is empty', async () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    await expect(adapter.insertFeedback({ ...VALID_SUBMISSION, reviewerName: '' }))
      .rejects.toThrow('reviewerName is required');
  });

  it('rejects when reviewerName is whitespace only', async () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    await expect(adapter.insertFeedback({ ...VALID_SUBMISSION, reviewerName: '   ' }))
      .rejects.toThrow('reviewerName is required');
  });

  it('rejects when note is empty', async () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    await expect(adapter.insertFeedback({ ...VALID_SUBMISSION, note: '' }))
      .rejects.toThrow('note is required');
  });

  it('rejects when note is whitespace only', async () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    await expect(adapter.insertFeedback({ ...VALID_SUBMISSION, note: '   ' }))
      .rejects.toThrow('note is required');
  });
});

// ── Successful insert ──────────────────────────────────────

describe('FeedbackD1Adapter — insertFeedback', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = mockFetch();
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('returns the feedback ID on success', async () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    const id = await adapter.insertFeedback(VALID_SUBMISSION);
    expect(id).toBe('test-uuid-001');
  });

  it('calls the feedback database URL (not runtime DB)', async () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    await adapter.insertFeedback(VALID_SUBMISSION);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain(CONFIG.databaseId);
    expect(url).not.toContain('953bd671'); // must not touch runtime DB
  });

  it('uses INSERT statement', async () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    await adapter.insertFeedback(VALID_SUBMISSION);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.sql.trim().toUpperCase()).toMatch(/^INSERT/);
  });

  it('persists warning_acknowledged as 1', async () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    await adapter.insertFeedback(VALID_SUBMISSION);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    const params: unknown[] = body.params;
    // warning_acknowledged is the 10th param (index 9)
    expect(params[9]).toBe(1);
  });

  it('allows corrections referencing a prior feedback ID', async () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    const id = await adapter.insertFeedback({
      ...VALID_SUBMISSION,
      feedbackId: 'test-uuid-002',
      correctsFeedbackId: 'test-uuid-001',
    });
    expect(id).toBe('test-uuid-002');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    const params: unknown[] = body.params;
    // corrects_feedback_id is the 11th param (index 10)
    expect(params[10]).toBe('test-uuid-001');
  });

  it('does not call runtime D1 at all', async () => {
    const adapter = createFeedbackD1Adapter(CONFIG);
    await adapter.insertFeedback(VALID_SUBMISSION);
    for (const call of fetchSpy.mock.calls) {
      expect(call[0]).not.toContain('953bd671-7f96-450c-96da-736ecbfdf19d');
    }
  });
});

// ── Read methods use SELECT ────────────────────────────────

describe('FeedbackD1Adapter — read methods', () => {
  beforeEach(() => vi.stubGlobal('fetch', mockFetch()));

  it('listFeedback uses SELECT', async () => {
    const fetchSpy = mockFetch();
    vi.stubGlobal('fetch', fetchSpy);
    await createFeedbackD1Adapter(CONFIG).listFeedback();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.sql.trim().toUpperCase()).toMatch(/^SELECT/);
  });

  it('listFeedbackForItem uses SELECT with item filters', async () => {
    const fetchSpy = mockFetch();
    vi.stubGlobal('fetch', fetchSpy);
    await createFeedbackD1Adapter(CONFIG).listFeedbackForItem('topic', 'topic-123');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.sql.trim().toUpperCase()).toMatch(/^SELECT/);
    expect(body.params).toContain('topic');
    expect(body.params).toContain('topic-123');
  });

  it('listFeedbackForReviewQueue returns only queue-relevant fields', async () => {
    const fetchSpy = mockFetch();
    vi.stubGlobal('fetch', fetchSpy);
    await createFeedbackD1Adapter(CONFIG).listFeedbackForReviewQueue();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.sql.toUpperCase()).not.toContain('NOTE');
  });

  it('listFeedbackForReviewQueue uses a fixed scoped SELECT', async () => {
    const fetchSpy = mockFetch();
    vi.stubGlobal('fetch', fetchSpy);
    await createFeedbackD1Adapter(CONFIG).listFeedbackForReviewQueue();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.sql.trim().toUpperCase()).toMatch(/^SELECT/);
    expect(body.sql.toUpperCase()).toContain("ITEM_TYPE = 'MEMORY'");
    expect(body.sql.toUpperCase()).toContain("SOURCE_KIND = 'D1'");
    expect(body.sql.toUpperCase()).toContain('ORDER BY CREATED_AT DESC, FEEDBACK_ID DESC');
    expect(body.sql.toUpperCase()).not.toContain('NOTE');
  });

  it('exportAll uses SELECT ordered by created_at ASC', async () => {
    const fetchSpy = mockFetch();
    vi.stubGlobal('fetch', fetchSpy);
    await createFeedbackD1Adapter(CONFIG).exportAll();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.sql.toUpperCase()).toContain('ORDER BY CREATED_AT ASC');
  });
});
