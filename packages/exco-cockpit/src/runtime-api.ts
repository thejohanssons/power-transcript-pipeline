// ============================================================
// EIP ExCo Cockpit — Runtime D1 and append-only feedback API
//
// Runtime records are read-only. Feedback is written only to the dedicated
// FEEDBACK_DB through the feedback adapter.
// ============================================================

import {
  envelope,
  FEEDBACK_ITEM_TYPES,
  type EvidenceItem,
  type FeedbackItemType,
  type FeedbackSubmission,
  type FeedbackVerdict,
  type TopicMemoryReviewDecision,
  type TopicMemoryReviewDecisionRequest,
} from './types';
import type { FeedbackD1Reader } from './feedback-d1';
import {
  isSafeReviewIdentifier,
  ReviewDecisionConflictError,
  ReviewDecisionNotFoundError,
  type RuntimeReviewD1Writer,
} from './runtime-review-d1';
import type { RuntimeD1Reader } from './runtime-d1-reader';

const ALLOWED_EVIDENCE_TYPES = new Set<EvidenceItem['itemType']>(['topic', 'decision', 'action', 'memory']);
const ALLOWED_FEEDBACK_ITEM_TYPES = new Set<FeedbackItemType>(FEEDBACK_ITEM_TYPES);
const ALLOWED_FEEDBACK_VERDICTS = new Set<FeedbackVerdict>(['accurate', 'incomplete', 'incorrect', 'irrelevant']);
const PROHIBITED_FIELDS = new Set(['transcript', 'transcriptText', 'transcriptSha256', 'r2OutputKey']);
const MAX_FEEDBACK_BODY_BYTES = 16_384;
const MAX_ITEM_ID_LENGTH = 256;
const MAX_SOURCE_VERSION_LENGTH = 256;
const MAX_REVIEWER_NAME_LENGTH = 200;
const MAX_AFFECTED_FIELD_LENGTH = 200;
const MAX_NOTE_LENGTH = 4_000;
const MAX_FEEDBACK_ID_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data, (key, value) => PROHIBITED_FIELDS.has(key) ? undefined : value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Cockpit endpoints expose current operational state. Do not permit a
      // browser, intermediary, or Cloudflare edge cache to retain a snapshot.
      'Cache-Control': 'no-store, max-age=0',
      ...extraHeaders,
    },
  });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

function methodNotAllowed(): Response {
  return error('Method not allowed', 405);
}

function notFound(message = 'Not found'): Response {
  return error(message, 404);
}

function requireGet(request: Request): Response | null {
  return request.method === 'GET' ? null : methodNotAllowed();
}

function validText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${field} is required.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  if (trimmed.length > maxLength) throw new Error(`${field} exceeds its maximum length.`);
  return trimmed;
}

function optionalIdentifier(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const identifier = validText(value, field, MAX_FEEDBACK_ID_LENGTH);
  if (!/^[A-Za-z0-9_.:-]+$/.test(identifier)) throw new Error(`${field} is invalid.`);
  return identifier;
}

function parseFeedbackSubmission(value: unknown): FeedbackSubmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Body must be a JSON object.');
  const body = value as Record<string, unknown>;
  const itemType = body.itemType;
  if (typeof itemType !== 'string' || !ALLOWED_FEEDBACK_ITEM_TYPES.has(itemType as FeedbackItemType)) {
    throw new Error(`itemType must be one of: ${FEEDBACK_ITEM_TYPES.join(', ')}.`);
  }
  if (body.sourceKind !== 'd1') throw new Error('sourceKind must be d1.');
  if (typeof body.verdict !== 'string' || !ALLOWED_FEEDBACK_VERDICTS.has(body.verdict as FeedbackVerdict)) {
    throw new Error(`verdict must be one of: ${[...ALLOWED_FEEDBACK_VERDICTS].join(', ')}.`);
  }
  if (body.warningAcknowledged !== true) throw new Error('warningAcknowledged must be true.');

  return {
    feedbackId: crypto.randomUUID(),
    itemType: itemType as FeedbackItemType,
    itemId: validText(body.itemId, 'itemId', MAX_ITEM_ID_LENGTH),
    sourceKind: 'd1',
    sourceVersion: validText(body.sourceVersion, 'sourceVersion', MAX_SOURCE_VERSION_LENGTH),
    reviewerName: validText(body.reviewerName, 'reviewerName', MAX_REVIEWER_NAME_LENGTH),
    verdict: body.verdict as FeedbackVerdict,
    affectedField: validText(body.affectedField, 'affectedField', MAX_AFFECTED_FIELD_LENGTH),
    note: validText(body.note, 'note', MAX_NOTE_LENGTH),
    warningAcknowledged: true,
    correctsFeedbackId: optionalIdentifier(body.correctsFeedbackId, 'correctsFeedbackId'),
    sourceLocation: body.sourceLocation === undefined || body.sourceLocation === null || body.sourceLocation === ''
      ? null
      : validText(body.sourceLocation, 'sourceLocation', MAX_ITEM_ID_LENGTH),
  };
}

async function readFeedbackSubmission(request: Request): Promise<FeedbackSubmission> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > MAX_FEEDBACK_BODY_BYTES) {
    throw new Error('Feedback request body is too large.');
  }

  const text = await request.text();
  if (text.length > MAX_FEEDBACK_BODY_BYTES) throw new Error('Feedback request body is too large.');
  try {
    return parseFeedbackSubmission(JSON.parse(text));
  } catch (cause) {
    if (cause instanceof SyntaxError) throw new Error('Invalid JSON body.');
    throw cause;
  }
}

function parseReviewDecision(value: unknown): TopicMemoryReviewDecisionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Body must be a JSON object.');
  const body = value as Record<string, unknown>;
  if (body.decision !== 'approve_match' && body.decision !== 'reject_match') {
    throw new Error('decision must be approve_match or reject_match.');
  }
  if (body.warningAcknowledged !== true) throw new Error('warningAcknowledged must be true.');
  const target = validText(body.expectedProposedMatchMemoryId, 'expectedProposedMatchMemoryId', MAX_ITEM_ID_LENGTH);
  const idempotencyKey = validText(body.idempotencyKey, 'idempotencyKey', MAX_IDEMPOTENCY_KEY_LENGTH);
  if (!isSafeReviewIdentifier(target) || !isSafeReviewIdentifier(idempotencyKey)) {
    throw new Error('expectedProposedMatchMemoryId or idempotencyKey is invalid.');
  }
  return {
    decision: body.decision as TopicMemoryReviewDecision,
    expectedSourceVersion: validText(body.expectedSourceVersion, 'expectedSourceVersion', MAX_SOURCE_VERSION_LENGTH),
    expectedProposedMatchMemoryId: target,
    reviewerName: validText(body.reviewerName, 'reviewerName', MAX_REVIEWER_NAME_LENGTH),
    note: validText(body.note, 'note', MAX_NOTE_LENGTH),
    warningAcknowledged: true,
    idempotencyKey,
  };
}

async function readReviewDecision(request: Request): Promise<TopicMemoryReviewDecisionRequest> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > MAX_FEEDBACK_BODY_BYTES) throw new Error('Review decision request body is too large.');
  const text = await request.text();
  if (text.length > MAX_FEEDBACK_BODY_BYTES) throw new Error('Review decision request body is too large.');
  try {
    return parseReviewDecision(JSON.parse(text));
  } catch (cause) {
    if (cause instanceof SyntaxError) throw new Error('Invalid JSON body.');
    throw cause;
  }
}

export async function routeRuntimeApiRequest(
  request: Request,
  url: URL,
  reader: RuntimeD1Reader,
  feedback: FeedbackD1Reader,
  reviewWriter?: RuntimeReviewD1Writer,
): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith('/api/v1/')) return null;

  // Phase 2: persistent feedback has its own dedicated D1 binding and is the
  // sole permitted mutation surface. It cannot modify runtime source records.
  if (path === '/api/v1/feedback' && request.method === 'POST') {
    try {
      const submission = await readFeedbackSubmission(request);
      const feedbackId = await feedback.insertFeedback(submission);
      return json(envelope({ feedbackId, created: true }), 201);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Feedback submission failed safely.';
      return error(message, 400);
    }
  }

  const reviewDecisionMatch = path.match(/^\/api\/v1\/review-queue\/memory\/([^/]+)\/decision$/);
  if (reviewDecisionMatch && request.method === 'POST') {
    const candidateMemoryId = decodeURIComponent(reviewDecisionMatch[1]);
    if (!isSafeReviewIdentifier(candidateMemoryId)) return error('Invalid candidate memory ID.', 400);
    if (!reviewWriter) return error('Runtime review decisions are not configured.', 503);
    try {
      const decision = await readReviewDecision(request);
      return json(envelope(await reviewWriter.applyDecision(candidateMemoryId, decision)));
    } catch (cause) {
      if (cause instanceof ReviewDecisionNotFoundError) return notFound(cause.message);
      if (cause instanceof ReviewDecisionConflictError) return error(cause.message, 409);
      const message = cause instanceof Error ? cause.message : 'Review decision failed safely.';
      return error(message, 400);
    }
  }

  const rejected = requireGet(request);
  if (rejected) return rejected;

  if (path === '/api/v1/overview') return json(envelope(await reader.getOverview()));
  if (path === '/api/v1/topics') return json(envelope(await reader.getTopics()));
  if (path === '/api/v1/decisions') return json(envelope(await reader.getDecisions()));
  if (path === '/api/v1/risks-actions') return json(envelope(await reader.getRisksActions()));
  if (path === '/api/v1/topic-memory') return json(envelope(await reader.getTopicMemory()));
  if (path === '/api/v1/review-queue') return json(envelope(await reader.getReviewQueue()));

  if (path === '/api/v1/feedback') return json(envelope(await feedback.listFeedback()));
  if (path === '/api/v1/feedback/export') {
    return json(await feedback.exportAll(), 200, {
      'Content-Disposition': `attachment; filename="feedback-export-${new Date().toISOString().slice(0, 10)}.json"`,
    });
  }

  const feedbackItemMatch = path.match(/^\/api\/v1\/feedback\/item\/([^/]+)\/([^/]+)$/);
  if (feedbackItemMatch) {
    const itemType = decodeURIComponent(feedbackItemMatch[1]);
    const itemId = decodeURIComponent(feedbackItemMatch[2]);
    if (!ALLOWED_FEEDBACK_ITEM_TYPES.has(itemType as FeedbackItemType) || !itemId || itemId.length > MAX_ITEM_ID_LENGTH) {
      return error('Invalid feedback item type or ID.', 400);
    }
    return json(envelope(await feedback.listFeedbackForItem(itemType as FeedbackItemType, itemId)));
  }

  const memoryMatch = path.match(/^\/api\/v1\/topic-memory\/([^/]+)$/);
  if (memoryMatch) {
    const memoryId = decodeURIComponent(memoryMatch[1]);
    const memory = await reader.getTopicMemoryById(memoryId);
    return memory ? json(envelope(memory)) : notFound(`Topic memory '${memoryId}' not found`);
  }

  const evidenceMatch = path.match(/^\/api\/v1\/evidence\/([^/]+)\/([^/]+)$/);
  if (evidenceMatch) {
    const itemType = evidenceMatch[1] as EvidenceItem['itemType'];
    const itemId = decodeURIComponent(evidenceMatch[2]);
    if (!ALLOWED_EVIDENCE_TYPES.has(itemType)) return notFound(`Unsupported evidence item type '${itemType}'.`);
    const evidence = await reader.getEvidence(itemType, itemId);
    return evidence ? json(envelope(evidence)) : notFound(`Evidence item '${itemType}/${itemId}' not found`);
  }

  return notFound();
}
