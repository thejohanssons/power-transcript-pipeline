-- EIP Cloudflare Runtime D1 Schema
-- Migration 0004: Auditable meeting invalidation/quarantine operations

CREATE TABLE IF NOT EXISTS meeting_invalidations (
  invalidation_id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  deleted_topic_count INTEGER NOT NULL DEFAULT 0,
  deleted_action_count INTEGER NOT NULL DEFAULT 0,
  deleted_decision_count INTEGER NOT NULL DEFAULT 0,
  deleted_person_count INTEGER NOT NULL DEFAULT 0,
  deleted_r2_keys_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meeting_invalidations_meeting
  ON meeting_invalidations(meeting_id, created_at DESC);
