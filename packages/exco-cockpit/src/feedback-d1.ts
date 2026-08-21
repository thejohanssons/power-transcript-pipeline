// ============================================================
// EIP ExCo Cockpit — Dedicated Feedback D1 Adapter (APPEND-ONLY)
//
// This adapter is intentionally bound only to FEEDBACK_DB. It never receives
// or accesses the runtime source database. Feedback corrections are new rows
// referencing a prior feedback ID; no UPDATE or DELETE operation exists.
// ============================================================

import type { FeedbackSubmission, FeedbackRow } from './types';

export interface FeedbackD1Reader {
  insertFeedback(submission: FeedbackSubmission): Promise<string>;
  listFeedback(limit?: number): Promise<FeedbackRow[]>;
  listFeedbackForItem(itemType: FeedbackSubmission['itemType'], itemId: string): Promise<FeedbackRow[]>;
  exportAll(): Promise<FeedbackRow[]>;
}

const SELECT_FIELDS = `feedback_id, item_type, item_id, source_kind, source_version,
  reviewer_name, verdict, affected_field, note, warning_acknowledged,
  corrects_feedback_id, source_location, created_at`;

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required.`);
}

export function createFeedbackD1Reader(db: D1Database): FeedbackD1Reader {
  async function all<T>(sql: string, ...parameters: unknown[]): Promise<T[]> {
    const statement = parameters.length > 0 ? db.prepare(sql).bind(...parameters) : db.prepare(sql);
    const result = await statement.all<T>();
    return result.results;
  }

  return {
    async insertFeedback(submission) {
      assertNonEmpty(submission.feedbackId, 'feedbackId');
      assertNonEmpty(submission.itemId, 'itemId');
      assertNonEmpty(submission.sourceVersion, 'sourceVersion');
      assertNonEmpty(submission.reviewerName, 'reviewerName');
      assertNonEmpty(submission.affectedField, 'affectedField');
      assertNonEmpty(submission.note, 'note');
      if (!submission.warningAcknowledged) {
        throw new Error('warningAcknowledged must be true.');
      }

      await db.prepare(`INSERT INTO feedback (
        feedback_id, item_type, item_id, source_kind, source_version,
        reviewer_name, verdict, affected_field, note, warning_acknowledged,
        corrects_feedback_id, source_location
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          submission.feedbackId,
          submission.itemType,
          submission.itemId,
          submission.sourceKind,
          submission.sourceVersion,
          submission.reviewerName.trim(),
          submission.verdict,
          submission.affectedField.trim(),
          submission.note.trim(),
          1,
          submission.correctsFeedbackId,
          submission.sourceLocation,
        )
        .run();

      return submission.feedbackId;
    },

    async listFeedback(limit = 200) {
      return all<FeedbackRow>(`SELECT ${SELECT_FIELDS} FROM feedback
        ORDER BY created_at DESC, feedback_id DESC LIMIT ?`, limit);
    },

    async listFeedbackForItem(itemType, itemId) {
      return all<FeedbackRow>(`SELECT ${SELECT_FIELDS} FROM feedback
        WHERE item_type = ? AND item_id = ?
        ORDER BY created_at DESC, feedback_id DESC`, itemType, itemId);
    },

    async exportAll() {
      return all<FeedbackRow>(`SELECT ${SELECT_FIELDS} FROM feedback
        ORDER BY created_at ASC, feedback_id ASC`);
    },
  };
}
