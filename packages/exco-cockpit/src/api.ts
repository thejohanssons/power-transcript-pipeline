// ============================================================
// EIP ExCo Cockpit — API handlers
// All responses use synthetic fixture data only.
// No transcript fields, no real data, no mutations.
// ============================================================

import { envelope, NOT_EXTRACTED } from './types';
import {
  FIXTURE_OVERVIEW,
  FIXTURE_DECISIONS,
  FIXTURE_RISKS_ACTIONS,
  FIXTURE_TOPIC_MEMORY,
  FIXTURE_EVIDENCE,
  FIXTURE_MEETINGS,
  FIXTURE_TOPICS,
} from './fixtures';

const ALLOWED_EVIDENCE_TYPES = new Set(['topic', 'decision', 'action', 'memory']);

// ── Prohibited fields (must never appear in any response) ─
const PROHIBITED_FIELDS = new Set([
  'transcript', 'transcriptText', 'transcriptSha256', 'r2OutputKey',
]);

function sanitise<T>(obj: T): T {
  const json = JSON.stringify(obj, (key, value) => {
    if (PROHIBITED_FIELDS.has(key)) return undefined;
    return value;
  });
  return JSON.parse(json) as T;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(sanitise(data)), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function methodNotAllowed(): Response {
  return json({ error: 'Method not allowed' }, 405);
}

function notFound(message = 'Not found'): Response {
  return json({ error: message }, 404);
}

// ── GET /api/v1/overview ──────────────────────────────────

export function handleGetOverview(request: Request): Response {
  if (request.method !== 'GET') return methodNotAllowed();
  return json(envelope(FIXTURE_OVERVIEW));
}

// ── GET /api/v1/topics ────────────────────────────────────

export function handleGetTopics(request: Request): Response {
  if (request.method !== 'GET') return methodNotAllowed();
  return json(envelope(FIXTURE_TOPICS));
}

// ── GET /api/v1/decisions ─────────────────────────────────

export function handleGetDecisions(request: Request): Response {
  if (request.method !== 'GET') return methodNotAllowed();
  
  // Enrich each decision with meeting and topic data server-side
  const enrichedDecisions = FIXTURE_DECISIONS.map(decision => {
    const meeting = FIXTURE_MEETINGS.find(m => m.meetingId === decision.meetingId);
    const topic = typeof decision.topicId === 'string' && decision.topicId !== NOT_EXTRACTED
      ? FIXTURE_TOPICS.find(t => t.topicId === decision.topicId)
      : undefined;
    
    return {
      ...decision,
      meetingSubject: meeting?.subject,
      meetingEventDate: meeting?.eventDate,
      evidenceDetailUrl: `/api/v1/evidence/decision/${decision.decisionId}`,
      topicStatement: topic?.topicStatement ?? NOT_EXTRACTED,
      topicDomain: topic?.domain ?? NOT_EXTRACTED,
      topicEntityType: topic?.entityType ?? NOT_EXTRACTED,
      topicEntity: topic?.entity ?? NOT_EXTRACTED,
    };
  });
  
  return json(envelope(enrichedDecisions));
}

// ── GET /api/v1/risks-actions ─────────────────────────────
// Returns separate risks and actions collections.
// Risks are evidence-based proxies from Risk-outcome topics and extracted
// risk assertions — not a complete governed risk register.

export function handleGetRisksActions(request: Request): Response {
  if (request.method !== 'GET') return methodNotAllowed();
  
  // Enrich each risk with topic data server-side
  const enrichedRisks = FIXTURE_RISKS_ACTIONS.risks.map(r => {
    const topic = FIXTURE_TOPICS.find(t => t.topicId === r.topicId);
    return {
      ...r,
      topicDomain: topic?.domain ?? NOT_EXTRACTED,
      topicEntityType: topic?.entityType ?? NOT_EXTRACTED,
      topicEntity: topic?.entity ?? NOT_EXTRACTED,
    };
  });
  
  // Enrich each action with meeting and topic data server-side
  const enrichedActions = FIXTURE_RISKS_ACTIONS.actions.map(action => {
    const meeting = FIXTURE_MEETINGS.find(m => m.meetingId === action.meetingId);
    const topic = typeof action.topicId === 'string' && action.topicId !== NOT_EXTRACTED
      ? FIXTURE_TOPICS.find(t => t.topicId === action.topicId)
      : undefined;
    
    return {
      ...action,
      meetingSubject: meeting?.subject,
      meetingEventDate: meeting?.eventDate,
      evidenceDetailUrl: `/api/v1/evidence/action/${action.actionId}`,
      topicStatement: topic?.topicStatement ?? NOT_EXTRACTED,
      topicDomain: topic?.domain ?? NOT_EXTRACTED,
      topicEntityType: topic?.entityType ?? NOT_EXTRACTED,
      topicEntity: topic?.entity ?? NOT_EXTRACTED,
    };
  });
  
  const enrichedResponse = {
    ...FIXTURE_RISKS_ACTIONS,
    risks: enrichedRisks,
    actions: enrichedActions,
  };
  
  return json(envelope(enrichedResponse));
}

// ── GET /api/v1/topic-memory ──────────────────────────────

export function handleGetTopicMemory(request: Request): Response {
  if (request.method !== 'GET') return methodNotAllowed();
  return json(envelope(FIXTURE_TOPIC_MEMORY));
}

// ── GET /api/v1/review-queue ──────────────────────────────
// The static cockpit test harness mirrors the live server contract.
export function handleGetReviewQueue(request: Request): Response {
  if (request.method !== 'GET') return methodNotAllowed();
  const awaitingReview = FIXTURE_TOPIC_MEMORY
    .filter(memory => memory.matchStatus === 'pending_review')
    .map(memory => ({
      itemType: 'memory', itemId: memory.memoryId, sourceKind: 'd1', sourceVersion: memory.updatedAt,
      candidateStatus: 'pending_review', title: memory.canonicalStatement, summary: null,
      entityType: memory.entityType, entity: memory.entity, aspect: memory.aspect,
      proposedMatchMemoryId: memory.proposedMatchMemoryId, proposedMatchReason: memory.proposedMatchReason,
      updatedAt: memory.updatedAt, disposition: null,
    }));
  return json(envelope({ generatedAt: new Date().toISOString(), awaitingReview, recordedDecisions: [] }));
}

// ── GET /api/v1/evidence/:itemType/:itemId ────────────────
// :itemType must be one of: topic | decision | action | memory
// Evidence responses never contain transcript content.

export function handleGetEvidence(request: Request, itemType: string, itemId: string): Response {
  if (request.method !== 'GET') return methodNotAllowed();
  if (!ALLOWED_EVIDENCE_TYPES.has(itemType)) {
    return notFound(`Unsupported evidence item type '${itemType}'. Allowed: ${[...ALLOWED_EVIDENCE_TYPES].join(', ')}`);
  }
  if (!itemId) return notFound('Evidence item ID is required');
  const item = FIXTURE_EVIDENCE.find(e => e.itemId === itemId && e.itemType === itemType);
  if (!item) return notFound(`Evidence item '${itemType}/${itemId}' not found`);
  return json(envelope(item));
}

// ── Router ────────────────────────────────────────────────

export function routeApiRequest(request: Request, url: URL): Response | null {
  const path = url.pathname;

  if (path === '/api/v1/overview') return handleGetOverview(request);
  if (path === '/api/v1/topics') return handleGetTopics(request);
  if (path === '/api/v1/decisions') return handleGetDecisions(request);
  if (path === '/api/v1/risks-actions') return handleGetRisksActions(request);
  if (path === '/api/v1/topic-memory') return handleGetTopicMemory(request);
  if (path === '/api/v1/review-queue') return handleGetReviewQueue(request);

  // Two-segment evidence route: /api/v1/evidence/:itemType/:itemId
  const evidenceMatch = path.match(/^\/api\/v1\/evidence\/([^/]+)\/([^/]+)$/);
  if (evidenceMatch) return handleGetEvidence(request, evidenceMatch[1], evidenceMatch[2]);

  // Unknown /api/v1 path (including malformed evidence paths)
  if (path.startsWith('/api/v1/')) return notFound();

  // Not an API route — delegate to static assets
  return null;
}
