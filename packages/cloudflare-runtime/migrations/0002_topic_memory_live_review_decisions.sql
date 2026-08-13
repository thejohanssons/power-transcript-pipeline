-- EIP Cloudflare Runtime D1 Schema
-- Migration 0002: Controlled topic-memory live review decisions
-- Application-level append-only audit: privileged D1 administrators can still alter data.

ALTER TABLE topic_memory ADD COLUMN merged_into_memory_id TEXT REFERENCES topic_memory(memory_id);
ALTER TABLE topic_memory ADD COLUMN review_resolved_at TEXT;
ALTER TABLE topic_memory ADD COLUMN review_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_topic_memory_merged_into
  ON topic_memory(merged_into_memory_id);

CREATE INDEX IF NOT EXISTS idx_topic_memory_review_resolution
  ON topic_memory(match_status, review_resolved_at);

CREATE TABLE IF NOT EXISTS topic_memory_review_events (
  review_event_id                   TEXT PRIMARY KEY,
  candidate_memory_id               TEXT NOT NULL REFERENCES topic_memory(memory_id),
  target_memory_id                  TEXT NOT NULL REFERENCES topic_memory(memory_id),
  decision                          TEXT NOT NULL CHECK (decision IN ('approve_match', 'reject_match')),
  expected_source_version           TEXT NOT NULL,
  observed_source_version           TEXT NOT NULL,
  expected_proposed_match_memory_id TEXT NOT NULL,
  observed_proposed_match_memory_id TEXT NOT NULL,
  reviewer_name                     TEXT NOT NULL,
  reviewer_note                     TEXT NOT NULL,
  warning_acknowledged              INTEGER NOT NULL CHECK (warning_acknowledged = 1),
  idempotency_key                   TEXT NOT NULL UNIQUE,
  candidate_match_status_before     TEXT NOT NULL,
  candidate_match_status_after      TEXT NOT NULL,
  target_meeting_count_before       INTEGER,
  target_meeting_count_after        INTEGER,
  created_at                        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_topic_memory_review_events_candidate_created
  ON topic_memory_review_events(candidate_memory_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_topic_memory_review_events_target_created
  ON topic_memory_review_events(target_memory_id, created_at DESC);
