-- ============================================================
-- Copyright (c) 2026 Virrata AB. All rights reserved.
-- EIP Platform — D1 Canonical Schema
-- Migration 0003: Meeting participants (parsed from people files)
-- ============================================================

CREATE TABLE IF NOT EXISTS meeting_participants (
  participant_id  TEXT PRIMARY KEY,           -- GUID
  meeting_ref     TEXT NOT NULL,              -- e.g. "2026-06-29_0900_exco_daily"
  meeting_date    TEXT NOT NULL,              -- ISO8601 date
  person_id       TEXT NOT NULL,              -- e.g. "person_peter_johansson"
  display_name    TEXT,                       -- resolved display name from people_config
  role            TEXT,                       -- CPO, COO, etc.
  was_organiser   INTEGER NOT NULL DEFAULT 0, -- 0=false, 1=true
  source          TEXT NOT NULL DEFAULT 'PeopleLog', -- PeopleLog, PeopleFile, Manual
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_part_meeting_ref  ON meeting_participants(meeting_ref);
CREATE INDEX IF NOT EXISTS idx_part_person_id    ON meeting_participants(person_id);
CREATE INDEX IF NOT EXISTS idx_part_meeting_date ON meeting_participants(meeting_date DESC);

-- Prevent duplicate participant entries per meeting
CREATE UNIQUE INDEX IF NOT EXISTS idx_part_unique
  ON meeting_participants(meeting_ref, person_id);
