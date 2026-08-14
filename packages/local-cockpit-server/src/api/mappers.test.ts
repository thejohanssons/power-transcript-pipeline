// ============================================================
// EIP Local Cockpit Server — Mapper tests (Step 9)
//
// Proves that:
// 1. D1 rows are correctly mapped to cockpit DTOs
// 2. JSON columns are parsed (not passed as raw strings)
// 3. Null values are surfaced as null (not as sentinel strings)
// 4. Overview counts are correct
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  mapMeetingsToCockpit,
  mapTopicsToCockpit,
  mapTopicMemoryToCockpit,
  mapActionsToCockpit,
  mapDecisionsToCockpit,
  buildOverview,
} from './mappers.js';
import type { MeetingRow, TopicRow, TopicMemoryRow, ActionRow, DecisionRow } from '../types/db-rows.js';

// ── Fixtures ───────────────────────────────────────────────

const MEETING_ROW: MeetingRow = {
  meeting_id: 'mtg-001',
  source_system: 'azure',
  native_id: 'teams-native-001',
  subject: 'ExCo Daily',
  organiser: 'Alice',
  event_date: '2026-08-11',
  transcript_sha256: 'abc123',  // schema fact retained in MeetingRow type; excluded from DTO
  state: 'completed',
  error_message: null,
  r2_output_key: 'meetings/2026-08-11/output.json',  // schema fact retained in MeetingRow type; excluded from DTO
  created_at: '2026-08-11T10:00:00',
  updated_at: '2026-08-11T10:05:00',
};

const TOPIC_ROW: TopicRow = {
  topic_id: 'topic-001',
  meeting_id: 'mtg-001',
  domain: 'Product Management',
  entity_type: 'Product',
  entity: 'Reader 3',
  aspect: 'Schedule',
  outcome: 'Risk',
  disposition: 'Action',
  executive_scope: 'Strategic',
  topic_statement: 'Reader 3 launch is at risk due to supply constraints.',
  summary: 'PCB supply shortage threatens Q3 launch.',
  key_facts_json: '[{"id":"kf-1","text":"PCB lead time is 16 weeks"}]',
  decisions_json: '[]',
  actions_json: '[{"id":"act-1","text":"Expedite PCB order"}]',
  risks_json: '[{"id":"r-1","text":"Launch delayed by 4 weeks"}]',
  owners_json: '["CPO","COO"]',
  confidence: 'high',
  validation_status: 'warning',
  validation_reasons_json: '["Missing accountable executive"]',
  memory_id: 'mem-001',
  created_at: '2026-08-11T10:00:00',
  updated_at: '2026-08-11T10:05:00',
};

const ACTION_ROW: ActionRow = {
  action_id: 'act-001',
  meeting_id: 'mtg-001',
  topic_id: 'topic-001',
  owner: 'COO',
  text: 'Expedite PCB supplier order',
  due_date: '2026-08-20',
  status: 'open',
  created_at: '2026-08-11T10:00:00',
  updated_at: '2026-08-11T10:00:00',
};

const DECISION_ROW: DecisionRow = {
  decision_id: 'dec-001',
  meeting_id: 'mtg-001',
  topic_id: 'topic-001',
  owner: 'CPO',
  text: 'Approve emergency PCB procurement budget',
  created_at: '2026-08-11T10:00:00',
  updated_at: '2026-08-11T10:00:00',
};

const MEMORY_ROW: TopicMemoryRow = {
  memory_id: 'mem-001',
  domain: 'Product Management',
  entity_type: 'Product',
  entity: 'Reader 3',
  aspect: 'Schedule',
  canonical_statement: 'Reader 3 launch risk due to supply.',
  first_seen_meeting_id: 'mtg-001',
  last_seen_meeting_id: 'mtg-001',
  first_seen_date: '2026-08-11',
  last_seen_date: '2026-08-11',
  meeting_count: 1,
  latest_outcome: 'Risk',
  latest_disposition: 'Action',
  latest_executive_scope: 'Strategic',
  match_status: 'pending_review',
  proposed_match_memory_id: null,
  proposed_match_reason: null,
  status: 'open',
  created_at: '2026-08-11T10:00:00',
  updated_at: '2026-08-11T10:00:00',
};

// ── Meeting mapper ─────────────────────────────────────────

describe('mapMeetingsToCockpit', () => {
  it('maps business fields correctly', () => {
    const [m] = mapMeetingsToCockpit([MEETING_ROW]);
    expect(m.meetingId).toBe('mtg-001');
    expect(m.subject).toBe('ExCo Daily');
    expect(m.organiser).toBe('Alice');
    expect(m.state).toBe('completed');
    // r2OutputKey must not appear in the DTO
    expect((m as unknown as Record<string, unknown>).r2OutputKey).toBeUndefined();
  });

  it('returns empty array for empty input', () => {
    expect(mapMeetingsToCockpit([])).toEqual([]);
  });
});

// ── Topic mapper ───────────────────────────────────────────

describe('mapTopicsToCockpit', () => {
  it('parses JSON columns into arrays', () => {
    const [t] = mapTopicsToCockpit([TOPIC_ROW]);
    expect(t.keyFacts).toEqual([{ id: 'kf-1', text: 'PCB lead time is 16 weeks' }]);
    expect(t.owners).toEqual(['CPO', 'COO']);
    expect(t.risks).toEqual([{ id: 'r-1', text: 'Launch delayed by 4 weeks' }]);
  });

  it('falls back to empty array for null JSON columns', () => {
    const nullRow: TopicRow = { ...TOPIC_ROW, key_facts_json: null, owners_json: null };
    const [t] = mapTopicsToCockpit([nullRow]);
    expect(t.keyFacts).toEqual([]);
    expect(t.owners).toEqual([]);
  });

  it('maps validation correctly', () => {
    const [t] = mapTopicsToCockpit([TOPIC_ROW]);
    expect(t.validation.status).toBe('warning');
    expect(t.validation.reasons).toEqual(['Missing accountable executive']);
  });

  it('passes null fields as null (not sentinel string)', () => {
    const nullRow: TopicRow = { ...TOPIC_ROW, summary: null, domain: null };
    const [t] = mapTopicsToCockpit([nullRow]);
    expect(t.summary).toBeNull();
    expect(t.domain).toBeNull();
  });
});

// ── Action mapper ──────────────────────────────────────────

describe('mapActionsToCockpit', () => {
  it('enriches with meeting and topic data', () => {
    const [a] = mapActionsToCockpit([ACTION_ROW], [MEETING_ROW], [TOPIC_ROW]);
    expect(a.meetingSubject).toBe('ExCo Daily');
    expect(a.meetingEventDate).toBe('2026-08-11');
    expect(a.topicStatement).toBe('Reader 3 launch is at risk due to supply constraints.');
  });

  it('sets null enrichment when meeting/topic not found', () => {
    const [a] = mapActionsToCockpit([ACTION_ROW], [], []);
    expect(a.meetingSubject).toBeNull();
    expect(a.topicStatement).toBeNull();
  });
});

// ── Decision mapper ────────────────────────────────────────

describe('mapDecisionsToCockpit', () => {
  it('enriches with meeting and topic data', () => {
    const [d] = mapDecisionsToCockpit([DECISION_ROW], [MEETING_ROW], [TOPIC_ROW]);
    expect(d.meetingSubject).toBe('ExCo Daily');
    expect(d.topicStatement).toBe('Reader 3 launch is at risk due to supply constraints.');
  });
});

// ── Topic memory mapper ────────────────────────────────────

describe('mapTopicMemoryToCockpit', () => {
  it('maps all fields correctly', () => {
    const [m] = mapTopicMemoryToCockpit([MEMORY_ROW]);
    expect(m.memoryId).toBe('mem-001');
    expect(m.entity).toBe('Reader 3');
    expect(m.matchStatus).toBe('pending_review');
    expect(m.meetingCount).toBe(1);
    expect(m.mergedIntoMemoryId).toBeNull();
    expect(m.reviewResolvedAt).toBeNull();
    expect(m.reviewEventId).toBeNull();
  });
});

// ── Overview builder ───────────────────────────────────────

describe('buildOverview', () => {
  it('computes correct counts', () => {
    const openAction: ActionRow = { ...ACTION_ROW, status: 'open' };
    const closedAction: ActionRow = { ...ACTION_ROW, action_id: 'act-002', status: 'completed' };
    const overview = buildOverview(
      [MEETING_ROW],
      [TOPIC_ROW],
      [openAction, closedAction],
      [DECISION_ROW],
      [MEMORY_ROW],
    );
    expect(overview.meetingCount).toBe(1);
    expect(overview.topicCount).toBe(1);
    expect(overview.decisionCount).toBe(1);
    expect(overview.openActionCount).toBe(1);  // only open actions
    expect(overview.topicMemoryCount).toBe(1);
    expect(overview.pendingReviewCount).toBe(1);  // pending_review memory

    const mergedMemory = { ...MEMORY_ROW, memory_id: 'mem-merged', match_status: 'merged', merged_into_memory_id: 'mem-001' };
    const rootOnlyOverview = buildOverview([MEETING_ROW], [TOPIC_ROW], [openAction], [DECISION_ROW], [MEMORY_ROW, mergedMemory]);
    expect(rootOnlyOverview.topicMemoryCount).toBe(1);
    expect(rootOnlyOverview.pendingReviewCount).toBe(1);
    expect(overview.validationWarningCount).toBe(1);  // topic has 'warning' status
  });

  it('includes generatedAt as ISO string', () => {
    const overview = buildOverview([], [], [], [], []);
    expect(new Date(overview.generatedAt).toISOString()).toBe(overview.generatedAt);
  });
});
