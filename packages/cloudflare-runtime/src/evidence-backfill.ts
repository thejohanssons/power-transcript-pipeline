import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { MeetingOutput, TopicRecord } from './types';

const BATCH_SIZE = 50;

type StoredTopic = Partial<TopicRecord> & Record<string, unknown>;

type BackfillRow = {
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
  keyFacts: unknown[];
  decisions: unknown[];
  actions: unknown[];
  risks: unknown[];
  validationStatus: string;
  validationReasons: string[];
};

export interface EvidenceBackfillResult {
  meetingsScanned: number;
  meetingsUpdated: number;
  topicsUpdated: number;
  topicsMissingFromOutput: number;
  outputsMissing: number;
  outputsInvalid: number;
}

function firstValue<T>(value: unknown, fallback: unknown): T | undefined {
  return (value === undefined ? fallback : value) as T | undefined;
}

function arrayValue(value: unknown, fallback: unknown): unknown[] {
  const selected = firstValue(value, fallback);
  if (Array.isArray(selected)) return selected;
  if (typeof selected === 'string') {
    try {
      const parsed = JSON.parse(selected) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function stringValue(value: unknown, fallback: unknown = null): string | null {
  const selected = firstValue(value, fallback);
  return typeof selected === 'string' && selected.trim() ? selected : null;
}

function toBackfillRow(topic: StoredTopic, meetingId: string): BackfillRow | null {
  const topicId = stringValue(firstValue(topic.topicId, topic.topic_id));
  const topicStatement = stringValue(firstValue(topic.topicStatement, topic.topic_statement), '');
  if (!topicId || topicStatement === null) return null;

  const validation = (topic.validation ?? {}) as Record<string, unknown>;
  return {
    topicId,
    meetingId,
    domain: stringValue(firstValue(topic.domain, topic.DOMAIN)),
    entityType: stringValue(firstValue(topic.entityType, topic.entity_type)),
    entity: stringValue(topic.entity),
    aspect: stringValue(topic.aspect),
    outcome: stringValue(topic.outcome),
    disposition: stringValue(topic.disposition),
    executiveScope: stringValue(firstValue(topic.executiveScope, topic.executive_scope)),
    topicStatement,
    summary: stringValue(topic.summary),
    keyFacts: arrayValue(topic.keyFacts, topic.key_facts),
    decisions: arrayValue(topic.decisions, topic.decisions_json),
    actions: arrayValue(topic.actions, topic.actions_json),
    risks: arrayValue(topic.risks, topic.risks_json),
    validationStatus: stringValue(validation.status, topic.validation_status) ?? 'pass',
    validationReasons: arrayValue(validation.reasons, topic.validation_reasons_json)
      .filter((reason): reason is string => typeof reason === 'string'),
  };
}

export function buildEvidenceBackfillSql(): string {
  return `UPDATE topics SET
    domain = ?, entity_type = ?, entity = ?, aspect = ?, outcome = ?, disposition = ?,
    executive_scope = ?, topic_statement = ?, summary = ?, key_facts_json = ?,
    decisions_json = ?, actions_json = ?, risks_json = ?, validation_status = ?,
    validation_reasons_json = ?, updated_at = datetime('now')
  WHERE topic_id = ? AND meeting_id = ?`;
}

export function buildEvidenceBackfillParams(row: BackfillRow): (string | null)[] {
  return [
    row.domain,
    row.entityType,
    row.entity,
    row.aspect,
    row.outcome,
    row.disposition,
    row.executiveScope,
    row.topicStatement,
    row.summary,
    JSON.stringify(row.keyFacts),
    JSON.stringify(row.decisions),
    JSON.stringify(row.actions),
    JSON.stringify(row.risks),
    row.validationStatus,
    JSON.stringify(row.validationReasons),
    row.topicId,
    row.meetingId,
  ];
}

async function updateMeetingTopics(db: D1Database, bucket: R2Bucket, meetingId: string, r2Key: string): Promise<'updated' | 'missing' | 'invalid' | number> {
  const object = await bucket.get(r2Key);
  if (!object) return 'missing';

  let output: Partial<MeetingOutput>;
  try {
    output = await object.json<Partial<MeetingOutput>>();
  } catch {
    return 'invalid';
  }

  const rows = (Array.isArray(output.topics) ? output.topics : [])
    .map((topic) => toBackfillRow(topic as StoredTopic, meetingId))
    .filter((topic): topic is BackfillRow => topic !== null);

  let updated = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const statements = rows.slice(offset, offset + BATCH_SIZE).map((row) =>
      db.prepare(buildEvidenceBackfillSql()).bind(...buildEvidenceBackfillParams(row)));
    await db.batch(statements);
    // Count matched topic rows, not only rows whose values changed, so reruns report accurately.
    updated += statements.length;
  }
  return updated;
}

export async function backfillAllTopicEvidence(db: D1Database, bucket: R2Bucket): Promise<EvidenceBackfillResult> {
  const meetings = await db.prepare(
    "SELECT meeting_id, r2_output_key FROM meetings WHERE r2_output_key IS NOT NULL ORDER BY meeting_id",
  ).all<{ meeting_id: string; r2_output_key: string }>();

  const result: EvidenceBackfillResult = {
    meetingsScanned: meetings.results.length,
    meetingsUpdated: 0,
    topicsUpdated: 0,
    topicsMissingFromOutput: 0,
    outputsMissing: 0,
    outputsInvalid: 0,
  };

  for (const meeting of meetings.results) {
    const updated = await updateMeetingTopics(db, bucket, meeting.meeting_id, meeting.r2_output_key);
    if (updated === 'missing') {
      result.outputsMissing += 1;
    } else if (updated === 'invalid') {
      result.outputsInvalid += 1;
    } else {
      result.meetingsUpdated += 1;
      result.topicsUpdated += typeof updated === 'number' ? updated : 0;
    }
  }

  const topicCount = await db.prepare('SELECT COUNT(*) AS count FROM topics').first<{ count: number }>();
  result.topicsMissingFromOutput = Math.max(0, (topicCount?.count ?? 0) - result.topicsUpdated);
  return result;
}
