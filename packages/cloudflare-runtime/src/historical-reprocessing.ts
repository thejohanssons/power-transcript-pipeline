import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { processMeeting } from './meeting-processing';
import { processSafeEvidenceMeeting } from './safe-evidence';
import type { Env, MeetingOutput, TranscriptSubmission } from './types';
import type { FixedTopicContext } from './topic-enrichment';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

export type HistoricalReprocessingMode = 'standard' | 'safe-evidence';

export interface HistoricalReprocessingRequest {
  dryRun: boolean;
  limit: number;
  cursor: string | null;
  meetingIds: string[];
  includeFailed: boolean;
  mode: HistoricalReprocessingMode;
}

export interface HistoricalReprocessingResult {
  dryRun: boolean;
  meetingsScanned: number;
  candidatesGenerated: number;
  promoted: number;
  transcriptsFound: number;
  outputsFound: number;
  outputsMissing: number;
  outputsInvalid: number;
  safeChunksProcessed: number;
  safeChunksFiltered: number;
  sourceTopicsScanned: number;
  sourceTopicsWithKeyFacts: number;
  sourceTopicsMissingKeyFacts: number;
  d1TopicsScanned: number;
  d1TopicsWithKeyFacts: number;
  d1TopicsMissingKeyFacts: number;
  quarantined: Array<{ meetingId: string; reason: string }>;
  missingTranscripts: string[];
  nextCursor: string | null;
}

type HistoricalMeeting = {
  meeting_id: string;
  source_system: string;
  native_id: string;
  subject: string;
  organiser: string;
  event_date: string;
  transcript_sha256: string;
  r2_output_key: string;
};

function safeLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(value, 1), MAX_LIMIT);
}

export function parseHistoricalReprocessingRequest(body: unknown): HistoricalReprocessingRequest {
  const value = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const cursor = typeof value.cursor === 'string' && value.cursor.length > 0 ? value.cursor : null;
  const meetingIds = Array.isArray(value.meetingIds)
    ? value.meetingIds.filter((meetingId): meetingId is string => typeof meetingId === 'string' && meetingId.length > 0).slice(0, 20)
    : [];
  const mode = value.mode === 'safe-evidence' ? 'safe-evidence' : 'standard';
  return {
    dryRun: value.dryRun !== false,
    limit: safeLimit(value.limit),
    cursor,
    meetingIds,
    includeFailed: value.includeFailed === true,
    mode,
  };
}

function topicIds(output: MeetingOutput): string[] {
  return output.topics.map((topic) => topic.topicId).sort();
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function incompleteTopicIds(output: MeetingOutput): string[] {
  return output.topics.filter((topic) => topic.keyFacts.length === 0).map((topic) => topic.topicId);
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function d1EvidenceCounts(db: D1Database, meetingId: string): Promise<{ topics: number; withKeyFacts: number }> {
  const row = await db.prepare(`SELECT COUNT(*) AS topics,
      SUM(CASE WHEN json_array_length(COALESCE(key_facts_json, '[]')) > 0 THEN 1 ELSE 0 END) AS with_key_facts
    FROM topics WHERE meeting_id = ?`).bind(meetingId).first<{ topics: number; with_key_facts: number }>();
  return { topics: row?.topics ?? 0, withKeyFacts: row?.with_key_facts ?? 0 };
}

async function existingTopics(db: D1Database, meetingId: string): Promise<FixedTopicContext[]> {
  const rows = await db.prepare(`SELECT topic_id, domain, entity_type, entity, aspect, outcome, disposition,
      executive_scope, topic_statement, summary, owners_json, confidence
    FROM topics WHERE meeting_id = ? ORDER BY topic_id`)
    .bind(meetingId)
    .all<{
      topic_id: string;
      domain: string | null;
      entity_type: string | null;
      entity: string | null;
      aspect: string | null;
      outcome: string | null;
      disposition: string | null;
      executive_scope: string | null;
      topic_statement: string;
      summary: string | null;
      owners_json: string | null;
      confidence: string | null;
    }>();
  return rows.results.map((row) => ({
    topicId: row.topic_id,
    domain: row.domain,
    entityType: row.entity_type,
    entity: row.entity,
    aspect: row.aspect,
    outcome: row.outcome,
    disposition: row.disposition,
    executiveScope: row.executive_scope,
    topicStatement: row.topic_statement,
    summary: row.summary,
    owners: parseJsonArray(row.owners_json),
    confidence: row.confidence,
    memoryId: undefined,
  }));
}

async function selectMeetings(db: D1Database, request: HistoricalReprocessingRequest): Promise<HistoricalMeeting[]> {
  const targeted = request.meetingIds.length > 0;
  const placeholders = targeted ? request.meetingIds.map(() => '?').join(', ') : '';
  const stateFilter = targeted && request.includeFailed ? "state IN ('completed', 'failed')" : "state = 'completed'";
  const base = `SELECT meeting_id, source_system, native_id, subject, organiser, event_date,
      transcript_sha256, r2_output_key
    FROM meetings
    WHERE ${stateFilter} AND r2_output_key IS NOT NULL
      ${targeted ? `AND meeting_id IN (${placeholders})` : ''}
      ${!targeted && request.cursor ? 'AND meeting_id > ?' : ''}
    ORDER BY meeting_id
    LIMIT ?`;
  const statement = db.prepare(base);
  const params = targeted
    ? [...request.meetingIds, request.limit]
    : request.cursor ? [request.cursor, request.limit] : [request.limit];
  return (await statement.bind(...params).all<HistoricalMeeting>()).results;
}

function submissionFromMeeting(meeting: HistoricalMeeting, transcript: string): TranscriptSubmission {
  return {
    meetingId: meeting.meeting_id,
    sourceSystem: meeting.source_system,
    nativeId: meeting.native_id,
    subject: meeting.subject,
    organiser: meeting.organiser,
    eventDate: meeting.event_date,
    transcript,
  };
}

export async function reprocessHistoricalMeetings(
  db: D1Database,
  bucket: R2Bucket,
  env: Pick<Env, 'AZURE_OPENAI_ENDPOINT' | 'AZURE_OPENAI_DEPLOYMENT' | 'AZURE_OPENAI_API_KEY'>,
  request: HistoricalReprocessingRequest,
): Promise<HistoricalReprocessingResult> {
  const meetings = await selectMeetings(db, request);
  const result: HistoricalReprocessingResult = {
    dryRun: request.dryRun,
    meetingsScanned: meetings.length,
    candidatesGenerated: 0,
    promoted: 0,
    transcriptsFound: 0,
    outputsFound: 0,
    outputsMissing: 0,
    outputsInvalid: 0,
    safeChunksProcessed: 0,
    safeChunksFiltered: 0,
    sourceTopicsScanned: 0,
    sourceTopicsWithKeyFacts: 0,
    sourceTopicsMissingKeyFacts: 0,
    d1TopicsScanned: 0,
    d1TopicsWithKeyFacts: 0,
    d1TopicsMissingKeyFacts: 0,
    quarantined: [],
    missingTranscripts: [],
    nextCursor: request.meetingIds.length > 0
      ? null
      : meetings.length === request.limit ? meetings[meetings.length - 1].meeting_id : null,
  };

  for (const meeting of meetings) {
    const transcriptObject = await bucket.get(`meetings/${meeting.meeting_id}/transcript.txt`);
    if (!transcriptObject) {
      result.missingTranscripts.push(meeting.meeting_id);
      continue;
    }
    result.transcriptsFound += 1;

    const d1Counts = await d1EvidenceCounts(db, meeting.meeting_id);
    result.d1TopicsScanned += d1Counts.topics;
    result.d1TopicsWithKeyFacts += d1Counts.withKeyFacts;
    result.d1TopicsMissingKeyFacts += d1Counts.topics - d1Counts.withKeyFacts;

    const sourceOutputObject = await bucket.get(meeting.r2_output_key);
    if (!sourceOutputObject) {
      result.outputsMissing += 1;
    } else {
      result.outputsFound += 1;
      try {
        const sourceOutput = await sourceOutputObject.json<Partial<MeetingOutput>>();
        const sourceTopics = Array.isArray(sourceOutput.topics) ? sourceOutput.topics : [];
        result.sourceTopicsScanned += sourceTopics.length;
        result.sourceTopicsWithKeyFacts += sourceTopics.filter((topic) => Array.isArray(topic.keyFacts) && topic.keyFacts.length > 0).length;
        result.sourceTopicsMissingKeyFacts += sourceTopics.filter((topic) => !Array.isArray(topic.keyFacts) || topic.keyFacts.length === 0).length;
      } catch {
        result.outputsInvalid += 1;
      }
    }

    if (request.dryRun) continue;

    const transcript = await transcriptObject.text();
    const fixedTopics = await existingTopics(db, meeting.meeting_id);
    let output: MeetingOutput;
    try {
      const submission = submissionFromMeeting(meeting, transcript);
      if (request.mode === 'safe-evidence') {
        const safeResult = await processSafeEvidenceMeeting(submission, meeting.transcript_sha256, env, fixedTopics);
        output = safeResult.output;
        result.safeChunksProcessed += safeResult.chunksProcessed;
        result.safeChunksFiltered += safeResult.filteredChunks;
      } else {
        output = await processMeeting(submission, meeting.transcript_sha256, env, { fixedTopics });
      }
    } catch (error) {
      result.quarantined.push({
        meetingId: meeting.meeting_id,
        reason: `processing failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const incomplete = incompleteTopicIds(output);
    if (incomplete.length > 0) {
      result.quarantined.push({
        meetingId: meeting.meeting_id,
        reason: `evidence incomplete for topics: ${incomplete.join(', ')}`,
      });
      continue;
    }

    const previousIds = fixedTopics.map((topic) => topic.topicId).sort();
    const generatedIds = topicIds(output);
    if (!sameIds(previousIds, generatedIds)) {
      result.quarantined.push({
        meetingId: meeting.meeting_id,
        reason: `topic ID set changed: existing=${previousIds.length}, generated=${generatedIds.length}`,
      });
      continue;
    }

    const candidateKey = request.mode === 'safe-evidence'
      ? `meetings/${meeting.meeting_id}/meeting-output.safe-reprocessed-v${output.processing.normalisationVersion}.json`
      : `meetings/${meeting.meeting_id}/meeting-output.reprocessed-v${output.processing.normalisationVersion}.json`;
    await bucket.put(candidateKey, JSON.stringify(output, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    });
    result.candidatesGenerated += 1;

    await db.prepare("UPDATE meetings SET r2_output_key = ?, updated_at = datetime('now') WHERE meeting_id = ?")
      .bind(candidateKey, meeting.meeting_id)
      .run();
    result.promoted += 1;
  }

  return result;
}
