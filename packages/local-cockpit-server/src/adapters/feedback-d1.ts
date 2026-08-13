// ============================================================
// EIP Local Cockpit Server — Feedback D1 Adapter (APPEND-ONLY)
//
// Writes quality annotations to a dedicated isolated D1 database.
// No update or delete operations are implemented.
// Corrections are new records that reference a prior feedback ID.
// The runtime D1 is never touched by this adapter.
// ============================================================

import type { FeedbackRow } from '../types/db-rows.js';
import type { ReviewQueueFeedbackRow } from '../review-queue.js';

export interface FeedbackD1Config {
  accountId: string;
  token: string;       // Token scoped only to the feedback D1
  databaseId: string;
}

export interface FeedbackSubmission {
  feedbackId: string;          // caller-generated UUID
  itemType: string;            // 'meeting' | 'topic' | 'action' | 'decision' | 'memory'
  itemId: string;
  sourceKind: string;          // 'd1' (only D1 records are reviewed in this POC)
  sourceVersion: string;       // required — updated_at timestamp of the reviewed D1 record
  reviewerName: string;        // explicit display name required
  verdict: 'accurate' | 'incomplete' | 'incorrect' | 'irrelevant';
  affectedField: string;
  note: string;                // free text — retained indefinitely
  warningAcknowledged: boolean; // must be true
  correctsFeedbackId: string | null;  // references prior feedback for corrections
  sourceLocation: string | null;
}

export interface FeedbackD1Adapter {
  /** Insert a new feedback record. Returns the inserted ID. */
  insertFeedback(submission: FeedbackSubmission): Promise<string>;
  /** List all feedback records, newest first. */
  listFeedback(limit?: number, offset?: number): Promise<FeedbackRow[]>;
  /** List feedback for a specific item. */
  listFeedbackForItem(itemType: string, itemId: string): Promise<FeedbackRow[]>;
  /** List only fields needed to compose the current review queue. */
  listFeedbackForReviewQueue(): Promise<ReviewQueueFeedbackRow[]>;
  /** Export all feedback as a JSON array. */
  exportAll(): Promise<FeedbackRow[]>;
}

// ── Cloudflare D1 HTTP API ─────────────────────────────────

interface D1QueryResult<T> {
  results: T[];
  success: boolean;
  meta: { duration: number; rows_read: number; rows_written: number };
}
interface D1Response<T> {
  result: D1QueryResult<T>[];
  success: boolean;
  errors: Array<{ message: string }>;
}

// ── Implementation ─────────────────────────────────────────

export function createFeedbackD1Adapter(config: FeedbackD1Config): FeedbackD1Adapter {
  const { accountId, token, databaseId } = config;
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  async function query<T>(sql: string, params: (string | number | null | boolean)[] = []): Promise<T[]> {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '<unreadable>');
      throw new Error(`[feedback-d1] HTTP ${res.status} from D1 API: ${text}`);
    }

    const data = await res.json() as D1Response<T>;
    if (!data.success) {
      const msg = data.errors?.map(e => e.message).join('; ') ?? 'Unknown D1 error';
      throw new Error(`[feedback-d1] D1 query failed: ${msg}`);
    }

    return data.result[0]?.results ?? [];
  }

  return {
    async insertFeedback(sub) {
      if (!sub.warningAcknowledged) {
        throw new Error('[feedback-d1] Feedback rejected: warningAcknowledged must be true.');
      }
      if (!sub.reviewerName.trim()) {
        throw new Error('[feedback-d1] Feedback rejected: reviewerName is required.');
      }
      if (!sub.note.trim()) {
        throw new Error('[feedback-d1] Feedback rejected: note is required.');
      }

      await query(
        `INSERT INTO feedback (
          feedback_id, item_type, item_id, source_kind, source_version,
          reviewer_name, verdict, affected_field, note, warning_acknowledged,
          corrects_feedback_id, source_location, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          sub.feedbackId,
          sub.itemType,
          sub.itemId,
          sub.sourceKind,
          sub.sourceVersion,
          sub.reviewerName.trim(),
          sub.verdict,
          sub.affectedField,
          sub.note.trim(),
          sub.warningAcknowledged ? 1 : 0,
          sub.correctsFeedbackId,
          sub.sourceLocation,
        ]
      );

      return sub.feedbackId;
    },

    async listFeedback(limit = 200, offset = 0) {
      return query<FeedbackRow>(
        `SELECT feedback_id, item_type, item_id, source_kind, source_version,
                reviewer_name, verdict, affected_field, note, warning_acknowledged,
                corrects_feedback_id, source_location, created_at
         FROM feedback
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    },

    async listFeedbackForItem(itemType, itemId) {
      return query<FeedbackRow>(
        `SELECT feedback_id, item_type, item_id, source_kind, source_version,
                reviewer_name, verdict, affected_field, note, warning_acknowledged,
                corrects_feedback_id, source_location, created_at
         FROM feedback
         WHERE item_type = ? AND item_id = ?
         ORDER BY created_at DESC`,
        [itemType, itemId]
      );
    },

    async listFeedbackForReviewQueue() {
      return query<ReviewQueueFeedbackRow>(
        `SELECT feedback_id, item_type, item_id, source_kind, source_version,
                reviewer_name, verdict, affected_field, corrects_feedback_id, created_at
         FROM feedback
         WHERE item_type = 'memory' AND source_kind = 'd1'
         ORDER BY created_at DESC, feedback_id DESC`
      );
    },

    async exportAll() {
      return query<FeedbackRow>(
        `SELECT feedback_id, item_type, item_id, source_kind, source_version,
                reviewer_name, verdict, affected_field, note, warning_acknowledged,
                corrects_feedback_id, source_location, created_at
         FROM feedback
         ORDER BY created_at ASC`
      );
    },
  };
}
