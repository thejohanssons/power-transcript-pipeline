-- ============================================================
-- Copyright (c) 2026 Virrata AB. All rights reserved.
-- EIP Platform — D1 Canonical Schema
-- Migration 0002: Topic merge candidates (deduplication reviewer)
-- ============================================================

CREATE TABLE IF NOT EXISTS topic_merge_candidates (
  candidate_id        TEXT PRIMARY KEY,
  topic_id_a          TEXT NOT NULL REFERENCES topics(topic_id),
  topic_id_b          TEXT NOT NULL REFERENCES topics(topic_id),
  similarity          REAL NOT NULL,          -- 0.0–1.0 score
  method              TEXT NOT NULL DEFAULT 'fuzzy', -- 'fuzzy' or 'semantic'
  status              TEXT NOT NULL DEFAULT 'Pending', -- Pending, Merged, Dismissed
  suggested_canonical TEXT,                   -- topic_id to keep on merge
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_merge_status ON topic_merge_candidates(status);
CREATE INDEX IF NOT EXISTS idx_merge_topic_a ON topic_merge_candidates(topic_id_a);
CREATE INDEX IF NOT EXISTS idx_merge_topic_b ON topic_merge_candidates(topic_id_b);
