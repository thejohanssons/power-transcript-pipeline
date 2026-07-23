-- ============================================================
-- Copyright (c) 2026 Virrata AB. All rights reserved.
-- EIP Platform — D1 Canonical Schema
-- Migration 0007: Risks table (per-person, per-meeting)
-- ============================================================

CREATE TABLE IF NOT EXISTS risks (
  risk_id       TEXT PRIMARY KEY,
  meeting_ref   TEXT NOT NULL,
  meeting_date  TEXT NOT NULL,
  raised_by     TEXT,              -- person who raised the risk
  topic_ref     TEXT,              -- topic name this risk relates to
  description   TEXT NOT NULL,
  severity      TEXT DEFAULT 'MEDIUM', -- HIGH, MEDIUM, LOW
  status        TEXT NOT NULL DEFAULT 'Open', -- Open, Mitigated, Accepted, Closed
  source_r2_key TEXT,              -- R2 key of source people or topic file
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_risks_meeting_ref  ON risks(meeting_ref);
CREATE INDEX IF NOT EXISTS idx_risks_raised_by    ON risks(raised_by);
CREATE INDEX IF NOT EXISTS idx_risks_severity     ON risks(severity);
CREATE INDEX IF NOT EXISTS idx_risks_status       ON risks(status);
CREATE INDEX IF NOT EXISTS idx_risks_topic_ref    ON risks(topic_ref);
CREATE INDEX IF NOT EXISTS idx_risks_meeting_date ON risks(meeting_date DESC);
