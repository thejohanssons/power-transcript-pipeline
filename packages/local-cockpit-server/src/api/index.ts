// ============================================================
// EIP Local Cockpit Server — API Router
// All routes are prefixed /api/v1/
// Live data replaces the fixture-backed exco-cockpit API.
// ============================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RuntimeD1Adapter } from '../adapters/runtime-d1.js';
import type { FeedbackD1Adapter } from '../adapters/feedback-d1.js';
import { mapMeetingsToCockpit, mapTopicsToCockpit, mapActionsToCockpit,
         mapDecisionsToCockpit, mapTopicMemoryToCockpit, buildOverview } from './mappers.js';
import { composeReviewQueue } from '../review-queue.js';
import type { RuntimeReviewClient } from '../adapters/runtime-review-client.js';
import { RuntimeReviewConflictError, RuntimeReviewClientError } from '../adapters/runtime-review-client.js';
import { randomUUID } from 'node:crypto';

export interface ApiDeps {
  runtimeD1: RuntimeD1Adapter;
  feedbackD1: FeedbackD1Adapter;
  runtimeReviewClient?: RuntimeReviewClient;
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify({ apiVersion: 'v1', data });
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-Local-POC-Boundary': 'loopback-only',
  });
  res.end(body);
}

function err(res: ServerResponse, message: string, status = 400): void {
  const body = JSON.stringify({ error: message });
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function parseId(segment: string | undefined): string | null {
  if (!segment || !/^[\w\-.:]+$/.test(segment)) return null;
  return segment;
}

export function createApiRouter(deps: ApiDeps) {
  const { runtimeD1, feedbackD1, runtimeReviewClient } = deps;

  return async function apiRouter(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    body: string | undefined
  ): Promise<void> {
    const method = req.method ?? 'GET';
    const path = url.pathname;

    // ── GET /api/v1/overview ────────────────────────────────
    if (path === '/api/v1/overview' && method === 'GET') {
      const [meetings, topics, actions, decisions, memory] = await Promise.all([
        runtimeD1.listMeetings(),
        runtimeD1.listTopics(),
        runtimeD1.listActions(),
        runtimeD1.listDecisions(),
        runtimeD1.listTopicMemory(),
      ]);
      return json(res, buildOverview(meetings, topics, actions, decisions, memory));
    }

    // ── GET /api/v1/meetings ────────────────────────────────
    if (path === '/api/v1/meetings' && method === 'GET') {
      const rows = await runtimeD1.listMeetings();
      return json(res, mapMeetingsToCockpit(rows));
    }

    // ── GET /api/v1/meetings/:id ────────────────────────────
    const meetingMatch = path.match(/^\/api\/v1\/meetings\/([^/]+)$/);
    if (meetingMatch && method === 'GET') {
      const id = parseId(meetingMatch[1]);
      if (!id) return err(res, 'Invalid meeting ID', 400);
      const row = await runtimeD1.getMeeting(id);
      if (!row) return err(res, 'Meeting not found', 404);
      const topics = await runtimeD1.listTopicsByMeeting(id);
      const actions = await runtimeD1.listActionsByMeeting(id);
      const decisions = await runtimeD1.listDecisionsByMeeting(id);
      const people = await runtimeD1.listPeopleByMeeting(id);
      return json(res, {
        meeting: mapMeetingsToCockpit([row])[0],
        topics: mapTopicsToCockpit(topics),
        actions: mapActionsToCockpit(actions),
        decisions: mapDecisionsToCockpit(decisions),
        people,
        // r2OutputKey excluded: storage locator, not a business field.
      });
    }

    // No R2 access, credentials, or exposed storage locators in this POC.
    // Approved scope: D1 live data + append-only feedback only.

    // ── GET /api/v1/topics ──────────────────────────────────
    if (path === '/api/v1/topics' && method === 'GET') {
      const rows = await runtimeD1.listTopics();
      return json(res, mapTopicsToCockpit(rows));
    }

    // ── GET /api/v1/decisions ───────────────────────────────
    if (path === '/api/v1/decisions' && method === 'GET') {
      const [decisions, meetings, topics] = await Promise.all([
        runtimeD1.listDecisions(),
        runtimeD1.listMeetings(),
        runtimeD1.listTopics(),
      ]);
      return json(res, mapDecisionsToCockpit(decisions, meetings, topics));
    }

    // ── GET /api/v1/risks-actions ───────────────────────────
    if (path === '/api/v1/risks-actions' && method === 'GET') {
      const [actions, meetings, topics] = await Promise.all([
        runtimeD1.listActions(),
        runtimeD1.listMeetings(),
        runtimeD1.listTopics(),
      ]);
      return json(res, mapActionsToCockpit(actions, meetings, topics));
    }

    // ── GET /api/v1/topic-memory ────────────────────────────
    if (path === '/api/v1/topic-memory' && method === 'GET') {
      const rows = await runtimeD1.listTopicMemory();
      return json(res, mapTopicMemoryToCockpit(rows));
    }

    // ── GET /api/v1/review-queue ────────────────────────────
    if (path === '/api/v1/review-queue' && method === 'GET') {
      const [runtimeRows, feedbackRows] = await Promise.all([
        runtimeD1.listTopicMemory(),
        feedbackD1.listFeedbackForReviewQueue(),
      ]);
      return json(res, composeReviewQueue(
        runtimeRows,
        feedbackRows,
      ));
    }

    // ── GET /api/v1/review-queue/runtime-decisions ─────────
    if (path === '/api/v1/review-queue/runtime-decisions' && method === 'GET') {
      const events = await runtimeD1.listTopicMemoryReviewEvents();
      return json(res, events.map(event => ({
        auditEventId: event.review_event_id,
        candidateMemoryId: event.candidate_memory_id,
        targetMemoryId: event.target_memory_id,
        decision: event.decision,
        reviewerName: event.reviewer_name,
        note: event.reviewer_note,
        createdAt: event.created_at,
        label: 'Runtime decision applied',
      })));
    }

    // ── POST /api/v1/review-queue/memory/:id/decision ───────
    const decisionPrefix = '/api/v1/review-queue/memory/';
    if (method === 'POST' && path.startsWith(decisionPrefix) && path.endsWith('/decision')) {
      const memoryId = parseId(path.slice(decisionPrefix.length, -'/decision'.length));
      if (!memoryId) return err(res, 'Invalid memory ID', 400);
      if (!body) return err(res, 'Request body required', 400);
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return err(res, 'Invalid JSON body', 400); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return err(res, 'Body must be an object', 400);
      const input = parsed as Record<string, unknown>;
      if (input.decision !== 'approve_match' && input.decision !== 'reject_match') return err(res, 'Invalid decision', 400);
      const text = (key: string, max: number): string | null => {
        if (typeof input[key] !== 'string') return null;
        const value = (input[key] as string).trim();
        return value && value.length <= max ? value : null;
      };
      const expectedSourceVersion = text('expectedSourceVersion', 128);
      const expectedTarget = text('expectedProposedMatchMemoryId', 128);
      const reviewerName = text('reviewerName', 200);
      const note = text('note', 4000);
      const idempotencyKey = text('idempotencyKey', 200) ?? randomUUID();
      if (!expectedSourceVersion || !expectedTarget || !reviewerName || !note || input.warningAcknowledged !== true) {
        return err(res, 'expectedSourceVersion, expectedProposedMatchMemoryId, reviewerName, note, and warningAcknowledged are required', 400);
      }
      if (!/^[A-Za-z0-9_.:-]+$/.test(expectedTarget) || !/^[A-Za-z0-9_.:-]+$/.test(idempotencyKey)) return err(res, 'Invalid target or idempotency key', 400);
      if (!runtimeReviewClient) return err(res, 'Runtime review command is not configured', 503);
      try {
        const result = await runtimeReviewClient.submitTopicMemoryDecision(memoryId, {
          decision: input.decision,
          expectedSourceVersion,
          expectedProposedMatchMemoryId: expectedTarget,
          reviewerName,
          note,
          warningAcknowledged: true,
          idempotencyKey,
        });
        return json(res, { ...result, idempotencyKey }, 200);
      } catch (error) {
        if (error instanceof RuntimeReviewConflictError) return err(res, 'Review candidate changed; refresh the queue and reassess the current data.', 409);
        if (error instanceof RuntimeReviewClientError) return err(res, error.message, error.status >= 500 ? 502 : error.status);
        return err(res, 'Runtime review command failed safely', 502);
      }
    }

    // ── GET /api/v1/baseline ────────────────────────────────
    if (path === '/api/v1/baseline' && method === 'GET') {
      const counts = await runtimeD1.baselineCounts();
      return json(res, { counts, capturedAt: new Date().toISOString() });
    }

    // ── GET /api/v1/feedback ────────────────────────────────
    if (path === '/api/v1/feedback' && method === 'GET') {
      const rows = await feedbackD1.listFeedback();
      return json(res, rows);
    }

    // ── GET /api/v1/feedback/export ─────────────────────────
    if (path === '/api/v1/feedback/export' && method === 'GET') {
      const rows = await feedbackD1.exportAll();
      const out = JSON.stringify(rows, null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="feedback-export-${Date.now()}.json"`,
        'Content-Length': Buffer.byteLength(out),
      });
      res.end(out);
      return;
    }

    // ── GET /api/v1/feedback/item/:type/:id ─────────────────
    const feedbackItemMatch = path.match(/^\/api\/v1\/feedback\/item\/([^/]+)\/([^/]+)$/);
    if (feedbackItemMatch && method === 'GET') {
      const itemType = parseId(feedbackItemMatch[1]);
      const itemId = parseId(feedbackItemMatch[2]);
      if (!itemType || !itemId) return err(res, 'Invalid item type or ID', 400);
      const rows = await feedbackD1.listFeedbackForItem(itemType, itemId);
      return json(res, rows);
    }

    // ── POST /api/v1/feedback ───────────────────────────────
    if (path === '/api/v1/feedback' && method === 'POST') {
      if (!body) return err(res, 'Request body required', 400);
      let sub: unknown;
      try { sub = JSON.parse(body); } catch { return err(res, 'Invalid JSON body', 400); }
      if (typeof sub !== 'object' || sub === null) return err(res, 'Body must be an object', 400);

      const s = sub as Record<string, unknown>;
      // sourceVersion is required — it provides feedback provenance (e.g. updated_at timestamp of the reviewed D1 record)
      const required = ['itemType','itemId','sourceKind','sourceVersion','reviewerName','verdict','affectedField','note','warningAcknowledged'];
      const missing = required.filter(k => s[k] === undefined || s[k] === null || s[k] === '');
      if (missing.length) return err(res, `Missing required fields: ${missing.join(', ')}`, 400);
      if (s.warningAcknowledged !== true) return err(res, 'warningAcknowledged must be true', 400);

      const validVerdicts = ['accurate','incomplete','incorrect','irrelevant'];
      if (!validVerdicts.includes(s.verdict as string)) {
        return err(res, `verdict must be one of: ${validVerdicts.join(', ')}`, 400);
      }

      const { randomUUID } = await import('node:crypto');
      const feedbackId = randomUUID();

      await feedbackD1.insertFeedback({
        feedbackId,
        itemType: String(s.itemType),
        itemId: String(s.itemId),
        sourceKind: String(s.sourceKind),
        sourceVersion: String(s.sourceVersion),  // required — validated non-empty above
        reviewerName: String(s.reviewerName),
        verdict: s.verdict as 'accurate' | 'incomplete' | 'incorrect' | 'irrelevant',
        affectedField: String(s.affectedField),
        note: String(s.note),
        warningAcknowledged: true,
        correctsFeedbackId: s.correctsFeedbackId ? String(s.correctsFeedbackId) : null,
        sourceLocation: s.sourceLocation ? String(s.sourceLocation) : null,
      });

      return json(res, { feedbackId, created: true }, 201);
    }

    // ── 404 ─────────────────────────────────────────────────
    return err(res, `Unknown API endpoint: ${path}`, 404);
  };
}
