// ============================================================
// EIP ExCo Cockpit — API tests
// Covers handoff requirements 1-6 (API contract and safety).
// ============================================================

import { describe, it, expect } from 'vitest';
import { routeApiRequest } from './api';
import { NOT_EXTRACTED } from './types';
import {
  FIXTURE_OVERVIEW,
  FIXTURE_TOPICS,
  FIXTURE_DECISIONS,
  FIXTURE_ACTIONS,
  FIXTURE_TOPIC_MEMORY,
  FIXTURE_EVIDENCE,
  FIXTURE_RISKS_ACTIONS,
} from './fixtures';

// ── Helper ────────────────────────────────────────────────

function makeRequest(path: string, method = 'GET'): Request {
  return new Request(`https://eip-exco-cockpit.example.com${path}`, { method });
}

async function callApi(path: string, method = 'GET'): Promise<{ status: number; body: unknown }> {
  const req = makeRequest(path, method);
  const url = new URL(req.url);
  const res = routeApiRequest(req, url);
  if (!res) throw new Error(`No API response for path: ${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

// ── Requirement 1: Each endpoint returns apiVersion: 'v1' envelope ──

describe('API envelope', () => {
  const endpoints = [
    '/api/v1/overview',
    '/api/v1/topics',
    '/api/v1/decisions',
    '/api/v1/risks-actions',
    '/api/v1/topic-memory',
  ];

  for (const path of endpoints) {
    it(`${path} returns apiVersion: 'v1'`, async () => {
      const { status, body } = await callApi(path);
      expect(status).toBe(200);
      expect((body as { apiVersion: string }).apiVersion).toBe('v1');
      expect((body as { data: unknown }).data).toBeDefined();
    });
  }

  it('/api/v1/evidence/:itemType/:itemId returns apiVersion: v1 for known topic item', async () => {
    const e = FIXTURE_EVIDENCE.find(x => x.itemType === 'topic')!;
    const { status, body } = await callApi(`/api/v1/evidence/${e.itemType}/${e.itemId}`);
    expect(status).toBe(200);
    expect((body as { apiVersion: string }).apiVersion).toBe('v1');
  });

  it('/api/v1/evidence/:itemType/:itemId returns apiVersion: v1 for known decision item', async () => {
    const e = FIXTURE_EVIDENCE.find(x => x.itemType === 'decision')!;
    const { status, body } = await callApi(`/api/v1/evidence/${e.itemType}/${e.itemId}`);
    expect(status).toBe(200);
    expect((body as { apiVersion: string }).apiVersion).toBe('v1');
  });

  it('/api/v1/evidence/:itemType/:itemId returns apiVersion: v1 for known action item', async () => {
    const e = FIXTURE_EVIDENCE.find(x => x.itemType === 'action')!;
    const { status, body } = await callApi(`/api/v1/evidence/${e.itemType}/${e.itemId}`);
    expect(status).toBe(200);
    expect((body as { apiVersion: string }).apiVersion).toBe('v1');
  });

  it('/api/v1/evidence/:itemType/:itemId returns apiVersion: v1 for known memory item', async () => {
    const e = FIXTURE_EVIDENCE.find(x => x.itemType === 'memory')!;
    const { status, body } = await callApi(`/api/v1/evidence/${e.itemType}/${e.itemId}`);
    expect(status).toBe(200);
    expect((body as { apiVersion: string }).apiVersion).toBe('v1');
  });
});

// ── Requirement 2: 405 on unsupported methods ─────────────

describe('405 for unsupported methods', () => {
  const paths = ['/api/v1/overview', '/api/v1/topics', '/api/v1/decisions', '/api/v1/risks-actions', '/api/v1/topic-memory'];

  for (const path of paths) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      it(`${method} ${path} returns 405`, async () => {
        const { status } = await callApi(path, method);
        expect(status).toBe(405);
      });
    }
  }

  it('POST /api/v1/evidence/topic/fx-topic-001 returns 405', async () => {
    const { status } = await callApi('/api/v1/evidence/topic/fx-topic-001', 'POST');
    expect(status).toBe(405);
  });
});

// ── Requirement 3: 404 for unknown evidence items and unknown /api/v1 paths ──

describe('404 handling', () => {
  it('returns 404 for unsupported evidence item type', async () => {
    const { status } = await callApi('/api/v1/evidence/transcript/fx-topic-001');
    expect(status).toBe(404);
  });

  it('returns 404 for unknown evidence item ID with valid type', async () => {
    const { status } = await callApi('/api/v1/evidence/topic/does-not-exist');
    expect(status).toBe(404);
  });

  it('returns 404 for unknown evidence item ID with valid decision type', async () => {
    const { status } = await callApi('/api/v1/evidence/decision/does-not-exist');
    expect(status).toBe(404);
  });

  it('returns 404 for unknown /api/v1 path', async () => {
    const { status } = await callApi('/api/v1/unknown-resource');
    expect(status).toBe(404);
  });

  it('returns 404 for one-segment evidence path (missing itemId)', async () => {
    // One-segment /api/v1/evidence/topic is treated as unknown /api/v1 path
    const { status } = await callApi('/api/v1/evidence/topic');
    expect(status).toBe(404);
  });

  it('returns null (not API) for non-API paths', () => {
    const req = makeRequest('/index.html');
    const url = new URL(req.url);
    const result = routeApiRequest(req, url);
    expect(result).toBeNull();
  });
});

// ── Requirement 4: No prohibited transcript-bearing fields in any response ──

const PROHIBITED = ['transcript', 'transcriptText', 'transcriptSha256', 'r2OutputKey'];

async function getAllResponseText(): Promise<string> {
  const paths = [
    '/api/v1/overview',
    '/api/v1/topics',
    '/api/v1/decisions',
    '/api/v1/risks-actions',
    '/api/v1/topic-memory',
    ...FIXTURE_EVIDENCE.map(e => `/api/v1/evidence/${e.itemType}/${e.itemId}`),
  ];
  const texts = await Promise.all(paths.map(async p => {
    const { body } = await callApi(p);
    return JSON.stringify(body);
  }));
  return texts.join('\n');
}

describe('No transcript fields in API responses', () => {
  it('none of the prohibited fields appear in any API response', async () => {
    const allText = await getAllResponseText();
    for (const field of PROHIBITED) {
      expect(allText).not.toContain(`"${field}"`);
    }
  });
});

// ── Requirement 5: Data gaps represented as NOT_EXTRACTED ─────────

describe('Data gaps use NOT_EXTRACTED sentinel', () => {
  it('fixture topics contain NOT_EXTRACTED for absent governance attributes', () => {
    const topicsWithGap = FIXTURE_TOPICS.filter(t => t.accountableExecutive === NOT_EXTRACTED);
    expect(topicsWithGap.length).toBeGreaterThan(0);
  });

  it('decisions can have NOT_EXTRACTED owner', () => {
    const withNoOwner = FIXTURE_DECISIONS.filter(d => d.owner === NOT_EXTRACTED);
    expect(withNoOwner.length).toBeGreaterThan(0);
  });

  it('actions can have NOT_EXTRACTED due date', () => {
    const withNoDue = FIXTURE_ACTIONS.filter(a => a.dueDate === NOT_EXTRACTED);
    expect(withNoDue.length).toBeGreaterThan(0);
  });

  it('risks-actions API response contains NOT_EXTRACTED values', async () => {
    const { body } = await callApi('/api/v1/risks-actions');
    const text = JSON.stringify(body);
    expect(text).toContain('Not extracted');
  });

  it('risks-actions includes evidenceProxyNotice label', async () => {
    const { body } = await callApi('/api/v1/risks-actions');
    const data = (body as { data: typeof FIXTURE_RISKS_ACTIONS }).data;
    expect(data.evidenceProxyNotice).toContain('evidence-based proxies');
  });
});

// ── Requirement 6: At least one validation warning and one pending memory review reachable ──

describe('Validation warnings and pending memory review', () => {
  it('overview reports at least one validation warning', async () => {
    const { body } = await callApi('/api/v1/overview');
    const overview = (body as { data: typeof FIXTURE_OVERVIEW }).data;
    expect(overview.validationWarningCount).toBeGreaterThan(0);
  });

  it('overview reports at least one pending_review memory item', async () => {
    const { body } = await callApi('/api/v1/overview');
    const overview = (body as { data: typeof FIXTURE_OVERVIEW }).data;
    expect(overview.pendingReviewCount).toBeGreaterThan(0);
  });

  it('topic-memory endpoint contains at least one pending_review item with proposed match', async () => {
    const { body } = await callApi('/api/v1/topic-memory');
    const memories = (body as { data: typeof FIXTURE_TOPIC_MEMORY }).data;
    const pending = memories.filter(m => m.matchStatus === 'pending_review');
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].proposedMatchStatement).not.toBe(NOT_EXTRACTED);
  });

  it('evidence endpoint shows validation warnings for weak topic', async () => {
    const e = FIXTURE_EVIDENCE.find(x => x.itemType === 'topic' && x.validationWarnings.length > 0)!;
    const { body } = await callApi(`/api/v1/evidence/${e.itemType}/${e.itemId}`);
    const item = (body as { data: typeof FIXTURE_EVIDENCE[0] }).data;
    expect(item.validationWarnings.length).toBeGreaterThan(0);
    expect(item.dataGaps.length).toBeGreaterThan(0);
  });

  it('decisions endpoint contains at least one decision with linked topic', async () => {
    const { body } = await callApi('/api/v1/decisions');
    const decisions = (body as { data: typeof FIXTURE_DECISIONS }).data;
    const withTopic = decisions.filter(d => d.topicId !== NOT_EXTRACTED);
    expect(withTopic.length).toBeGreaterThan(0);
  });
});

// ── evidenceDetailUrl contract tests ─────────────────────

describe('API-provided evidenceDetailUrl — two-segment format', () => {
  it('decisions response contains evidenceDetailUrl for every decision', async () => {
    const { body } = await callApi('/api/v1/decisions');
    const decisions = (body as { data: Array<{ evidenceDetailUrl: string }> }).data;
    expect(decisions.length).toBeGreaterThan(0);
    for (const d of decisions) {
      expect(d.evidenceDetailUrl).toMatch(/^\/api\/v1\/evidence\/decision\/fx-decision-\d+$/);
    }
  });

  it('risks-actions response actions contain evidenceDetailUrl for every action', async () => {
    const { body } = await callApi('/api/v1/risks-actions');
    const ra = (body as { data: { actions: Array<{ evidenceDetailUrl: string }> } }).data;
    expect(ra.actions.length).toBeGreaterThan(0);
    for (const a of ra.actions) {
      expect(a.evidenceDetailUrl).toMatch(/^\/api\/v1\/evidence\/action\/fx-action-\d+$/);
    }
  });

  it('decisions response includes meetingSubject from server-side join', async () => {
    const { body } = await callApi('/api/v1/decisions');
    const decisions = (body as { data: Array<{ meetingSubject: string }> }).data;
    for (const d of decisions) {
      expect(typeof d.meetingSubject).toBe('string');
      expect(d.meetingSubject.length).toBeGreaterThan(0);
    }
  });

  it('risks-actions actions include meetingSubject from server-side join', async () => {
    const { body } = await callApi('/api/v1/risks-actions');
    const ra = (body as { data: { actions: Array<{ meetingSubject: string }> } }).data;
    for (const a of ra.actions) {
      expect(typeof a.meetingSubject).toBe('string');
      expect(a.meetingSubject.length).toBeGreaterThan(0);
    }
  });
});

// ── Topics endpoint contract tests ────────────────────────

describe('Topics endpoint', () => {
  it('topics endpoint returns array of CockpitTopic records with required fields', async () => {
    const { status, body } = await callApi('/api/v1/topics');
    expect(status).toBe(200);
    const topics = (body as { data: Array<Record<string,unknown>> }).data;
    expect(topics.length).toBeGreaterThan(0);
    for (const t of topics) {
      expect(t).toHaveProperty('topicId');
      expect(t).toHaveProperty('domain');
      expect(t).toHaveProperty('entityType');
      expect(t).toHaveProperty('aspect');
      expect(t).toHaveProperty('topicStatement');
      expect(t).toHaveProperty('validation');
    }
  });
});

// ── Fixture integrity checks ──────────────────────────────

describe('Fixture data integrity', () => {
  it('has at least two meetings', () => {
    expect(FIXTURE_OVERVIEW.meetingCount).toBeGreaterThanOrEqual(2);
  });

  it('has at least one cross-functional topic with outcome=Risk', () => {
    const riskTopics = FIXTURE_TOPICS.filter(t => t.outcome === 'Risk');
    expect(riskTopics.length).toBeGreaterThan(0);
  });

  it('has at least one topic spanning two meetings in topic memory', () => {
    const spanning = FIXTURE_TOPIC_MEMORY.filter(m => m.meetingCount > 1);
    expect(spanning.length).toBeGreaterThan(0);
    expect(spanning[0].firstSeenMeetingId).not.toBe(spanning[0].lastSeenMeetingId);
  });

  it('has at least one open action with a linked topic and owner', () => {
    const openWithOwner = FIXTURE_ACTIONS.filter(a =>
      a.status === 'open' && a.owner !== NOT_EXTRACTED && a.topicId !== NOT_EXTRACTED
    );
    expect(openWithOwner.length).toBeGreaterThan(0);
  });

  it('has at least one decision with linked topic, owner, and evidence context', () => {
    const withEvidence = FIXTURE_DECISIONS.filter(d =>
      d.topicId !== NOT_EXTRACTED && d.owner !== NOT_EXTRACTED && d.evidenceContext !== NOT_EXTRACTED
    );
    expect(withEvidence.length).toBeGreaterThan(0);
  });

  it('all fixture IDs use fx- prefix', () => {
    const allIds = [
      ...FIXTURE_TOPICS.map(t => t.topicId),
      ...FIXTURE_DECISIONS.map(d => d.decisionId),
      ...FIXTURE_ACTIONS.map(a => a.actionId),
      ...FIXTURE_TOPIC_MEMORY.map(m => m.memoryId),
    ];
    for (const id of allIds) {
      expect(id).toMatch(/^fx-/);
    }
  });

  it('risks-actions has separate risks and actions collections with evidenceProxyNotice', () => {
    expect(FIXTURE_RISKS_ACTIONS.risks.length).toBeGreaterThan(0);
    expect(FIXTURE_RISKS_ACTIONS.actions.length).toBeGreaterThan(0);
    expect(FIXTURE_RISKS_ACTIONS.evidenceProxyNotice).toBeTruthy();
  });

  it('evidence items exist for all four item types', () => {
    const types = new Set(FIXTURE_EVIDENCE.map(e => e.itemType));
    expect(types.has('topic')).toBe(true);
    expect(types.has('decision')).toBe(true);
    expect(types.has('action')).toBe(true);
    expect(types.has('memory')).toBe(true);
  });
});
