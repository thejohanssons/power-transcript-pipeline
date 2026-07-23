-- ============================================================
-- Copyright (c) 2026 Virrata AB. All rights reserved.
-- EIP Platform — D1 Canonical Schema
-- Migration 0006: Decisions table (per-person, per-meeting)
-- ============================================================

CREATE TABLE IF NOT EXISTS decisions (
  decision_id   TEXT PRIMARY KEY,
  meeting_ref   TEXT NOT NULL,
  meeting_date  TEXT NOT NULL,
  owner         TEXT,              -- person who owns/made the decision
  topic_ref     TEXT,              -- topic name this decision relates to
  description   TEXT NOT NULL,
  rationale     TEXT,              -- decision rationale if captured
  source_r2_key TEXT,              -- R2 key of source people or topic file
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_decisions_meeting_ref  ON decisions(meeting_ref);
CREATE INDEX IF NOT EXISTS idx_decisions_owner        ON decisions(owner);
CREATE INDEX IF NOT EXISTS idx_decisions_topic_ref    ON decisions(topic_ref);
CREATE INDEX IF NOT EXISTS idx_decisions_meeting_date ON decisions(meeting_date DESC);
