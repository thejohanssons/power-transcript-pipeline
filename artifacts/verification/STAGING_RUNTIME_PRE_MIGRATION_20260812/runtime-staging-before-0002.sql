PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE meetings (
  meeting_id        TEXT PRIMARY KEY,          -- stable ID from pipeline (e.g. 2026-08-07_0900_sales_call)
  source_system     TEXT NOT NULL,             -- 'azure'
  native_id         TEXT NOT NULL,             -- Teams meeting ID
  subject           TEXT,
  organiser         TEXT,
  event_date        TEXT,                      -- ISO-8601
  transcript_sha256 TEXT NOT NULL,
  state             TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | completed | failed
  error_message     TEXT,
  r2_output_key     TEXT,                      -- R2 key for full MeetingOutput JSON
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE topics (
  topic_id          TEXT PRIMARY KEY,          -- UUID
  meeting_id        TEXT NOT NULL REFERENCES meetings(meeting_id),
  -- v0.2 controlled vocabulary fields
  domain            TEXT,                      -- e.g. 'Product Management'
  entity_type       TEXT,                      -- e.g. 'Product'
  entity            TEXT,                      -- e.g. 'Reader 3' (free text)
  aspect            TEXT,                      -- e.g. 'Schedule'
  outcome           TEXT,                      -- e.g. 'Risk'
  disposition       TEXT,                      -- e.g. 'Action'
  executive_scope   TEXT,                      -- e.g. 'Strategic'
  -- Topic statement (enduring business condition)
  topic_statement   TEXT NOT NULL,
  summary           TEXT,
  -- Evidence
  key_facts_json    TEXT,                      -- JSON array of EvidenceAssertion
  decisions_json    TEXT,
  actions_json      TEXT,
  risks_json        TEXT,
  -- Ownership and confidence
  owners_json       TEXT,                      -- JSON array of role strings
  confidence        TEXT,                      -- high | medium | low
  -- Validation
  validation_status TEXT NOT NULL DEFAULT 'pass',
  validation_reasons_json TEXT,
  -- Topic Memory link
  memory_id         TEXT REFERENCES topic_memory(memory_id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE topic_memory (
  memory_id               TEXT PRIMARY KEY,     -- UUID
  -- Identity (v0.2)
  domain                  TEXT,
  entity_type             TEXT NOT NULL,
  entity                  TEXT NOT NULL,
  aspect                  TEXT,
  -- Canonical topic statement (updated as topic evolves)
  canonical_statement     TEXT NOT NULL,
  -- Trajectory tracking
  first_seen_meeting_id   TEXT REFERENCES meetings(meeting_id),
  last_seen_meeting_id    TEXT REFERENCES meetings(meeting_id),
  first_seen_date         TEXT,
  last_seen_date          TEXT,
  meeting_count           INTEGER NOT NULL DEFAULT 1,
  -- Latest classification
  latest_outcome          TEXT,
  latest_disposition      TEXT,
  latest_executive_scope  TEXT,
  -- Match review
  match_status            TEXT NOT NULL DEFAULT 'confirmed',  -- confirmed | pending_review | rejected
  proposed_match_memory_id TEXT REFERENCES topic_memory(memory_id),
  proposed_match_reason   TEXT,
  -- Status
  status                  TEXT NOT NULL DEFAULT 'open',  -- open | resolved | closed | watching
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE people (
  person_id         TEXT PRIMARY KEY,           -- UUID
  meeting_id        TEXT NOT NULL REFERENCES meetings(meeting_id),
  canonical_name    TEXT,
  source_name       TEXT NOT NULL,
  attendance        TEXT,                       -- present | absent | unknown
  stance            TEXT,
  unresolved        INTEGER NOT NULL DEFAULT 0,
  contributions_json TEXT,                     -- JSON array of EvidenceAssertion
  topic_ids_json    TEXT,                      -- JSON array of topic_id
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE actions (
  action_id         TEXT PRIMARY KEY,           -- UUID
  meeting_id        TEXT NOT NULL REFERENCES meetings(meeting_id),
  topic_id          TEXT REFERENCES topics(topic_id),
  owner             TEXT,                       -- canonical name of owner
  text              TEXT NOT NULL,
  due_date          TEXT,                       -- ISO-8601 date if mentioned
  status            TEXT NOT NULL DEFAULT 'open',  -- open | completed | cancelled
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE decisions (
  decision_id       TEXT PRIMARY KEY,           -- UUID
  meeting_id        TEXT NOT NULL REFERENCES meetings(meeting_id),
  topic_id          TEXT REFERENCES topics(topic_id),
  owner             TEXT,                       -- canonical name of decision owner
  text              TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
DELETE FROM sqlite_sequence;
CREATE UNIQUE INDEX idx_meetings_native_id ON meetings(native_id);
CREATE INDEX idx_topics_meeting ON topics(meeting_id);
CREATE INDEX idx_topics_entity ON topics(entity_type, entity);
CREATE INDEX idx_topics_memory ON topics(memory_id);
CREATE INDEX idx_topic_memory_entity ON topic_memory(entity_type, entity);
CREATE INDEX idx_topic_memory_match_status ON topic_memory(match_status);
CREATE INDEX idx_topic_memory_status ON topic_memory(status);
CREATE INDEX idx_people_meeting ON people(meeting_id);
CREATE INDEX idx_people_canonical_name ON people(canonical_name);
CREATE INDEX idx_actions_meeting ON actions(meeting_id);
CREATE INDEX idx_actions_owner ON actions(owner);
CREATE INDEX idx_actions_status ON actions(status);
CREATE INDEX idx_decisions_meeting ON decisions(meeting_id);
CREATE INDEX idx_decisions_owner ON decisions(owner);
