-- ============================================================
-- EIP Local Cockpit Server — Feedback D1 Schema
-- Migration 0001: Feedback table
--
-- This is a DEDICATED, ISOLATED database.
-- It is NOT the production runtime D1.
-- It receives append-only quality annotations from local reviewers.
-- No UPDATE or DELETE operations are permitted by the application.
-- Corrections are additional rows referencing corrects_feedback_id.
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback (
  feedback_id           TEXT PRIMARY KEY,         -- UUID, caller-generated
  item_type             TEXT NOT NULL,            -- 'meeting' | 'topic' | 'action' | 'decision' | 'memory'
  item_id               TEXT NOT NULL,            -- ID of the reviewed D1 item
  source_kind           TEXT NOT NULL,            -- 'd1' (only D1 records are reviewed in this POC)
  source_version        TEXT NOT NULL,            -- required: updated_at timestamp of the reviewed D1 record
  reviewer_name         TEXT NOT NULL,            -- explicit display name (required)
  verdict               TEXT NOT NULL CHECK (verdict IN ('accurate','incomplete','incorrect','irrelevant')),
  affected_field        TEXT NOT NULL,            -- e.g. 'topicStatement', 'owner', 'summary'
  note                  TEXT NOT NULL,            -- free text — retained indefinitely
  warning_acknowledged  INTEGER NOT NULL DEFAULT 0 CHECK (warning_acknowledged IN (0,1)),
                                                  -- 1 = reviewer acknowledged no-transcript warning
  corrects_feedback_id  TEXT REFERENCES feedback(feedback_id),
                                                  -- NULL for new feedback; set for correction annotations
  source_location       TEXT,                     -- optional: meeting_id, topic_id, etc. for cross-reference
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Indexes ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_feedback_item       ON feedback(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_feedback_reviewer   ON feedback(reviewer_name);
CREATE INDEX IF NOT EXISTS idx_feedback_verdict    ON feedback(verdict);
CREATE INDEX IF NOT EXISTS idx_feedback_created    ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_corrects   ON feedback(corrects_feedback_id);
