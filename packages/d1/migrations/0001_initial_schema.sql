-- ============================================================
-- Copyright (c) 2026 Virrata AB. All rights reserved.
-- EIP Platform — D1 Canonical Schema
-- Migration 0001: Initial schema
-- ============================================================

-- ----------------------------------------------------------------
-- Topics: canonical topic entity (one row per unique topic)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS topics (
  topic_id          TEXT PRIMARY KEY,           -- slug e.g. "pcb-supply-risk"
  topic_name        TEXT NOT NULL,              -- display name
  domain            TEXT NOT NULL,              -- from taxonomy: Manufacturing, NPI, etc.
  category          TEXT NOT NULL,              -- Risk, Action, Decision, Insight, etc.
  current_status    TEXT NOT NULL DEFAULT 'Open',   -- Open, Resolved, Monitoring, Closed
  current_priority  TEXT NOT NULL DEFAULT 'Medium', -- Low, Medium, High, Critical
  owner             TEXT,                       -- resolved owner (CPO, COO, etc.)
  first_seen        TEXT NOT NULL,              -- ISO8601 datetime
  last_seen         TEXT NOT NULL,              -- ISO8601 datetime
  occurrence_count  INTEGER NOT NULL DEFAULT 1,
  trend             TEXT DEFAULT 'Stable',      -- Stable, Escalating, Resolving
  confluence_url    TEXT,                       -- latest Confluence page URL
  sp_list_item_id   TEXT,                       -- SharePoint list item ID for sync
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------
-- Topic Occurrences: every time a topic surfaces (one row per meeting)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS topic_occurrences (
  occurrence_id     TEXT PRIMARY KEY,           -- GUID
  topic_id          TEXT NOT NULL REFERENCES topics(topic_id),
  meeting_ref       TEXT,                       -- e.g. "HoD_2026-07-15" or VTT filename
  meeting_date      TEXT,                       -- ISO8601 date
  context           TEXT,                       -- NPI, R&D, Sales, Operations, etc.
  priority          TEXT,                       -- priority as assessed at this meeting
  summary           TEXT,                       -- auto-generated summary from LLM
  source            TEXT NOT NULL DEFAULT 'Transcript', -- Transcript, AgentSession, UserInput
  user_notes        TEXT,                       -- verbatim user comment from agent session
  status            TEXT NOT NULL DEFAULT 'Pending', -- Pending, Approved, Rejected, Processed
  session_id        TEXT,                       -- links to sessions table
  confluence_url    TEXT,                       -- Confluence page where published
  sp_item_id        TEXT,                       -- SharePoint queue item ID
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at      TEXT
);

-- ----------------------------------------------------------------
-- Transcripts: raw transcript store reference (content in R2)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transcripts (
  transcript_id     TEXT PRIMARY KEY,           -- GUID
  meeting_ref       TEXT NOT NULL,              -- e.g. meeting subject slug + date
  r2_key            TEXT,                       -- R2 object path (once R2 is enabled)
  meeting_date      TEXT NOT NULL,              -- ISO8601 date
  source_system     TEXT NOT NULL DEFAULT 'M365', -- M365, Google, Manual
  segment_count     INTEGER NOT NULL DEFAULT 1, -- number of VTT segments concatenated
  processed         INTEGER NOT NULL DEFAULT 0, -- 0=false, 1=true (SQLite bool)
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------
-- Sessions: agent session audit log
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  session_id        TEXT PRIMARY KEY,           -- GUID
  session_date      TEXT NOT NULL,              -- ISO8601 datetime
  session_type      TEXT DEFAULT 'AdHoc',       -- MorningBriefing, ProjectReview, AdHoc
  user_intent       TEXT,                       -- agent summary of user focus
  topics_reviewed   INTEGER DEFAULT 0,
  topics_added      INTEGER DEFAULT 0,
  topics_rejected   INTEGER DEFAULT 0,
  agent_summary     TEXT,                       -- narrative wrap-up
  follow_up_flags   TEXT,                       -- JSON array of flagged items
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_topics_domain     ON topics(domain);
CREATE INDEX IF NOT EXISTS idx_topics_status     ON topics(current_status);
CREATE INDEX IF NOT EXISTS idx_topics_last_seen  ON topics(last_seen DESC);

CREATE INDEX IF NOT EXISTS idx_occ_topic_id      ON topic_occurrences(topic_id);
CREATE INDEX IF NOT EXISTS idx_occ_status        ON topic_occurrences(status);
CREATE INDEX IF NOT EXISTS idx_occ_meeting_date  ON topic_occurrences(meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_occ_session_id    ON topic_occurrences(session_id);

CREATE INDEX IF NOT EXISTS idx_trans_processed   ON transcripts(processed);
CREATE INDEX IF NOT EXISTS idx_trans_date        ON transcripts(meeting_date DESC);
