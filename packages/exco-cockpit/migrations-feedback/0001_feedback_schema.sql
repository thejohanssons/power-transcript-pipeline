-- ============================================================
-- EIP ExCo Cockpit — Dedicated Feedback D1 Schema
-- Migration 0001: append-only reviewer quality annotations
--
-- This database is intentionally isolated from runtime source records.
-- The Worker provides INSERT and SELECT routes only. Corrections are new
-- annotations that reference an earlier feedback_id.
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback (
  feedback_id           TEXT PRIMARY KEY,
  item_type             TEXT NOT NULL CHECK (item_type IN ('meeting', 'topic', 'action', 'decision', 'memory')),
  item_id               TEXT NOT NULL,
  source_kind           TEXT NOT NULL CHECK (source_kind = 'd1'),
  source_version        TEXT NOT NULL,
  reviewer_name         TEXT NOT NULL,
  verdict               TEXT NOT NULL CHECK (verdict IN ('accurate', 'incomplete', 'incorrect', 'irrelevant')),
  affected_field        TEXT NOT NULL,
  note                  TEXT NOT NULL,
  warning_acknowledged  INTEGER NOT NULL CHECK (warning_acknowledged IN (0, 1)),
  corrects_feedback_id  TEXT REFERENCES feedback(feedback_id),
  source_location       TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_item
  ON feedback(item_type, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_reviewer
  ON feedback(reviewer_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_verdict
  ON feedback(verdict, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_corrects
  ON feedback(corrects_feedback_id);
