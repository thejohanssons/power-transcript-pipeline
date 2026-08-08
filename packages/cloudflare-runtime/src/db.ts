import type { ActionRecord, DecisionRecord, PersonRecord, TopicRecord, TranscriptSubmission } from './types';

export function buildMeetingRow(
  submission: TranscriptSubmission,
  transcriptSha256: string,
  outputKey: string | null,
): [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string | null,
] {
  return [
    submission.meetingId,
    submission.sourceSystem,
    submission.nativeId,
    submission.subject,
    submission.organiser,
    submission.eventDate,
    transcriptSha256,
    'pending',
    '',
    outputKey,
  ];
}

export function insertMeetingSql(): string {
  return `INSERT INTO meetings (
    meeting_id,
    source_system,
    native_id,
    subject,
    organiser,
    event_date,
    transcript_sha256,
    state,
    error_message,
    r2_output_key
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
}

export function updateMeetingStateSql(): string {
  return 'UPDATE meetings SET state = ?, updated_at = datetime(\'now\') WHERE meeting_id = ?';
}

export function updateMeetingFailureSql(): string {
  return 'UPDATE meetings SET state = ?, error_message = ?, updated_at = datetime(\'now\') WHERE meeting_id = ?';
}

export function updateMeetingCompletedSql(): string {
  return 'UPDATE meetings SET state = ?, r2_output_key = ?, updated_at = datetime(\'now\') WHERE meeting_id = ?';
}

export function insertTopicSql(): string {
  return `INSERT INTO topics (
    topic_id, meeting_id, domain, entity_type, entity, aspect,
    topic_statement, summary, key_facts_json, decisions_json,
    actions_json, risks_json, owners_json, confidence,
    validation_status, validation_reasons_json, memory_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
}

export function buildTopicRow(topic: TopicRecord, meetingId: string): [
  string,
  string,
  string | null,
  string | null,
  string | null,
  string | null,
  string,
  string | null,
  string,
  string,
  string,
  string,
  string,
  string | null,
  string,
  string,
  string | null,
] {
  return [
    topic.topicId,
    meetingId,
    topic.domain,
    topic.entityType,
    topic.entity,
    topic.aspect,
    topic.topicStatement,
    topic.summary,
    JSON.stringify(topic.keyFacts),
    JSON.stringify(topic.decisions),
    JSON.stringify(topic.actions),
    JSON.stringify(topic.risks),
    JSON.stringify(topic.owners),
    topic.confidence,
    topic.validation.status,
    JSON.stringify(topic.validation.reasons),
    topic.memoryId ?? null,
  ];
}

export function insertPersonSql(): string {
  return `INSERT INTO people (
    person_id, meeting_id, canonical_name, source_name,
    attendance, stance, unresolved, contributions_json,
    topic_ids_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
}

export function buildPersonRow(person: PersonRecord, meetingId: string): [
  string,
  string,
  string | null,
  string,
  string | null,
  string | null,
  number,
  string,
  string,
] {
  return [
    person.personId,
    meetingId,
    person.canonicalName,
    person.sourceName,
    person.attendance,
    person.stance,
    person.unresolved ? 1 : 0,
    JSON.stringify(person.contributions),
    JSON.stringify(person.topicIds),
  ];
}

export function insertActionSql(): string {
  return `INSERT INTO actions (
    action_id, meeting_id, topic_id, owner, text, due_date, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`;
}

export function buildActionRow(action: ActionRecord): [
  string,
  string,
  string | null,
  string | null,
  string,
  string | null,
  string,
] {
  return [
    action.actionId,
    action.meetingId,
    action.topicId ?? null,
    action.owner ?? null,
    action.text,
    action.dueDate ?? null,
    action.status,
  ];
}

export function insertDecisionSql(): string {
  return `INSERT INTO decisions (
    decision_id, meeting_id, topic_id, owner, text
  ) VALUES (?, ?, ?, ?, ?)`;
}

export function buildDecisionRow(decision: DecisionRecord): [
  string,
  string,
  string | null,
  string | null,
  string,
] {
  return [
    decision.decisionId,
    decision.meetingId,
    decision.topicId ?? null,
    decision.owner ?? null,
    decision.text,
  ];
}
