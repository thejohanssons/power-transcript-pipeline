// ============================================================
// EIP ExCo Cockpit — guarded Topic Memory review commands
//
// This is the sole runtime mutation adapter. It only commits an approved or
// rejected pending-match decision through the runtime D1 audit/guard schema.
// ============================================================

import type {
  TopicMemoryReviewDecisionRequest,
  TopicMemoryReviewDecisionResponse,
} from './types';

interface ReviewMemoryRow {
  memory_id: string;
  first_seen_meeting_id: string | null;
  last_seen_meeting_id: string | null;
  first_seen_date: string | null;
  last_seen_date: string | null;
  meeting_count: number;
  latest_outcome: string | null;
  latest_disposition: string | null;
  latest_executive_scope: string | null;
  match_status: string;
  proposed_match_memory_id: string | null;
  merged_into_memory_id: string | null;
  updated_at: string;
}

interface ReviewEventRow {
  review_event_id: string;
  candidate_memory_id: string;
  target_memory_id: string;
  decision: 'approve_match' | 'reject_match';
  expected_source_version: string;
  expected_proposed_match_memory_id: string;
  reviewer_name: string;
  reviewer_note: string;
  warning_acknowledged: number;
  candidate_match_status_after: 'merged' | 'confirmed';
  created_at: string;
}

type D1ResultLike = { meta?: { changes?: number } };

export interface RuntimeReviewD1Writer {
  applyDecision(candidateMemoryId: string, decision: TopicMemoryReviewDecisionRequest): Promise<TopicMemoryReviewDecisionResponse>;
}

export class ReviewDecisionConflictError extends Error {}
export class ReviewDecisionNotFoundError extends Error {}

export function isSafeReviewIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

export function createRuntimeReviewD1Writer(db: D1Database): RuntimeReviewD1Writer {
  async function first<T>(sql: string, ...parameters: unknown[]): Promise<T | null> {
    const statement = parameters.length > 0 ? db.prepare(sql).bind(...parameters) : db.prepare(sql);
    return (await statement.first<T>()) ?? null;
  }

  return {
    async applyDecision(candidateMemoryId, decision) {
      const existingEvent = await first<ReviewEventRow>(`SELECT review_event_id, candidate_memory_id, target_memory_id,
          decision, expected_source_version, expected_proposed_match_memory_id, reviewer_name, reviewer_note,
          warning_acknowledged, candidate_match_status_after, created_at
        FROM topic_memory_review_events WHERE idempotency_key = ?`, decision.idempotencyKey);

      if (existingEvent) {
        const samePayload = existingEvent.candidate_memory_id === candidateMemoryId &&
          existingEvent.decision === decision.decision &&
          existingEvent.expected_source_version === decision.expectedSourceVersion &&
          existingEvent.expected_proposed_match_memory_id === decision.expectedProposedMatchMemoryId &&
          existingEvent.reviewer_name === decision.reviewerName &&
          existingEvent.reviewer_note === decision.note &&
          existingEvent.warning_acknowledged === 1;
        if (!samePayload) throw new ReviewDecisionConflictError('Idempotency key was already used for a different decision.');

        const candidate = await first<Pick<ReviewMemoryRow, 'updated_at'>>(
          'SELECT updated_at FROM topic_memory WHERE memory_id = ?', candidateMemoryId,
        );
        const target = await first<Pick<ReviewMemoryRow, 'updated_at'>>(
          'SELECT updated_at FROM topic_memory WHERE memory_id = ?', existingEvent.target_memory_id,
        );
        return {
          decision: existingEvent.decision,
          candidateMemoryId,
          candidateMatchStatus: existingEvent.candidate_match_status_after,
          targetMemoryId: existingEvent.target_memory_id,
          candidateUpdatedAt: candidate?.updated_at ?? existingEvent.created_at,
          targetUpdatedAt: existingEvent.decision === 'approve_match' ? target?.updated_at ?? null : null,
          auditEventId: existingEvent.review_event_id,
          appliedAt: existingEvent.created_at,
          idempotentReplay: true,
        };
      }

      const candidate = await first<ReviewMemoryRow>(`SELECT memory_id, first_seen_meeting_id, last_seen_meeting_id,
          first_seen_date, last_seen_date, meeting_count, latest_outcome, latest_disposition,
          latest_executive_scope, match_status, proposed_match_memory_id, merged_into_memory_id, updated_at
        FROM topic_memory WHERE memory_id = ?`, candidateMemoryId);
      if (!candidate) throw new ReviewDecisionNotFoundError('Candidate Topic Memory was not found.');
      if (candidate.match_status !== 'pending_review' || candidate.merged_into_memory_id) {
        throw new ReviewDecisionConflictError('Candidate is no longer pending review.');
      }

      const targetId = candidate.proposed_match_memory_id;
      if (!targetId || targetId === candidateMemoryId || targetId !== decision.expectedProposedMatchMemoryId || !isSafeReviewIdentifier(targetId)) {
        throw new ReviewDecisionConflictError('Candidate proposed target is no longer eligible.');
      }
      if (candidate.updated_at !== decision.expectedSourceVersion) {
        throw new ReviewDecisionConflictError('Candidate source version is stale. Refresh and reassess.');
      }

      const target = await first<ReviewMemoryRow>(`SELECT memory_id, first_seen_meeting_id, last_seen_meeting_id,
          first_seen_date, last_seen_date, meeting_count, latest_outcome, latest_disposition,
          latest_executive_scope, match_status, proposed_match_memory_id, merged_into_memory_id, updated_at
        FROM topic_memory WHERE memory_id = ?`, targetId);
      if (!target || target.match_status === 'merged' || target.merged_into_memory_id) {
        throw new ReviewDecisionConflictError('Proposed target is missing or no longer eligible.');
      }

      const auditEventId = crypto.randomUUID();
      const targetMeetingCountAfter = decision.decision === 'approve_match'
        ? target.meeting_count + candidate.meeting_count
        : target.meeting_count;
      const statements: D1PreparedStatement[] = [
        db.prepare(`INSERT INTO topic_memory_review_events (
          review_event_id, candidate_memory_id, target_memory_id, decision,
          expected_source_version, observed_source_version, expected_proposed_match_memory_id,
          observed_proposed_match_memory_id, reviewer_name, reviewer_note, warning_acknowledged,
          idempotency_key, candidate_match_status_before, candidate_match_status_after,
          target_meeting_count_before, target_meeting_count_after
        ) SELECT ?, ?, ?, ?, ?, updated_at, ?, proposed_match_memory_id, ?, ?, 1, ?, 'pending_review', ?,
          (SELECT meeting_count FROM topic_memory WHERE memory_id = ?), ?
          FROM topic_memory WHERE memory_id = ? AND match_status = 'pending_review' AND updated_at = ?
            AND proposed_match_memory_id = ? AND merged_into_memory_id IS NULL
            AND EXISTS (SELECT 1 FROM topic_memory t WHERE t.memory_id = ? AND t.memory_id != ?
              AND t.match_status != 'merged' AND t.merged_into_memory_id IS NULL)`)
          .bind(auditEventId, candidateMemoryId, targetId, decision.decision, decision.expectedSourceVersion,
            decision.expectedProposedMatchMemoryId, decision.reviewerName, decision.note, decision.idempotencyKey,
            decision.decision === 'approve_match' ? 'merged' : 'confirmed', targetId, targetMeetingCountAfter,
            candidateMemoryId, decision.expectedSourceVersion, decision.expectedProposedMatchMemoryId, targetId, candidateMemoryId),
        db.prepare(decision.decision === 'approve_match' ? `UPDATE topic_memory
          SET match_status = 'merged', merged_into_memory_id = ?, review_resolved_at = datetime('now'),
              review_event_id = ?, updated_at = datetime('now')
          WHERE memory_id = ? AND match_status = 'pending_review' AND updated_at = ?
            AND proposed_match_memory_id = ? AND merged_into_memory_id IS NULL` : `UPDATE topic_memory
          SET match_status = 'confirmed', merged_into_memory_id = NULL, review_resolved_at = datetime('now'),
              review_event_id = ?, proposed_match_memory_id = NULL, proposed_match_reason = NULL,
              updated_at = datetime('now')
          WHERE memory_id = ? AND match_status = 'pending_review' AND updated_at = ?
            AND proposed_match_memory_id = ? AND merged_into_memory_id IS NULL`)
          .bind(...(decision.decision === 'approve_match'
            ? [targetId, auditEventId, candidateMemoryId, decision.expectedSourceVersion, targetId]
            : [auditEventId, candidateMemoryId, decision.expectedSourceVersion, targetId])),
      ];

      if (decision.decision === 'approve_match') {
        statements.push(db.prepare(`UPDATE topic_memory SET
          first_seen_date = CASE WHEN first_seen_date IS NULL OR (? IS NOT NULL AND ? < first_seen_date) THEN ? ELSE first_seen_date END,
          first_seen_meeting_id = CASE WHEN first_seen_date IS NULL OR (? IS NOT NULL AND ? < first_seen_date) THEN ? ELSE first_seen_meeting_id END,
          last_seen_date = CASE WHEN last_seen_date IS NULL OR (? IS NOT NULL AND ? > last_seen_date) THEN ? ELSE last_seen_date END,
          last_seen_meeting_id = CASE WHEN last_seen_date IS NULL OR (? IS NOT NULL AND ? > last_seen_date) THEN ? ELSE last_seen_meeting_id END,
          latest_outcome = CASE WHEN last_seen_date IS NULL OR (? IS NOT NULL AND ? > last_seen_date) THEN ? ELSE latest_outcome END,
          latest_disposition = CASE WHEN last_seen_date IS NULL OR (? IS NOT NULL AND ? > last_seen_date) THEN ? ELSE latest_disposition END,
          latest_executive_scope = CASE WHEN last_seen_date IS NULL OR (? IS NOT NULL AND ? > last_seen_date) THEN ? ELSE latest_executive_scope END,
          meeting_count = meeting_count + ?, updated_at = datetime('now')
          WHERE memory_id = ? AND match_status != 'merged' AND merged_into_memory_id IS NULL
            AND EXISTS (SELECT 1 FROM topic_memory c WHERE c.memory_id = ? AND c.match_status = 'merged'
              AND c.merged_into_memory_id = ? AND c.review_event_id = ?)`)
          .bind(candidate.first_seen_date, candidate.first_seen_date, candidate.first_seen_date,
            candidate.first_seen_date, candidate.first_seen_date, candidate.first_seen_meeting_id,
            candidate.last_seen_date, candidate.last_seen_date, candidate.last_seen_date,
            candidate.last_seen_date, candidate.last_seen_date, candidate.last_seen_meeting_id,
            candidate.last_seen_date, candidate.last_seen_date, candidate.latest_outcome,
            candidate.last_seen_date, candidate.last_seen_date, candidate.latest_disposition,
            candidate.last_seen_date, candidate.last_seen_date, candidate.latest_executive_scope,
            candidate.meeting_count, targetId, candidateMemoryId, targetId, auditEventId));
      }

      statements.push(
        db.prepare(`INSERT INTO topic_memory_review_commit_guards (
          review_event_id, candidate_memory_id, target_memory_id, decision, target_meeting_count_after
        ) VALUES (?, ?, ?, ?, ?)`).bind(auditEventId, candidateMemoryId, targetId, decision.decision, targetMeetingCountAfter),
        db.prepare('DELETE FROM topic_memory_review_commit_guards WHERE review_event_id = ?').bind(auditEventId),
      );

      let results: D1ResultLike[];
      try {
        results = await db.batch(statements) as D1ResultLike[];
      } catch (cause) {
        if (cause instanceof Error && cause.message.includes('review decision invariant failed')) {
          throw new ReviewDecisionConflictError('Review candidate changed while the decision was being applied; refresh and reassess.');
        }
        throw cause;
      }

      const auditResult = results[0];
      const candidateResult = results[1];
      const targetResult = decision.decision === 'approve_match' ? results[2] : null;
      if (auditResult?.meta?.changes !== 1 || candidateResult?.meta?.changes !== 1 ||
        (decision.decision === 'approve_match' && targetResult?.meta?.changes !== 1)) {
        throw new ReviewDecisionConflictError('Review candidate changed while the decision was being applied; refresh and reassess.');
      }

      const updatedCandidate = await first<Pick<ReviewMemoryRow, 'updated_at'>>(
        'SELECT updated_at FROM topic_memory WHERE memory_id = ?', candidateMemoryId,
      );
      const updatedTarget = decision.decision === 'approve_match'
        ? await first<Pick<ReviewMemoryRow, 'updated_at'>>('SELECT updated_at FROM topic_memory WHERE memory_id = ?', targetId)
        : null;
      return {
        decision: decision.decision,
        candidateMemoryId,
        candidateMatchStatus: decision.decision === 'approve_match' ? 'merged' : 'confirmed',
        targetMemoryId: targetId,
        candidateUpdatedAt: updatedCandidate?.updated_at ?? new Date().toISOString(),
        targetUpdatedAt: updatedTarget?.updated_at ?? null,
        auditEventId,
        appliedAt: new Date().toISOString(),
        idempotentReplay: false,
      };
    },
  };
}
