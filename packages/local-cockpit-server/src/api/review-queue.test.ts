import { describe, expect, it, vi } from 'vitest';
import { createApiRouter } from './index.js';
import type { RuntimeD1Adapter } from '../adapters/runtime-d1.js';
import type { FeedbackD1Adapter } from '../adapters/feedback-d1.js';

function responseCapture() {
  let body = '';
  let status = 0;
  return {
    response: {
      writeHead(code: number) { status = code; },
      end(value?: string) { body = value ?? ''; },
    } as any,
    read() { return { status, body: JSON.parse(body) }; },
  };
}

function deps() {
  const runtimeReviewClient = { submitTopicMemoryDecision: vi.fn() };
  const runtimeD1 = {
    listTopicMemory: vi.fn().mockResolvedValue([{
      memory_id: 'memory-1', domain: 'Product', entity_type: 'initiative', entity: 'Alpha', aspect: 'delivery',
      canonical_statement: 'Alpha delivery is at risk', first_seen_meeting_id: null, last_seen_meeting_id: null,
      first_seen_date: null, last_seen_date: null, meeting_count: 1, latest_outcome: null, latest_disposition: null,
      latest_executive_scope: null, match_status: 'pending_review', proposed_match_memory_id: null,
      proposed_match_reason: null, status: 'active', created_at: '2026-08-01', updated_at: '2026-08-10',
    }]),
  } as unknown as RuntimeD1Adapter;
  const feedbackD1 = {
    listFeedbackForReviewQueue: vi.fn().mockResolvedValue([]),
  } as unknown as FeedbackD1Adapter;
  return { runtimeD1, feedbackD1, runtimeReviewClient };
}

describe('GET /api/v1/review-queue', () => {
  it('composes two sections from fixed read methods without forbidden fields', async () => {
    const dependencies = deps();
    const router = createApiRouter(dependencies);
    const capture = responseCapture();
    await router({ method: 'GET' } as any, capture.response, new URL('http://localhost/api/v1/review-queue'), undefined);
    const result = capture.read();

    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ awaitingReview: expect.any(Array), recordedDecisions: expect.any(Array) });
    expect(result.body.data.awaitingReview[0]).not.toHaveProperty('r2OutputKey');
    expect(JSON.stringify(result.body)).not.toMatch(/r2|transcript|credential|storage/i);
    expect(dependencies.runtimeD1.listTopicMemory).toHaveBeenCalledOnce();
    expect(dependencies.feedbackD1.listFeedbackForReviewQueue).toHaveBeenCalledOnce();
    expect((dependencies.runtimeD1 as any).insert).toBeUndefined();
    expect((dependencies.feedbackD1 as any).insertFeedback).toBeUndefined();
  });

  it('does not expose recorded decisions until an exact current version matches', async () => {
    const dependencies = deps();
    (dependencies.feedbackD1.listFeedbackForReviewQueue as any).mockResolvedValue([{
      feedback_id: 'feedback-1', item_type: 'memory', item_id: 'memory-1', source_kind: 'd1',
      source_version: 'old-version', reviewer_name: 'Reviewer', verdict: 'accurate', affected_field: 'overall',
      corrects_feedback_id: null, created_at: '2026-08-11',
    }]);
    const router = createApiRouter(dependencies);
    const capture = responseCapture();
    await router({ method: 'GET' } as any, capture.response, new URL('http://localhost/api/v1/review-queue'), undefined);
    const result = capture.read();
    expect(result.body.data.awaitingReview).toHaveLength(1);
    expect(result.body.data.recordedDecisions).toHaveLength(0);
  });
});
