// ============================================================
// EIP Local Cockpit Server — Runtime D1 Adapter (READ-ONLY)
//
// Provides fixed SELECT queries against the production runtime D1.
// No generic query method is exposed. No write operations exist.
// Structural read-only is defence-in-depth; see RUNBOOK.md for
// credential scope notes.
// ============================================================

import type { MeetingRow, TopicRow, TopicMemoryRow, TopicMemoryReviewEventRow, ActionRow, DecisionRow, PersonRow } from '../types/db-rows.js';

export interface RuntimeD1Config {
  accountId: string;
  token: string;         // Read-only Cloudflare API token
  databaseId: string;
}

// ── Cloudflare D1 HTTP API response shapes ─────────────────

interface D1QueryResult<T> {
  results: T[];
  success: boolean;
  meta: { duration: number; rows_read: number; rows_written: number };
}

interface D1Response<T> {
  result: D1QueryResult<T>[];
  success: boolean;
  errors: Array<{ message: string }>;
}

// ── Adapter interface ──────────────────────────────────────

export interface RuntimeD1Adapter {
  /** List all meetings (business fields only; r2_output_key and transcript_sha256 excluded). */
  listMeetings(): Promise<MeetingRow[]>;
  /** Get a single meeting by ID. */
  getMeeting(meetingId: string): Promise<MeetingRow | null>;
  /** List topics for a meeting. */
  listTopicsByMeeting(meetingId: string): Promise<TopicRow[]>;
  /** List all topics (paginated). */
  listTopics(limit?: number, offset?: number): Promise<TopicRow[]>;
  /** Get a single topic by ID. */
  getTopic(topicId: string): Promise<TopicRow | null>;
  /** List all topic memory records. */
  listTopicMemory(limit?: number, offset?: number): Promise<TopicMemoryRow[]>;
  /** Get a single topic memory record. */
  getTopicMemory(memoryId: string): Promise<TopicMemoryRow | null>;
  /** List authoritative runtime review decisions using a fixed query. */
  listTopicMemoryReviewEvents(limit?: number): Promise<TopicMemoryReviewEventRow[]>;
  /** List actions for a meeting. */
  listActionsByMeeting(meetingId: string): Promise<ActionRow[]>;
  /** List all actions. */
  listActions(limit?: number, offset?: number): Promise<ActionRow[]>;
  /** List decisions for a meeting. */
  listDecisionsByMeeting(meetingId: string): Promise<DecisionRow[]>;
  /** List all decisions. */
  listDecisions(limit?: number, offset?: number): Promise<DecisionRow[]>;
  /** List people for a meeting. */
  listPeopleByMeeting(meetingId: string): Promise<PersonRow[]>;
  /** Count rows in key tables for pre/post-session baseline checks. */
  baselineCounts(): Promise<Record<string, number>>;
}

// ── Implementation ─────────────────────────────────────────

export function createRuntimeD1Adapter(config: RuntimeD1Config): RuntimeD1Adapter {
  const { accountId, token, databaseId } = config;
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  async function query<T>(sql: string, params: (string | number | null)[] = []): Promise<T[]> {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '<unreadable>');
      throw new Error(`[runtime-d1] HTTP ${res.status} from D1 API: ${text}`);
    }

    const data = await res.json() as D1Response<T>;
    if (!data.success) {
      const msg = data.errors?.map(e => e.message).join('; ') ?? 'Unknown D1 error';
      throw new Error(`[runtime-d1] D1 query failed: ${msg}`);
    }

    return data.result[0]?.results ?? [];
  }

  return {
    async listMeetings() {
      return query<MeetingRow>(
        `SELECT meeting_id, source_system, native_id, subject, organiser, event_date,
                state, error_message, created_at, updated_at
         FROM meetings
         ORDER BY event_date DESC
         LIMIT 500`
      );
    },

    async getMeeting(meetingId) {
      const rows = await query<MeetingRow>(
        `SELECT meeting_id, source_system, native_id, subject, organiser, event_date,
                state, error_message, created_at, updated_at
         FROM meetings WHERE meeting_id = ?`,
        [meetingId]
      );
      return rows[0] ?? null;
    },

    async listTopicsByMeeting(meetingId) {
      return query<TopicRow>(
        `SELECT topic_id, meeting_id, domain, entity_type, entity, aspect, outcome,
                disposition, executive_scope, topic_statement, summary,
                key_facts_json, decisions_json, actions_json, risks_json,
                owners_json, confidence, validation_status, validation_reasons_json,
                memory_id, created_at, updated_at
         FROM topics WHERE meeting_id = ?
         ORDER BY created_at ASC`,
        [meetingId]
      );
    },

    async listTopics(limit = 200, offset = 0) {
      return query<TopicRow>(
        `SELECT topic_id, meeting_id, domain, entity_type, entity, aspect, outcome,
                disposition, executive_scope, topic_statement, summary,
                key_facts_json, decisions_json, actions_json, risks_json,
                owners_json, confidence, validation_status, validation_reasons_json,
                memory_id, created_at, updated_at
         FROM topics
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    },

    async getTopic(topicId) {
      const rows = await query<TopicRow>(
        `SELECT topic_id, meeting_id, domain, entity_type, entity, aspect, outcome,
                disposition, executive_scope, topic_statement, summary,
                key_facts_json, decisions_json, actions_json, risks_json,
                owners_json, confidence, validation_status, validation_reasons_json,
                memory_id, created_at, updated_at
         FROM topics WHERE topic_id = ?`,
        [topicId]
      );
      return rows[0] ?? null;
    },

    async listTopicMemory(limit = 500, offset = 0) {
      return query<TopicMemoryRow>(
        `SELECT memory_id, domain, entity_type, entity, aspect, canonical_statement,
                first_seen_meeting_id, last_seen_meeting_id, first_seen_date, last_seen_date,
                meeting_count, latest_outcome, latest_disposition, latest_executive_scope,
                match_status, proposed_match_memory_id, proposed_match_reason,
                merged_into_memory_id, review_resolved_at, review_event_id,
                status, created_at, updated_at
         FROM topic_memory
         ORDER BY last_seen_date DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    },

    async listTopicMemoryReviewEvents(limit = 500) {
      return query<TopicMemoryReviewEventRow>(
        `SELECT review_event_id, candidate_memory_id, target_memory_id, decision,
                reviewer_name, reviewer_note, created_at
         FROM topic_memory_review_events
         ORDER BY created_at DESC
         LIMIT ?`,
        [limit]
      );
    },

    async getTopicMemory(memoryId) {
      const rows = await query<TopicMemoryRow>(
        `SELECT memory_id, domain, entity_type, entity, aspect, canonical_statement,
                first_seen_meeting_id, last_seen_meeting_id, first_seen_date, last_seen_date,
                meeting_count, latest_outcome, latest_disposition, latest_executive_scope,
                match_status, proposed_match_memory_id, proposed_match_reason,
                merged_into_memory_id, review_resolved_at, review_event_id,
                status, created_at, updated_at
         FROM topic_memory WHERE memory_id = ?`,
        [memoryId]
      );
      return rows[0] ?? null;
    },

    async listActionsByMeeting(meetingId) {
      return query<ActionRow>(
        `SELECT action_id, meeting_id, topic_id, owner, text, due_date, status, created_at, updated_at
         FROM actions WHERE meeting_id = ?
         ORDER BY created_at ASC`,
        [meetingId]
      );
    },

    async listActions(limit = 500, offset = 0) {
      return query<ActionRow>(
        `SELECT action_id, meeting_id, topic_id, owner, text, due_date, status, created_at, updated_at
         FROM actions
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    },

    async listDecisionsByMeeting(meetingId) {
      return query<DecisionRow>(
        `SELECT decision_id, meeting_id, topic_id, owner, text, created_at, updated_at
         FROM decisions WHERE meeting_id = ?
         ORDER BY created_at ASC`,
        [meetingId]
      );
    },

    async listDecisions(limit = 500, offset = 0) {
      return query<DecisionRow>(
        `SELECT decision_id, meeting_id, topic_id, owner, text, created_at, updated_at
         FROM decisions
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    },

    async listPeopleByMeeting(meetingId) {
      return query<PersonRow>(
        `SELECT person_id, meeting_id, canonical_name, source_name, attendance,
                stance, unresolved, contributions_json, topic_ids_json, created_at, updated_at
         FROM people WHERE meeting_id = ?
         ORDER BY canonical_name ASC`,
        [meetingId]
      );
    },

    async baselineCounts() {
      const tables = ['meetings', 'topics', 'topic_memory', 'actions', 'decisions', 'people'];
      const counts: Record<string, number> = {};
      for (const table of tables) {
        const rows = await query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${table}`
        );
        counts[table] = rows[0]?.n ?? 0;
      }
      return counts;
    },
  };
}
