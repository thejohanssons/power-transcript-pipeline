// ============================================================
// EIP Local Cockpit Server — D1 row → Cockpit DTO mappers
// Explicit DTOs; raw rows are never passed through unmodified.
// JSON columns are parsed here; nulls are surfaced as null (not
// the 'Not extracted' sentinel, which is a UI concern).
// ============================================================

import type { MeetingRow, TopicRow, TopicMemoryRow, ActionRow, DecisionRow } from '../types/db-rows.js';

// ── Helpers ────────────────────────────────────────────────

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

interface Evidence { id: string; text: string; }

// ── Meetings ───────────────────────────────────────────────

export interface CockpitMeeting {
  meetingId: string;
  sourceSystem: string;
  nativeId: string;
  subject: string | null;
  organiser: string | null;
  eventDate: string | null;
  state: string;
  // r2OutputKey intentionally excluded: storage locator, not a business field.
  // Approved scope is D1-derived business fields only.
  createdAt: string;
  updatedAt: string;
}

export function mapMeetingsToCockpit(rows: MeetingRow[]): CockpitMeeting[] {
  return rows.map(r => ({
    meetingId: r.meeting_id,
    sourceSystem: r.source_system,
    nativeId: r.native_id,
    subject: r.subject,
    organiser: r.organiser,
    eventDate: r.event_date,
    state: r.state,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ── Topics ─────────────────────────────────────────────────

export interface CockpitTopic {
  topicId: string;
  meetingId: string;
  domain: string | null;
  entityType: string | null;
  entity: string | null;
  aspect: string | null;
  outcome: string | null;
  disposition: string | null;
  executiveScope: string | null;
  topicStatement: string;
  summary: string | null;
  keyFacts: Evidence[];
  decisions: Evidence[];
  actions: Evidence[];
  risks: Evidence[];
  owners: string[];
  confidence: string | null;
  validation: { status: string; reasons: string[] };
  memoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapTopicsToCockpit(rows: TopicRow[]): CockpitTopic[] {
  return rows.map(r => ({
    topicId: r.topic_id,
    meetingId: r.meeting_id,
    domain: r.domain,
    entityType: r.entity_type,
    entity: r.entity,
    aspect: r.aspect,
    outcome: r.outcome,
    disposition: r.disposition,
    executiveScope: r.executive_scope,
    topicStatement: r.topic_statement,
    summary: r.summary,
    keyFacts: parseJson<Evidence[]>(r.key_facts_json, []),
    decisions: parseJson<Evidence[]>(r.decisions_json, []),
    actions: parseJson<Evidence[]>(r.actions_json, []),
    risks: parseJson<Evidence[]>(r.risks_json, []),
    owners: parseJson<string[]>(r.owners_json, []),
    confidence: r.confidence,
    validation: {
      status: r.validation_status,
      reasons: parseJson<string[]>(r.validation_reasons_json, []),
    },
    memoryId: r.memory_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ── Topic Memory ───────────────────────────────────────────

export interface CockpitTopicMemory {
  memoryId: string;
  domain: string | null;
  entityType: string;
  entity: string;
  aspect: string | null;
  canonicalStatement: string;
  firstSeenMeetingId: string | null;
  lastSeenMeetingId: string | null;
  firstSeenDate: string | null;
  lastSeenDate: string | null;
  meetingCount: number;
  latestOutcome: string | null;
  latestDisposition: string | null;
  latestExecutiveScope: string | null;
  matchStatus: string;
  proposedMatchMemoryId: string | null;
  proposedMatchReason: string | null;
  mergedIntoMemoryId: string | null;
  reviewResolvedAt: string | null;
  reviewEventId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function mapTopicMemoryToCockpit(rows: TopicMemoryRow[]): CockpitTopicMemory[] {
  return rows.map(r => ({
    memoryId: r.memory_id,
    domain: r.domain,
    entityType: r.entity_type,
    entity: r.entity,
    aspect: r.aspect,
    canonicalStatement: r.canonical_statement,
    firstSeenMeetingId: r.first_seen_meeting_id,
    lastSeenMeetingId: r.last_seen_meeting_id,
    firstSeenDate: r.first_seen_date,
    lastSeenDate: r.last_seen_date,
    meetingCount: r.meeting_count,
    latestOutcome: r.latest_outcome,
    latestDisposition: r.latest_disposition,
    latestExecutiveScope: r.latest_executive_scope,
    matchStatus: r.match_status,
    proposedMatchMemoryId: r.proposed_match_memory_id,
    proposedMatchReason: r.proposed_match_reason,
    mergedIntoMemoryId: r.merged_into_memory_id ?? null,
    reviewResolvedAt: r.review_resolved_at ?? null,
    reviewEventId: r.review_event_id ?? null,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ── Actions ────────────────────────────────────────────────

export interface CockpitAction {
  actionId: string;
  meetingId: string;
  topicId: string | null;
  owner: string | null;
  text: string;
  dueDate: string | null;
  status: string;
  // Enriched from meetings/topics
  meetingSubject?: string | null;
  meetingEventDate?: string | null;
  topicStatement?: string | null;
  createdAt: string;
}

export function mapActionsToCockpit(
  rows: ActionRow[],
  meetings?: MeetingRow[],
  topics?: TopicRow[]
): CockpitAction[] {
  return rows.map(r => {
    const meeting = meetings?.find(m => m.meeting_id === r.meeting_id);
    const topic = topics?.find(t => t.topic_id === r.topic_id);
    return {
      actionId: r.action_id,
      meetingId: r.meeting_id,
      topicId: r.topic_id,
      owner: r.owner,
      text: r.text,
      dueDate: r.due_date,
      status: r.status,
      meetingSubject: meeting?.subject ?? null,
      meetingEventDate: meeting?.event_date ?? null,
      topicStatement: topic?.topic_statement ?? null,
      createdAt: r.created_at,
    };
  });
}

// ── Decisions ──────────────────────────────────────────────

export interface CockpitDecision {
  decisionId: string;
  meetingId: string;
  topicId: string | null;
  owner: string | null;
  text: string;
  // Enriched from meetings/topics
  meetingSubject?: string | null;
  meetingEventDate?: string | null;
  topicStatement?: string | null;
  createdAt: string;
}

export function mapDecisionsToCockpit(
  rows: DecisionRow[],
  meetings?: MeetingRow[],
  topics?: TopicRow[]
): CockpitDecision[] {
  return rows.map(r => {
    const meeting = meetings?.find(m => m.meeting_id === r.meeting_id);
    const topic = topics?.find(t => t.topic_id === r.topic_id);
    return {
      decisionId: r.decision_id,
      meetingId: r.meeting_id,
      topicId: r.topic_id,
      owner: r.owner,
      text: r.text,
      meetingSubject: meeting?.subject ?? null,
      meetingEventDate: meeting?.event_date ?? null,
      topicStatement: topic?.topic_statement ?? null,
      createdAt: r.created_at,
    };
  });
}

// ── Overview ───────────────────────────────────────────────

export interface CockpitOverview {
  generatedAt: string;
  meetingCount: number;
  topicCount: number;
  decisionCount: number;
  openActionCount: number;
  topicMemoryCount: number;
  pendingReviewCount: number;
  validationWarningCount: number;
  meetings: CockpitMeeting[];
}

export function buildOverview(
  meetings: MeetingRow[],
  topics: TopicRow[],
  actions: ActionRow[],
  decisions: DecisionRow[],
  memory: TopicMemoryRow[]
): CockpitOverview {
  return {
    generatedAt: new Date().toISOString(),
    meetingCount: meetings.length,
    topicCount: topics.length,
    decisionCount: decisions.length,
    openActionCount: actions.filter(a => a.status === 'open').length,
    topicMemoryCount: memory.filter(m => !m.merged_into_memory_id && m.match_status !== 'merged').length,
    pendingReviewCount: memory.filter(m => !m.merged_into_memory_id && m.match_status === 'pending_review').length,
    validationWarningCount: topics.filter(t => t.validation_status !== 'pass').length,
    meetings: mapMeetingsToCockpit(meetings),
  };
}
