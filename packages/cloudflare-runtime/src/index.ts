import { backfillAllTopicEvidence } from './evidence-backfill';
import { invalidateMeetings, parseMeetingInvalidationRequest } from './meeting-invalidation';
import { parseMemoryReconciliationRequest, previewMemoryReconciliation } from './memory-reconciliation';
import { applyMemoryReconciliation } from './memory-reconciliation-apply';
import { parseConsolidationRequest, previewMemoryConsolidation } from './memory-consolidation';
import { applyMemoryConsolidation, parseConsolidationApplyRequest } from './memory-consolidation-apply';
import { parseHistoricalReprocessingRequest, reprocessHistoricalMeetings } from './historical-reprocessing';
import type {
  Env,
  TranscriptSubmission,
  ProcessingQueueMessage,
  TopicMemoryReviewDecisionRequest,
  TopicMemoryReviewDecisionResponse,
} from './types';
import type { Message, QueueEvent } from '@cloudflare/workers-types';
import { RUNTIME_VERSION } from './types';
import { isTranscriptSubmission } from './validation';
import {
  buildMeetingRow,
  deleteMeetingChildrenSql,
  insertMeetingSql,
  updateMeetingCompletedSql,
  updateMeetingFailureSql,
  updateMeetingStateSql,
  insertTopicSql,
  insertPersonSql,
  insertActionSql,
  insertDecisionSql,
  buildTopicRow,
  buildPersonRow,
  buildActionRow,
  buildDecisionRow,
} from './db';
import { processMeeting } from './meeting-processing';
import { matchTopicsToMemory } from './topic-memory';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

async function computeSha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function enableForeignKeys(db: D1Database): Promise<void> {
  // D1 currently ignores PRAGMA foreign_keys = ON in the Workers binding.
  // The statement is harmless and documents the intended behavior, but it
  // does not actually enforce FK constraints in D1 today.
  await db.prepare('PRAGMA foreign_keys = ON').run();
}

interface ReviewMemoryRow {
  memory_id: string;
  canonical_statement: string;
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
  proposed_match_reason: string | null;
  merged_into_memory_id: string | null;
  updated_at: string;
}

type ReviewTargetRow = Pick<ReviewMemoryRow, 'memory_id' | 'canonical_statement' | 'first_seen_meeting_id' |
  'last_seen_meeting_id' | 'first_seen_date' | 'last_seen_date' | 'meeting_count' | 'latest_outcome' |
  'latest_disposition' | 'latest_executive_scope' | 'match_status' | 'merged_into_memory_id' | 'updated_at'>;

type D1ResultLike = { meta?: { changes?: number } };

function isSafeReviewIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function validateReviewDecisionBody(body: unknown):
  | { ok: true; value: TopicMemoryReviewDecisionRequest }
  | { ok: false; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Request body must be an object' };
  const value = body as Record<string, unknown>;
  if (value.decision !== 'approve_match' && value.decision !== 'reject_match') {
    return { ok: false, message: 'decision must be approve_match or reject_match' };
  }
  const expectedSourceVersion = boundedText(value.expectedSourceVersion, 128);
  const expectedTarget = boundedText(value.expectedProposedMatchMemoryId, 128);
  const reviewerName = boundedText(value.reviewerName, 200);
  const note = boundedText(value.note, 4000);
  const idempotencyKey = boundedText(value.idempotencyKey, 200);
  if (!expectedSourceVersion || !expectedTarget || !reviewerName || !note || !idempotencyKey) {
    return { ok: false, message: 'expectedSourceVersion, expectedProposedMatchMemoryId, reviewerName, note, and idempotencyKey are required and bounded' };
  }
  if (!isSafeReviewIdentifier(expectedTarget) || !isSafeReviewIdentifier(idempotencyKey)) {
    return { ok: false, message: 'Invalid target or idempotency key' };
  }
  if (value.warningAcknowledged !== true) return { ok: false, message: 'warningAcknowledged must be true' };
  return {
    ok: true,
    value: {
      decision: value.decision as 'approve_match' | 'reject_match',
      expectedSourceVersion,
      expectedProposedMatchMemoryId: expectedTarget,
      reviewerName,
      note,
      warningAcknowledged: true,
      idempotencyKey,
    },
  };
}

export default {
  async fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === '/health' && method === 'GET') {
        return jsonResponse({ status: 'ok', version: RUNTIME_VERSION, environment: env.ENVIRONMENT });
      }

      if (path === '/v1/meetings' && method === 'POST') {
        return this.handlePostMeeting(request, env);
      }

      if (path === '/v1/admin/backfill-topic-evidence' && method === 'POST') {
        return this.handleBackfillTopicEvidence(request, env);
      }

      if (path === '/v1/admin/invalidate-meetings' && method === 'POST') {
        return this.handleInvalidateMeetings(request, env);
      }

      if (path === '/v1/admin/reconcile-invalidated-memories' && method === 'POST') {
        return this.handleReconcileInvalidatedMemories(request, env);
      }

      if (path === '/v1/admin/consolidate-topic-memory' && method === 'POST') {
        return this.handleConsolidateTopicMemory(request, env);
      }

      if (path === '/v1/admin/apply-topic-memory-consolidation' && method === 'POST') {
        return this.handleApplyTopicMemoryConsolidation(request, env);
      }

      if (path === '/v1/admin/reprocess-historical' && method === 'POST') {
        return this.handleReprocessHistorical(request, env);
      }

      if (path === '/v1/topic-memory' && method === 'GET') {
        return this.handleGetTopicMemory(env);
      }

      const matchPath = path.match(/^\/v1\/topic-memory\/([^/]+)\/match$/);
      if (matchPath && method === 'PATCH') {
        return this.handlePatchTopicMemoryMatch(decodeURIComponent(matchPath[1]), request, env);
      }

      return errorResponse('Not found', 404);
    } catch (err) {
      console.error('Cloudflare runtime error:', err);
      return errorResponse(`Internal server error: ${err instanceof Error ? err.message : String(err)}`, 500);
    }
  },

  async handleBackfillTopicEvidence(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.SUBMISSION_TOKEN}`) {
      return errorResponse('Unauthorised', 401);
    }

    const result = await backfillAllTopicEvidence(env.DB, env.OUTPUT_BUCKET);
    return jsonResponse(result, 200);
  },

  async handleInvalidateMeetings(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.SUBMISSION_TOKEN}`) {
      return errorResponse('Unauthorised', 401);
    }

    const body = await request.json().catch(() => ({}));
    const options = parseMeetingInvalidationRequest(body);
    if (options.meetingIds.length === 0) {
      return errorResponse('meetingIds must contain at least one meeting ID', 400);
    }
    const result = await invalidateMeetings(env.DB, env.OUTPUT_BUCKET, options);
    return jsonResponse(result, 200);
  },

  async handleConsolidateTopicMemory(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.SUBMISSION_TOKEN}`) return errorResponse('Unauthorised', 401);
    const body = await request.json().catch(() => ({}));
    return jsonResponse(await previewMemoryConsolidation(env.DB, parseConsolidationRequest(body)), 200);
  },

  async handleApplyTopicMemoryConsolidation(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.SUBMISSION_TOKEN}`) return errorResponse('Unauthorised', 401);
    const body = await request.json().catch(() => ({}));
    const applyRequest = parseConsolidationApplyRequest(body);
    const preview = await previewMemoryConsolidation(env.DB, parseConsolidationRequest(body));
    try {
      const result = await applyMemoryConsolidation(env.DB, preview.proposals, preview.roots, applyRequest);
      return jsonResponse({ ...preview, ...result }, 200);
    } catch (error) {
      return jsonResponse({
        error: error instanceof Error ? error.message : String(error),
        message: 'Consolidation apply failed after partial progress; do not retry until this error is resolved.',
      }, 500);
    }
  },

  async handleReconcileInvalidatedMemories(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.SUBMISSION_TOKEN}`) {
      return errorResponse('Unauthorised', 401);
    }

    const body = await request.json().catch(() => ({}));
    const options = parseMemoryReconciliationRequest(body);
    const result = await previewMemoryReconciliation(env.DB, options);
    if (options.dryRun) return jsonResponse(result, 200);
    const applied = await applyMemoryReconciliation(env.DB, result.rows, options);
    return jsonResponse({ ...result, ...applied }, 200);
  },

  async handleReprocessHistorical(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.SUBMISSION_TOKEN}`) {
      return errorResponse('Unauthorised', 401);
    }

    const body = await request.json().catch(() => ({}));
    const options = parseHistoricalReprocessingRequest(body);
    const result = await reprocessHistoricalMeetings(env.DB, env.OUTPUT_BUCKET, {
      AZURE_OPENAI_ENDPOINT: env.AZURE_OPENAI_ENDPOINT,
      AZURE_OPENAI_DEPLOYMENT: env.AZURE_OPENAI_DEPLOYMENT,
      AZURE_OPENAI_API_KEY: env.AZURE_OPENAI_API_KEY,
    }, options);
    return jsonResponse(result, 200);
  },

  async handlePostMeeting(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.SUBMISSION_TOKEN}`) {
      return errorResponse('Unauthorised', 401);
    }

    const body = await request.json().catch(() => null);
    if (!body || !isTranscriptSubmission(body)) {
      return errorResponse('Request body must be a valid TranscriptSubmission', 400);
    }

    const submission = body as TranscriptSubmission;
    const transcriptSha256 = await computeSha256(submission.transcript);
    const transcriptKey = `meetings/${submission.meetingId}/transcript.txt`;

    await enableForeignKeys(env.DB);
    const existing = await env.DB.prepare('SELECT state, updated_at FROM meetings WHERE meeting_id = ?')
      .bind(submission.meetingId)
      .first<{ state: string; updated_at: string | null }>();

    if (existing?.state === 'processing' && this.isStaleProcessing(existing.updated_at)) {
      await env.DB.prepare(updateMeetingFailureSql()).bind('failed', 'stale processing recovery', submission.meetingId).run();
      existing.state = 'failed';
    }

    if (existing?.state === 'completed' || existing?.state === 'processing' || existing?.state === 'pending') {
      return jsonResponse({ meetingId: submission.meetingId, state: existing.state, already_exists: true }, 200);
    }

    await env.OUTPUT_BUCKET.put(transcriptKey, submission.transcript, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    });

    if (existing?.state === 'failed') {
      const sqls = deleteMeetingChildrenSql();
      await env.DB.batch([
        env.DB.prepare(sqls.actions).bind(submission.meetingId),
        env.DB.prepare(sqls.decisions).bind(submission.meetingId),
        env.DB.prepare(sqls.people).bind(submission.meetingId),
        env.DB.prepare(sqls.topicMemory).bind(submission.meetingId),
        env.DB.prepare(sqls.topics).bind(submission.meetingId),
        env.DB.prepare('DELETE FROM meetings WHERE meeting_id = ?').bind(submission.meetingId),
        env.DB.prepare(insertMeetingSql()).bind(...buildMeetingRow(submission, transcriptSha256, null)),
      ]);
    } else {
      const insert = insertMeetingSql();
      await env.DB.prepare(insert)
        .bind(...buildMeetingRow(submission, transcriptSha256, null))
        .run();
    }

    await env.PROCESSING_QUEUE.send({ meetingId: submission.meetingId });
    return jsonResponse({ meetingId: submission.meetingId, state: 'pending' }, 202);
  },

  async queue(queueEvent: QueueEvent<ProcessingQueueMessage>, env: Env): Promise<void> {
    for (const message of queueEvent.messages) {
      await this.handleQueueMessage(message, env);
    }
  },

  async handleQueueMessage(message: Message<ProcessingQueueMessage>, env: Env): Promise<void> {
    const payload = message.body;
    if (!payload?.meetingId) {
      console.error('Queue message missing meetingId');
      return;
    }

    const meetingRow = await env.DB.prepare('SELECT source_system, native_id, subject, organiser, event_date, transcript_sha256, state, updated_at FROM meetings WHERE meeting_id = ?')
      .bind(payload.meetingId)
      .first<{
        source_system: string;
        native_id: string;
        subject: string;
        organiser: string;
        event_date: string;
        transcript_sha256: string;
        state: string;
        updated_at: string | null;
      }>();

    if (!meetingRow) {
      console.error('Queue message references missing meeting row:', payload.meetingId);
      return;
    }

    if (meetingRow.state === 'completed') {
      return;
    }

    if (meetingRow.state === 'processing') {
      if (!this.isStaleProcessing(meetingRow.updated_at)) {
        return;
      }
      await env.DB.prepare(updateMeetingFailureSql()).bind('failed', 'stale processing recovery', payload.meetingId).run();
    }

    const transcriptKey = `meetings/${payload.meetingId}/transcript.txt`;
    const transcriptObject = await env.OUTPUT_BUCKET.get(transcriptKey);
    if (!transcriptObject) {
      await env.DB.prepare(updateMeetingFailureSql()).bind('failed', 'transcript missing from R2', payload.meetingId).run();
      console.error('Transcript missing for meeting:', payload.meetingId);
      return;
    }

    const transcript = await transcriptObject.text();
    const submission: TranscriptSubmission = {
      meetingId: payload.meetingId,
      sourceSystem: meetingRow.source_system,
      nativeId: meetingRow.native_id,
      subject: meetingRow.subject,
      organiser: meetingRow.organiser,
      eventDate: meetingRow.event_date,
      transcript,
    };

    await this.processAndPersist(submission, meetingRow.transcript_sha256, env);
  },

  isStaleProcessing(updatedAt: string | null | undefined, thresholdMinutes = 5): boolean {
    if (!updatedAt) return false;
    const timestamp = Date.parse(updatedAt);
    if (Number.isNaN(timestamp)) return false;
    return Date.now() - timestamp > thresholdMinutes * 60_000;
  },

  async processAndPersist(submission: TranscriptSubmission, transcriptSha256: string, env: Env): Promise<void> {
    const meetingId = submission.meetingId;

    try {
      await env.DB.prepare(updateMeetingStateSql()).bind('processing', meetingId).run();

      const meetingOutput = await processMeeting(submission, transcriptSha256, {
        AZURE_OPENAI_ENDPOINT: env.AZURE_OPENAI_ENDPOINT,
        AZURE_OPENAI_DEPLOYMENT: env.AZURE_OPENAI_DEPLOYMENT,
        AZURE_OPENAI_API_KEY: env.AZURE_OPENAI_API_KEY,
      });

      const incompleteTopics = meetingOutput.topics.filter((topic) => topic.keyFacts.length === 0);
      if (incompleteTopics.length > 0) {
        throw new Error(`Evidence completeness validation failed for topics: ${incompleteTopics.map((topic) => topic.topicId).join(', ')}`);
      }

      const r2Key = `meetings/${meetingId}/meeting-output.json`;
      await env.OUTPUT_BUCKET.put(r2Key, JSON.stringify(meetingOutput, null, 2), {
        httpMetadata: { contentType: 'application/json' },
      });

      const batchStatements = [
        env.DB.prepare(updateMeetingCompletedSql()).bind('completed', r2Key, meetingId),
      ];

      for (const topic of meetingOutput.topics) {
        batchStatements.push(env.DB.prepare(insertTopicSql()).bind(...buildTopicRow(topic, meetingId)));
      }

      for (const person of meetingOutput.people) {
        batchStatements.push(env.DB.prepare(insertPersonSql()).bind(...buildPersonRow(person, meetingId)));
      }

      for (const action of meetingOutput.actions) {
        batchStatements.push(env.DB.prepare(insertActionSql()).bind(...buildActionRow(action)));
      }

      for (const decision of meetingOutput.decisions) {
        batchStatements.push(env.DB.prepare(insertDecisionSql()).bind(...buildDecisionRow(decision)));
      }

      await env.DB.batch(batchStatements);
      await matchTopicsToMemory(meetingOutput, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await env.DB.prepare(updateMeetingFailureSql()).bind('failed', message, submission.meetingId).run();
      console.error('Meeting processing failed:', message);
    }
  },

  async handleGetTopicMemory(_env: Env): Promise<Response> {
    return jsonResponse({ topicMemory: [] });
  },

  async handlePatchTopicMemoryMatch(id: string, request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.REVIEW_DECISION_TOKEN}`) {
      return errorResponse('Unauthorised', 401);
    }

    if (!isSafeReviewIdentifier(id)) return errorResponse('Invalid candidate memory ID', 400);
    const body = await request.json().catch(() => null);
    const parsed = validateReviewDecisionBody(body);
    if (!parsed.ok) return errorResponse(parsed.message, 400);
    const decision = parsed.value;

    const existingEvent = await env.DB.prepare(`SELECT review_event_id, candidate_memory_id, target_memory_id,
        decision, expected_source_version, expected_proposed_match_memory_id, reviewer_name, reviewer_note,
        warning_acknowledged, idempotency_key, candidate_match_status_after, created_at
      FROM topic_memory_review_events WHERE idempotency_key = ?`)
      .bind(decision.idempotencyKey)
      .first<{
        review_event_id: string; candidate_memory_id: string; target_memory_id: string; decision: string;
        expected_source_version: string; expected_proposed_match_memory_id: string; reviewer_name: string;
        reviewer_note: string; warning_acknowledged: number; idempotency_key: string;
        candidate_match_status_after: 'merged' | 'confirmed'; created_at: string;
      }>();

    if (existingEvent) {
      const samePayload = existingEvent.candidate_memory_id === id &&
        existingEvent.decision === decision.decision &&
        existingEvent.expected_source_version === decision.expectedSourceVersion &&
        existingEvent.expected_proposed_match_memory_id === decision.expectedProposedMatchMemoryId &&
        existingEvent.reviewer_name === decision.reviewerName &&
        existingEvent.reviewer_note === decision.note &&
        existingEvent.warning_acknowledged === 1;
      if (!samePayload) return errorResponse('Idempotency key was already used for a different decision', 409);
      const replayCandidate = await env.DB.prepare(
        `SELECT updated_at FROM topic_memory WHERE memory_id = ?`,
      ).bind(id).first<{ updated_at: string }>();
      const replayTarget = await env.DB.prepare(
        `SELECT updated_at FROM topic_memory WHERE memory_id = ?`,
      ).bind(existingEvent.target_memory_id).first<{ updated_at: string }>();
      return jsonResponse({
        decision: existingEvent.decision as 'approve_match' | 'reject_match',
        candidateMemoryId: id,
        candidateMatchStatus: existingEvent.candidate_match_status_after,
        targetMemoryId: existingEvent.target_memory_id,
        candidateUpdatedAt: replayCandidate?.updated_at ?? existingEvent.created_at,
        targetUpdatedAt: existingEvent.decision === 'approve_match' ? replayTarget?.updated_at ?? null : null,
        auditEventId: existingEvent.review_event_id,
        appliedAt: existingEvent.created_at,
        idempotentReplay: true,
      } satisfies TopicMemoryReviewDecisionResponse);
    }

    const candidate = await env.DB.prepare(`SELECT memory_id, canonical_statement, first_seen_meeting_id,
        last_seen_meeting_id, first_seen_date, last_seen_date, meeting_count, latest_outcome,
        latest_disposition, latest_executive_scope, match_status, proposed_match_memory_id,
        proposed_match_reason, merged_into_memory_id, updated_at
      FROM topic_memory WHERE memory_id = ?`).bind(id).first<ReviewMemoryRow>();
    if (!candidate) return errorResponse('Candidate not found', 404);
    if (candidate.match_status !== 'pending_review') return errorResponse('Candidate is no longer pending review', 409);

    const targetId = candidate.proposed_match_memory_id;
    if (!targetId || targetId !== decision.expectedProposedMatchMemoryId || targetId === id) {
      return errorResponse('Candidate proposed target is no longer eligible', 409);
    }
    if (candidate.updated_at !== decision.expectedSourceVersion || candidate.merged_into_memory_id) {
      return errorResponse('Candidate source version is stale', 409);
    }
    if (!isSafeReviewIdentifier(targetId)) return errorResponse('Candidate proposed target is invalid', 409);

    const target = await env.DB.prepare(`SELECT memory_id, canonical_statement, first_seen_meeting_id,
        last_seen_meeting_id, first_seen_date, last_seen_date, meeting_count, latest_outcome,
        latest_disposition, latest_executive_scope, match_status, merged_into_memory_id, updated_at
      FROM topic_memory WHERE memory_id = ?`).bind(targetId).first<ReviewTargetRow>();
    if (!target || target.match_status === 'merged' || target.merged_into_memory_id) {
      return errorResponse('Proposed target is missing or no longer eligible', 409);
    }

    const auditEventId = crypto.randomUUID();
    const statements = [
      env.DB.prepare(`INSERT INTO topic_memory_review_events (
        review_event_id, candidate_memory_id, target_memory_id, decision,
        expected_source_version, observed_source_version, expected_proposed_match_memory_id,
        observed_proposed_match_memory_id, reviewer_name, reviewer_note, warning_acknowledged,
        idempotency_key, candidate_match_status_before, candidate_match_status_after,
        target_meeting_count_before, target_meeting_count_after
      ) SELECT ?, ?, ?, ?, ?, updated_at, ?, proposed_match_memory_id, ?, ?, 1, ?, 'pending_review', ?, meeting_count, ?
        FROM topic_memory
        WHERE memory_id = ? AND match_status = 'pending_review' AND updated_at = ?
          AND proposed_match_memory_id = ? AND merged_into_memory_id IS NULL
          AND EXISTS (SELECT 1 FROM topic_memory t WHERE t.memory_id = ? AND t.memory_id != ?
            AND t.match_status != 'merged' AND t.merged_into_memory_id IS NULL)`)
        .bind(
          auditEventId, id, targetId, decision.decision, decision.expectedSourceVersion,
          decision.expectedProposedMatchMemoryId, decision.reviewerName, decision.note,
          decision.idempotencyKey, decision.decision === 'approve_match' ? 'merged' : 'confirmed',
          decision.decision === 'approve_match' ? target.meeting_count + candidate.meeting_count : target.meeting_count,
          id, decision.expectedSourceVersion, decision.expectedProposedMatchMemoryId, targetId, id,
        ),
      env.DB.prepare(decision.decision === 'approve_match' ? `UPDATE topic_memory
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
          ? [targetId, auditEventId, id, decision.expectedSourceVersion, decision.expectedProposedMatchMemoryId]
          : [auditEventId, id, decision.expectedSourceVersion, decision.expectedProposedMatchMemoryId])),
    ];

    if (decision.decision === 'approve_match') {
      statements.push(env.DB.prepare(`UPDATE topic_memory SET
          first_seen_date = CASE WHEN first_seen_date IS NULL OR ( ? IS NOT NULL AND ? < first_seen_date ) THEN ? ELSE first_seen_date END,
          first_seen_meeting_id = CASE WHEN first_seen_date IS NULL OR ( ? IS NOT NULL AND ? < first_seen_date ) THEN ? ELSE first_seen_meeting_id END,
          last_seen_date = CASE WHEN last_seen_date IS NULL OR ( ? IS NOT NULL AND ? > last_seen_date ) THEN ? ELSE last_seen_date END,
          last_seen_meeting_id = CASE WHEN last_seen_date IS NULL OR ( ? IS NOT NULL AND ? > last_seen_date ) THEN ? ELSE last_seen_meeting_id END,
          latest_outcome = CASE WHEN last_seen_date IS NULL OR ( ? IS NOT NULL AND ? > last_seen_date ) THEN ? ELSE latest_outcome END,
          latest_disposition = CASE WHEN last_seen_date IS NULL OR ( ? IS NOT NULL AND ? > last_seen_date ) THEN ? ELSE latest_disposition END,
          latest_executive_scope = CASE WHEN last_seen_date IS NULL OR ( ? IS NOT NULL AND ? > last_seen_date ) THEN ? ELSE latest_executive_scope END,
          meeting_count = meeting_count + ?, updated_at = datetime('now')
        WHERE memory_id = ? AND match_status != 'merged' AND merged_into_memory_id IS NULL
          AND EXISTS (SELECT 1 FROM topic_memory c WHERE c.memory_id = ? AND c.match_status = 'merged'
            AND c.merged_into_memory_id = ? AND c.review_event_id = ?)`)
        .bind(
          candidate.first_seen_date, candidate.first_seen_date, candidate.first_seen_date,
          candidate.first_seen_date, candidate.first_seen_date, candidate.first_seen_meeting_id,
          candidate.last_seen_date, candidate.last_seen_date, candidate.last_seen_date,
          candidate.last_seen_date, candidate.last_seen_date, candidate.last_seen_meeting_id,
          candidate.last_seen_date, candidate.last_seen_date, candidate.latest_outcome,
          candidate.last_seen_date, candidate.last_seen_date, candidate.latest_disposition,
          candidate.last_seen_date, candidate.last_seen_date, candidate.latest_executive_scope,
          candidate.meeting_count, targetId, id, targetId, auditEventId,
        ));
    }

    const targetMeetingCountAfter = decision.decision === 'approve_match'
      ? target.meeting_count + candidate.meeting_count
      : target.meeting_count;
    statements.push(
      env.DB.prepare(`INSERT INTO topic_memory_review_commit_guards (
          review_event_id, candidate_memory_id, target_memory_id, decision, target_meeting_count_after
        ) VALUES (?, ?, ?, ?, ?)`)
        .bind(auditEventId, id, targetId, decision.decision, targetMeetingCountAfter),
      env.DB.prepare(`DELETE FROM topic_memory_review_commit_guards WHERE review_event_id = ?`)
        .bind(auditEventId),
    );

    let results: D1ResultLike[];
    try {
      results = await env.DB.batch(statements) as D1ResultLike[];
    } catch (error) {
      if (error instanceof Error && error.message.includes('review decision invariant failed')) {
        return errorResponse('Review candidate changed while the decision was being applied; refresh and reassess', 409);
      }
      throw error;
    }
    const auditResult = results[0] as D1ResultLike;
    const candidateResult = results[1] as D1ResultLike;
    const targetResult = decision.decision === 'approve_match' ? results[2] as D1ResultLike : null;
    if (auditResult?.meta?.changes !== 1 || candidateResult?.meta?.changes !== 1 ||
        (decision.decision === 'approve_match' && targetResult?.meta?.changes !== 1)) {
      return errorResponse('Review candidate changed while the decision was being applied; refresh and reassess', 409);
    }

    const updatedCandidate = await env.DB.prepare(`SELECT updated_at FROM topic_memory WHERE memory_id = ?`).bind(id).first<{ updated_at: string }>();
    const updatedTarget = decision.decision === 'approve_match'
      ? await env.DB.prepare(`SELECT updated_at FROM topic_memory WHERE memory_id = ?`).bind(targetId).first<{ updated_at: string }>()
      : null;
    return jsonResponse({
      decision: decision.decision,
      candidateMemoryId: id,
      candidateMatchStatus: decision.decision === 'approve_match' ? 'merged' : 'confirmed',
      targetMemoryId: targetId,
      candidateUpdatedAt: updatedCandidate?.updated_at ?? new Date().toISOString(),
      targetUpdatedAt: updatedTarget?.updated_at ?? null,
      auditEventId,
      appliedAt: new Date().toISOString(),
      idempotentReplay: false,
    } satisfies TopicMemoryReviewDecisionResponse);
  },
};
