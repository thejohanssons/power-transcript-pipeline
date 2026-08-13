import { describe, expect, it } from 'vitest';
import { composeReviewQueue, type ReviewQueueFeedbackRow } from './review-queue.js';
import type { TopicMemoryRow } from './types/db-rows.js';

function memory(overrides: Partial<TopicMemoryRow> = {}): TopicMemoryRow {
  return {
    memory_id: 'memory-1', domain: 'Product', entity_type: 'initiative', entity: 'Alpha', aspect: 'delivery',
    canonical_statement: 'Alpha delivery is at risk', first_seen_meeting_id: 'meeting-1', last_seen_meeting_id: 'meeting-1',
    first_seen_date: '2026-08-01', last_seen_date: '2026-08-10', meeting_count: 2, latest_outcome: 'At risk',
    latest_disposition: 'Risk', latest_executive_scope: 'ExCo', match_status: 'pending_review',
    proposed_match_memory_id: 'memory-existing', proposed_match_reason: 'Same entity and aspect', status: 'active',
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-10T10:00:00Z', ...overrides,
  };
}

function feedback(overrides: Partial<ReviewQueueFeedbackRow> = {}): ReviewQueueFeedbackRow {
  return {
    feedback_id: 'feedback-1', item_type: 'memory', item_id: 'memory-1', source_kind: 'd1',
    source_version: '2026-08-10T10:00:00Z', reviewer_name: 'Reviewer', verdict: 'accurate',
    affected_field: 'overall', corrects_feedback_id: null, created_at: '2026-08-11T10:00:00Z', ...overrides,
  };
}

describe('composeReviewQueue', () => {
  it('places a pending candidate without feedback in awaitingReview', () => {
    const result = composeReviewQueue([memory()], [], 'generated');
    expect(result.awaitingReview).toHaveLength(1);
    expect(result.awaitingReview[0].disposition).toBeNull();
    expect(result.recordedDecisions).toHaveLength(0);
  });

  it('requires the exact four-part identity and records the newest exact match', () => {
    const result = composeReviewQueue([memory()], [feedback()], 'generated');
    expect(result.recordedDecisions[0].disposition?.feedbackId).toBe('feedback-1');
  });

  it('reopens a changed source version', () => {
    const result = composeReviewQueue([memory({ updated_at: '2026-08-12T10:00:00Z' })], [feedback()], 'generated');
    expect(result.awaitingReview).toHaveLength(1);
    expect(result.recordedDecisions).toHaveLength(0);
  });

  it('ignores other item, type, and source identities', () => {
    const result = composeReviewQueue([memory()], [
      feedback({ item_id: 'other' }), feedback({ item_type: 'topic' }), feedback({ source_kind: 'r2' }),
    ], 'generated');
    expect(result.awaitingReview).toHaveLength(1);
  });

  it('chooses later created_at and feedback_id for ties', () => {
    const result = composeReviewQueue([memory()], [
      feedback({ feedback_id: 'a', created_at: '2026-08-11T10:00:00Z', verdict: 'incomplete' }),
      feedback({ feedback_id: 'b', created_at: '2026-08-12T10:00:00Z', verdict: 'incorrect' }),
      feedback({ feedback_id: 'c', created_at: '2026-08-12T10:00:00Z', verdict: 'irrelevant' }),
    ], 'generated');
    expect(result.recordedDecisions[0].disposition).toMatchObject({ feedbackId: 'c', verdict: 'irrelevant' });
  });

  it('allows a correction row to be the displayed disposition', () => {
    const result = composeReviewQueue([memory()], [feedback({ feedback_id: 'correction', corrects_feedback_id: 'feedback-1' })], 'generated');
    expect(result.recordedDecisions[0].disposition?.correctsFeedbackId).toBe('feedback-1');
  });

  it('excludes confirmed and rejected memories regardless of feedback', () => {
    const rows = [memory({ memory_id: 'confirmed', match_status: 'confirmed' }), memory({ memory_id: 'rejected', match_status: 'rejected' })];
    const result = composeReviewQueue(rows, [feedback({ item_id: 'confirmed' }), feedback({ item_id: 'rejected' })], 'generated');
    expect(result.awaitingReview).toHaveLength(0);
    expect(result.recordedDecisions).toHaveLength(0);
  });

  it('never creates candidates from unsupported feedback types and sorts output stably', () => {
    const result = composeReviewQueue([
      memory({ memory_id: 'z', updated_at: '2026-08-10T10:00:00Z' }),
      memory({ memory_id: 'a', updated_at: '2026-08-10T10:00:00Z' }),
    ], [feedback({ item_type: 'topic', item_id: 'new-item' })], 'generated');
    expect(result.awaitingReview.map(item => item.itemId)).toEqual(['a', 'z']);
  });
});
