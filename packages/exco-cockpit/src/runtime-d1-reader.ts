// ============================================================
// EIP ExCo Cockpit — constrained runtime D1 read model
//
// This module is intentionally read-only. Every query is fixed, selects an
// explicit business-field allow-list, and never returns D1 rows directly.
// ============================================================

import {
  NOT_EXTRACTED,
  type CockpitAction,
  type CockpitDecision,
  type CockpitOverview,
  type CockpitRisk,
  type CockpitTopic,
  type CockpitTopicMemory,
  type RuntimeReviewDecisionRecord,
  type EvidenceAssertion,
  type EvidenceItem,
  type MeetingSummary,
  type RisksActionsResponse,
  type ValidationResult,
} from './types';

export interface RuntimeD1Reader {
  getOverview(): Promise<CockpitOverview>;
  getTopics(): Promise<CockpitTopic[]>;
  getDecisions(): Promise<CockpitDecision[]>;
  getRisksActions(): Promise<RisksActionsResponse>;
  getTopicMemory(): Promise<CockpitTopicMemory[]>;
  getTopicMemoryById(memoryId: string): Promise<CockpitTopicMemory | null>;
  getReviewQueue(): Promise<ReviewQueue>;
  getEvidence(itemType: EvidenceItem['itemType'], itemId: string): Promise<EvidenceItem | null>;
}

export interface ReviewQueue {
  generatedAt: string;
  awaitingReview: ReviewQueueItem[];
  recordedDecisions: RuntimeReviewDecisionRecord[];
}

export interface ReviewQueueItem {
  itemType: 'memory';
  itemId: string;
  sourceKind: 'd1';
  sourceVersion: string;
  candidateStatus: 'pending_review';
  title: string;
  summary: null;
  entityType: string;
  entity: string;
  aspect: CockpitTopicMemory['aspect'];
  proposedMatchMemoryId?: string;
  proposedMatchReason?: string;
  updatedAt: string;
  disposition: null;
}

interface MeetingRow {
  meeting_id: string;
  subject: string | null;
  organiser: string | null;
  event_date: string | null;
}

interface TopicRow {
  topic_id: string;
  meeting_id: string;
  domain: string | null;
  entity_type: string | null;
  entity: string | null;
  aspect: string | null;
  outcome: string | null;
  disposition: string | null;
  executive_scope: string | null;
  topic_statement: string;
  summary: string | null;
  key_facts_json: string | null;
  decisions_json: string | null;
  actions_json: string | null;
  risks_json: string | null;
  owners_json: string | null;
  confidence: string | null;
  validation_status: string;
  validation_reasons_json: string | null;
  updated_at: string;
}

interface ActionRow {
  action_id: string;
  meeting_id: string;
  topic_id: string | null;
  owner: string | null;
  text: string;
  due_date: string | null;
  status: string;
  updated_at: string;
}

interface DecisionRow {
  decision_id: string;
  meeting_id: string;
  topic_id: string | null;
  owner: string | null;
  text: string;
  updated_at: string;
}

interface MemoryRow {
  memory_id: string;
  domain: string | null;
  entity_type: string;
  entity: string;
  aspect: string | null;
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
  review_resolved_at: string | null;
  review_event_id: string | null;
  status: string;
  updated_at: string;
}

interface ReviewEventRow {
  review_event_id: string;
  candidate_memory_id: string;
  target_memory_id: string;
  decision: string;
  reviewer_name: string;
  reviewer_note: string;
  candidate_match_status_after: string;
  created_at: string;
}

const RISKS_NOTICE = 'Risks shown here are evidence-based proxies derived from Risk-outcome topics and extracted risk assertions. This is not a complete governed risk register.';
const RISK_LABEL = 'Evidence proxy — not a complete governed risk register';

function extracted(value: string | null): string | typeof NOT_EXTRACTED {
  return value ?? NOT_EXTRACTED;
}

function extractedArray(value: string[] | null): string[] | typeof NOT_EXTRACTED {
  return value && value.length > 0 ? value : NOT_EXTRACTED;
}

function knownStatus(value: string): ValidationResult['status'] {
  return value === 'warning' || value === 'fail' ? value : 'pass';
}

function actionStatus(value: string): CockpitAction['status'] {
  return value === 'completed' || value === 'cancelled' ? value : 'open';
}

function memoryStatus(value: string): CockpitTopicMemory['status'] {
  return value === 'resolved' || value === 'closed' || value === 'watching' ? value : 'open';
}

function memoryMatchStatus(value: string): CockpitTopicMemory['matchStatus'] {
  return value === 'pending_review' || value === 'merged' ? value : 'confirmed';
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeAssertions(raw: string | null): EvidenceAssertion[] {
  const candidate = parseJson<unknown>(raw, []);
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as { id?: unknown; text?: unknown };
    if (typeof record.text !== 'string') return [];
    return [{ id: typeof record.id === 'string' ? record.id : `assertion-${index + 1}`, text: record.text }];
  });
}

function safeStrings(raw: string | null): string[] {
  const candidate = parseJson<unknown>(raw, []);
  return Array.isArray(candidate) ? candidate.filter((value): value is string => typeof value === 'string') : [];
}

function mapTopic(row: TopicRow): CockpitTopic {
  return {
    topicId: row.topic_id,
    meetingId: row.meeting_id,
    domain: extracted(row.domain),
    entityType: extracted(row.entity_type),
    entity: extracted(row.entity),
    aspect: extracted(row.aspect),
    outcome: extracted(row.outcome),
    disposition: extracted(row.disposition),
    executiveScope: extracted(row.executive_scope),
    topicStatement: row.topic_statement,
    summary: extracted(row.summary),
    keyFacts: safeAssertions(row.key_facts_json),
    risks: safeAssertions(row.risks_json),
    owners: extractedArray(safeStrings(row.owners_json)),
    // The runtime schema does not separately model an accountable executive.
    accountableExecutive: NOT_EXTRACTED,
    confidence: extracted(row.confidence),
    validation: { status: knownStatus(row.validation_status), reasons: safeStrings(row.validation_reasons_json) },
    updatedAt: row.updated_at,
  };
}

function mapMemory(row: MemoryRow, proposedStatement: string | null): CockpitTopicMemory {
  return {
    memoryId: row.memory_id,
    domain: extracted(row.domain),
    entityType: row.entity_type,
    entity: row.entity,
    aspect: extracted(row.aspect),
    canonicalStatement: row.canonical_statement,
    firstSeenMeetingId: row.first_seen_meeting_id ?? '',
    lastSeenMeetingId: row.last_seen_meeting_id ?? '',
    firstSeenDate: row.first_seen_date ?? '',
    lastSeenDate: row.last_seen_date ?? '',
    meetingCount: row.meeting_count,
    latestOutcome: extracted(row.latest_outcome),
    latestDisposition: extracted(row.latest_disposition),
    latestExecutiveScope: extracted(row.latest_executive_scope),
    matchStatus: memoryMatchStatus(row.match_status),
    proposedMatchStatement: proposedStatement ?? NOT_EXTRACTED,
    ...(row.proposed_match_memory_id ? { proposedMatchMemoryId: row.proposed_match_memory_id } : {}),
    ...(row.proposed_match_reason ? { proposedMatchReason: row.proposed_match_reason } : {}),
    mergedIntoMemoryId: row.merged_into_memory_id,
    reviewResolvedAt: row.review_resolved_at,
    reviewEventId: row.review_event_id,
    updatedAt: row.updated_at,
    status: memoryStatus(row.status),
  };
}

export function createRuntimeD1Reader(db: D1Database): RuntimeD1Reader {
  async function all<T>(sql: string, ...parameters: unknown[]): Promise<T[]> {
    const statement = parameters.length > 0 ? db.prepare(sql).bind(...parameters) : db.prepare(sql);
    const result = await statement.all<T>();
    return result.results;
  }

  async function meetings(): Promise<MeetingRow[]> {
    return all<MeetingRow>(`SELECT meeting_id, subject, organiser, event_date
      FROM meetings ORDER BY event_date DESC, meeting_id DESC LIMIT 500`);
  }

  async function topics(): Promise<TopicRow[]> {
    return all<TopicRow>(`SELECT topic_id, meeting_id, domain, entity_type, entity, aspect,
      outcome, disposition, executive_scope, topic_statement, summary, key_facts_json,
      decisions_json, actions_json, risks_json, owners_json, confidence, validation_status,
      validation_reasons_json, updated_at FROM topics ORDER BY created_at DESC, topic_id DESC LIMIT 1000`);
  }

  async function actions(): Promise<ActionRow[]> {
    return all<ActionRow>(`SELECT action_id, meeting_id, topic_id, owner, text, due_date, status
      updated_at FROM actions ORDER BY created_at DESC, action_id DESC LIMIT 1000`);
  }

  async function decisions(): Promise<DecisionRow[]> {
    return all<DecisionRow>(`SELECT decision_id, meeting_id, topic_id, owner, text
      updated_at FROM decisions ORDER BY created_at DESC, decision_id DESC LIMIT 1000`);
  }

  async function memory(): Promise<MemoryRow[]> {
    return all<MemoryRow>(`SELECT memory_id, domain, entity_type, entity, aspect, canonical_statement,
      first_seen_meeting_id, last_seen_meeting_id, first_seen_date, last_seen_date, meeting_count,
      latest_outcome, latest_disposition, latest_executive_scope, match_status,
      proposed_match_memory_id, proposed_match_reason, merged_into_memory_id, review_resolved_at,
      review_event_id, status, updated_at FROM topic_memory
      WHERE status <> 'invalidated'
      ORDER BY last_seen_date DESC, memory_id DESC LIMIT 1000`);
  }

  async function reviewEvents(): Promise<ReviewEventRow[]> {
    return all<ReviewEventRow>(`SELECT review_event_id, candidate_memory_id, target_memory_id, decision,
      reviewer_name, reviewer_note, candidate_match_status_after, created_at
      FROM topic_memory_review_events ORDER BY created_at DESC, review_event_id DESC LIMIT 500`);
  }

  async function snapshot() {
    const [meetingRows, topicRows, actionRows, decisionRows, memoryRows] = await Promise.all([
      meetings(), topics(), actions(), decisions(), memory(),
    ]);
    const topicDtos = topicRows.map(mapTopic);
    const memoryById = new Map(memoryRows.map(row => [row.memory_id, row.canonical_statement]));
    return { meetingRows, topicRows, actionRows, decisionRows, memoryRows, topicDtos, memoryById };
  }

  function meetingSummaries(meetingRows: MeetingRow[], topicRows: TopicRow[], actionRows: ActionRow[], decisionRows: DecisionRow[]): MeetingSummary[] {
    return meetingRows.map(meeting => {
      const meetingTopics = topicRows.filter(topic => topic.meeting_id === meeting.meeting_id);
      return {
        meetingId: meeting.meeting_id,
        subject: meeting.subject ?? NOT_EXTRACTED,
        organiser: meeting.organiser ?? NOT_EXTRACTED,
        eventDate: meeting.event_date ?? '',
        topicCount: meetingTopics.length,
        actionCount: actionRows.filter(action => action.meeting_id === meeting.meeting_id).length,
        decisionCount: decisionRows.filter(decision => decision.meeting_id === meeting.meeting_id).length,
        validationStatus: meetingTopics.some(topic => topic.validation_status === 'fail') ? 'fail'
          : meetingTopics.some(topic => topic.validation_status === 'warning') ? 'warning' : 'pass',
      };
    });
  }

  return {
    async getOverview() {
      const data = await snapshot();
      return {
        generatedAt: new Date().toISOString(),
        meetingCount: data.meetingRows.length,
        topicCount: data.topicRows.length,
        decisionCount: data.decisionRows.length,
        openActionCount: data.actionRows.filter(action => action.status === 'open').length,
        topicMemoryCount: data.memoryRows.filter(row => !row.merged_into_memory_id && row.match_status !== 'merged').length,
        pendingReviewCount: data.memoryRows.filter(row => !row.merged_into_memory_id && row.match_status === 'pending_review').length,
        validationWarningCount: data.topicRows.filter(topic => topic.validation_status !== 'pass').length,
        meetings: meetingSummaries(data.meetingRows, data.topicRows, data.actionRows, data.decisionRows),
      };
    },

    async getTopics() {
      return (await topics()).map(mapTopic);
    },

    async getDecisions() {
      const [decisionRows, meetingRows, topicRows] = await Promise.all([decisions(), meetings(), topics()]);
      const meetingById = new Map(meetingRows.map(meeting => [meeting.meeting_id, meeting]));
      const topicById = new Map(topicRows.map(topic => [topic.topic_id, mapTopic(topic)]));
      return decisionRows.map(row => {
        const meeting = meetingById.get(row.meeting_id);
        const topic = row.topic_id ? topicById.get(row.topic_id) : undefined;
        return {
          decisionId: row.decision_id, meetingId: row.meeting_id, topicId: row.topic_id ?? NOT_EXTRACTED,
          owner: extracted(row.owner), text: row.text, evidenceContext: NOT_EXTRACTED,
          meetingSubject: meeting?.subject ?? NOT_EXTRACTED, meetingEventDate: meeting?.event_date ?? '',
          evidenceDetailUrl: `/api/v1/evidence/decision/${encodeURIComponent(row.decision_id)}`,
          topicStatement: topic?.topicStatement ?? NOT_EXTRACTED, topicDomain: topic?.domain ?? NOT_EXTRACTED,
          topicEntityType: topic?.entityType ?? NOT_EXTRACTED, topicEntity: topic?.entity ?? NOT_EXTRACTED,
          updatedAt: row.updated_at,
        };
      });
    },

    async getRisksActions() {
      const [actionRows, meetingRows, topicRows] = await Promise.all([actions(), meetings(), topics()]);
      const meetingById = new Map(meetingRows.map(meeting => [meeting.meeting_id, meeting]));
      const topicById = new Map(topicRows.map(topic => [topic.topic_id, mapTopic(topic)]));
      const cockpitActions: CockpitAction[] = actionRows.map(row => {
        const meeting = meetingById.get(row.meeting_id);
        const topic = row.topic_id ? topicById.get(row.topic_id) : undefined;
        return {
          actionId: row.action_id, meetingId: row.meeting_id, topicId: row.topic_id ?? NOT_EXTRACTED,
          owner: extracted(row.owner), text: row.text, dueDate: extracted(row.due_date), status: actionStatus(row.status),
          meetingSubject: meeting?.subject ?? NOT_EXTRACTED, meetingEventDate: meeting?.event_date ?? '',
          evidenceDetailUrl: `/api/v1/evidence/action/${encodeURIComponent(row.action_id)}`,
          topicStatement: topic?.topicStatement ?? NOT_EXTRACTED, topicDomain: topic?.domain ?? NOT_EXTRACTED,
          topicEntityType: topic?.entityType ?? NOT_EXTRACTED, topicEntity: topic?.entity ?? NOT_EXTRACTED,
          updatedAt: row.updated_at,
        };
      });
      const risks: CockpitRisk[] = topicRows.flatMap(row => {
        if (row.outcome !== 'Risk') return [];
        const owner = extracted(safeStrings(row.owners_json)[0] ?? null);
        const assertions = safeAssertions(row.risks_json);
        const riskTexts = assertions.length > 0 ? assertions.map(item => item.text) : [row.summary ?? row.topic_statement];
        return riskTexts.map((riskText, index) => ({
          riskId: `topic:${row.topic_id}:${index + 1}`, meetingId: row.meeting_id, topicId: row.topic_id,
          topicStatement: row.topic_statement, riskText, owner,
          evidenceDetailUrl: `/api/v1/evidence/topic/${encodeURIComponent(row.topic_id)}`,
          evidenceLabel: RISK_LABEL,
          topicDomain: extracted(row.domain), topicEntityType: extracted(row.entity_type), topicEntity: extracted(row.entity),
        }));
      });
      return { evidenceProxyNotice: RISKS_NOTICE, risks, actions: cockpitActions };
    },

    async getTopicMemory() {
      const rows = await memory();
      const statements = new Map(rows.map(row => [row.memory_id, row.canonical_statement]));
      // Keep the list root-based, matching overview counts and the Cockpit UI's
      // merged-observation grouping. A merged row remains addressable by ID.
      return rows
        .filter(row => !row.merged_into_memory_id && row.match_status !== 'merged')
        .map(row => mapMemory(row, row.proposed_match_memory_id ? statements.get(row.proposed_match_memory_id) ?? null : null));
    },

    async getTopicMemoryById(memoryId) {
      const rows = await all<MemoryRow>(`SELECT memory_id, domain, entity_type, entity, aspect, canonical_statement,
        first_seen_meeting_id, last_seen_meeting_id, first_seen_date, last_seen_date, meeting_count,
        latest_outcome, latest_disposition, latest_executive_scope, match_status,
        proposed_match_memory_id, proposed_match_reason, merged_into_memory_id, review_resolved_at,
        review_event_id, status, updated_at FROM topic_memory WHERE memory_id = ? AND status <> 'invalidated' LIMIT 1`, memoryId);
      const row = rows[0];
      if (!row) return null;
      let proposedStatement: string | null = null;
      if (row.proposed_match_memory_id) {
        const proposed = await all<Pick<MemoryRow, 'canonical_statement'>>(
          'SELECT canonical_statement FROM topic_memory WHERE memory_id = ? LIMIT 1', row.proposed_match_memory_id,
        );
        proposedStatement = proposed[0]?.canonical_statement ?? null;
      }
      return mapMemory(row, proposedStatement);
    },

    async getReviewQueue() {
      const [rows, events] = await Promise.all([memory(), reviewEvents()]);
      return {
        generatedAt: new Date().toISOString(),
        awaitingReview: rows.filter(row => row.match_status === 'pending_review' && !row.merged_into_memory_id).map(row => ({
          itemType: 'memory', itemId: row.memory_id, sourceKind: 'd1', sourceVersion: row.updated_at,
          candidateStatus: 'pending_review', title: row.canonical_statement, summary: null,
          entityType: row.entity_type, entity: row.entity, aspect: extracted(row.aspect),
          ...(row.proposed_match_memory_id ? { proposedMatchMemoryId: row.proposed_match_memory_id } : {}),
          ...(row.proposed_match_reason ? { proposedMatchReason: row.proposed_match_reason } : {}),
          updatedAt: row.updated_at, disposition: null,
        })),
        recordedDecisions: events.flatMap(event => {
          if ((event.decision !== 'approve_match' && event.decision !== 'reject_match') ||
            (event.candidate_match_status_after !== 'merged' && event.candidate_match_status_after !== 'confirmed')) return [];
          return [{
            reviewEventId: event.review_event_id,
            candidateMemoryId: event.candidate_memory_id,
            targetMemoryId: event.target_memory_id,
            decision: event.decision,
            reviewerName: event.reviewer_name,
            reviewerNote: event.reviewer_note,
            candidateMatchStatusAfter: event.candidate_match_status_after,
            createdAt: event.created_at,
          }];
        }),
      };
    },

    async getEvidence(itemType, itemId) {
      const data = await snapshot();
      const topicForId = (topicId: string | null) => topicId ? data.topicRows.find(topic => topic.topic_id === topicId) : undefined;
      const evidenceForTopic = (topic: TopicRow, meetingId = topic.meeting_id): EvidenceItem => {
        const meeting = data.meetingRows.find(row => row.meeting_id === meetingId);
        return {
          itemId, itemType, meetingSubject: meeting?.subject ?? NOT_EXTRACTED, eventDate: meeting?.event_date ?? '',
          keyFacts: safeAssertions(topic.key_facts_json), decisions: safeAssertions(topic.decisions_json),
          actions: safeAssertions(topic.actions_json), risks: safeAssertions(topic.risks_json),
          validationWarnings: topic.validation_status === 'pass' ? [] : safeStrings(topic.validation_reasons_json),
          dataGaps: [
            ...(topic.summary ? [] : ['summary']), ...(safeStrings(topic.owners_json).length ? [] : ['owners']),
            ...(topic.confidence ? [] : ['confidence']), 'accountableExecutive',
          ],
        };
      };
      if (itemType === 'topic') {
        const topic = data.topicRows.find(row => row.topic_id === itemId);
        return topic ? evidenceForTopic(topic) : null;
      }
      if (itemType === 'decision') {
        const decision = data.decisionRows.find(row => row.decision_id === itemId);
        const topic = decision ? topicForId(decision.topic_id) : undefined;
        if (!decision || !topic) return null;
        return evidenceForTopic(topic, decision.meeting_id);
      }
      if (itemType === 'action') {
        const action = data.actionRows.find(row => row.action_id === itemId);
        const topic = action ? topicForId(action.topic_id) : undefined;
        if (!action || !topic) return null;
        return evidenceForTopic(topic, action.meeting_id);
      }
      const memoryRow = data.memoryRows.find(row => row.memory_id === itemId);
      if (!memoryRow) return null;
      const relatedTopics = data.topicRows.filter(topic => topic.meeting_id === memoryRow.last_seen_meeting_id);
      const topic = relatedTopics.find(candidate => candidate.topic_statement === memoryRow.canonical_statement) ?? relatedTopics[0];
      if (!topic) return null;
      return evidenceForTopic(topic, memoryRow.last_seen_meeting_id ?? undefined);
    },
  };
}
