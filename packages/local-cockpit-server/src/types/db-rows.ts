// ============================================================
// EIP Local Cockpit Server — Raw D1 row shapes
// These mirror the cloudflare-runtime D1 schema exactly.
// JSON columns are stored as TEXT in D1 and parsed after fetch.
// ============================================================

export interface MeetingRow {
  meeting_id: string;
  source_system: string;
  native_id: string;
  subject: string | null;
  organiser: string | null;
  event_date: string | null;
  transcript_sha256: string;
  state: string;
  error_message: string | null;
  r2_output_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface TopicRow {
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
  key_facts_json: string | null;     // JSON: EvidenceAssertion[]
  decisions_json: string | null;     // JSON: EvidenceAssertion[]
  actions_json: string | null;       // JSON: EvidenceAssertion[]
  risks_json: string | null;         // JSON: EvidenceAssertion[]
  owners_json: string | null;        // JSON: string[]
  confidence: string | null;
  validation_status: string;
  validation_reasons_json: string | null;  // JSON: string[]
  memory_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TopicMemoryRow {
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
  merged_into_memory_id?: string | null;
  review_resolved_at?: string | null;
  review_event_id?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TopicMemoryReviewEventRow {
  review_event_id: string;
  candidate_memory_id: string;
  target_memory_id: string;
  decision: 'approve_match' | 'reject_match';
  reviewer_name: string;
  reviewer_note: string;
  created_at: string;
}

export interface ActionRow {
  action_id: string;
  meeting_id: string;
  topic_id: string | null;
  owner: string | null;
  text: string;
  due_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DecisionRow {
  decision_id: string;
  meeting_id: string;
  topic_id: string | null;
  owner: string | null;
  text: string;
  created_at: string;
  updated_at: string;
}

export interface PersonRow {
  person_id: string;
  meeting_id: string;
  canonical_name: string | null;
  source_name: string;
  attendance: string | null;
  stance: string | null;
  unresolved: number;     // SQLite integer: 0 | 1
  contributions_json: string | null;   // JSON: EvidenceAssertion[]
  topic_ids_json: string | null;       // JSON: string[]
  created_at: string;
  updated_at: string;
}

export interface FeedbackRow {
  feedback_id: string;
  item_type: string;
  item_id: string;
  source_kind: string;
  source_version: string | null;
  reviewer_name: string;
  verdict: string;
  affected_field: string;
  note: string;
  warning_acknowledged: number;   // 1 = acknowledged
  corrects_feedback_id: string | null;
  source_location: string | null;
  created_at: string;
}
