-- ============================================================
-- Copyright (c) 2026 Virrata AB. All rights reserved.
-- EIP Platform — D1 Canonical Schema
-- Migration 0005: Actions table (per-person, per-meeting)
-- ============================================================

CREATE TABLE IF NOT EXISTS actions (
  action_id     TEXT PRIMARY KEY,
  meeting_ref   TEXT NOT NULL,
  meeting_date  TEXT NOT NULL,
  assigned_to   TEXT,              -- person name or person_id
  assigned_by   TEXT,              -- person name or person_id
  topic_ref     TEXT,              -- topic name this action relates to
  description   TEXT NOT NULL,
  due_date      TEXT,
  status        TEXT NOT NULL DEFAULT 'Open', -- Open, Done, Overdue, Cancelled
  source_r2_key TEXT,              -- R2 key of source people file
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_actions_meeting_ref  ON actions(meeting_ref);
CREATE INDEX IF NOT EXISTS idx_actions_assigned_to  ON actions(assigned_to);
CREATE INDEX IF NOT EXISTS idx_actions_status       ON actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_meeting_date ON actions(meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_actions_topic_ref    ON actions(topic_ref);
