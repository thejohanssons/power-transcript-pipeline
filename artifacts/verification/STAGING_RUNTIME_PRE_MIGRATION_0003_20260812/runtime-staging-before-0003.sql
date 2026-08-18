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
INSERT INTO "meetings" ("meeting_id","source_system","native_id","subject","organiser","event_date","transcript_sha256","state","error_message","r2_output_key","created_at","updated_at") VALUES('smoke-meeting-target','synthetic','smoke-target','Smoke target',NULL,'2026-08-10','synthetic-target','completed',NULL,NULL,'2026-08-12 15:06:25','2026-08-12 15:06:25');
INSERT INTO "meetings" ("meeting_id","source_system","native_id","subject","organiser","event_date","transcript_sha256","state","error_message","r2_output_key","created_at","updated_at") VALUES('smoke-meeting-candidate','synthetic','smoke-candidate','Smoke candidate',NULL,'2026-08-12','synthetic-candidate','completed',NULL,NULL,'2026-08-12 15:06:25','2026-08-12 15:06:25');
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
, merged_into_memory_id TEXT REFERENCES topic_memory(memory_id), review_resolved_at TEXT, review_event_id TEXT);
INSERT INTO "topic_memory" ("memory_id","domain","entity_type","entity","aspect","canonical_statement","first_seen_meeting_id","last_seen_meeting_id","first_seen_date","last_seen_date","meeting_count","latest_outcome","latest_disposition","latest_executive_scope","match_status","proposed_match_memory_id","proposed_match_reason","status","created_at","updated_at","merged_into_memory_id","review_resolved_at","review_event_id") VALUES('smoke-target-memory','Synthetic','Project','Smoke project','Status','Synthetic target memory for controlled-write validation','smoke-meeting-target','smoke-meeting-candidate','2026-08-10','2026-08-12',2,'At risk','Review','Operational','confirmed',NULL,NULL,'open','2026-08-12 15:06:25','2026-08-12 15:14:32',NULL,NULL,NULL);
INSERT INTO "topic_memory" ("memory_id","domain","entity_type","entity","aspect","canonical_statement","first_seen_meeting_id","last_seen_meeting_id","first_seen_date","last_seen_date","meeting_count","latest_outcome","latest_disposition","latest_executive_scope","match_status","proposed_match_memory_id","proposed_match_reason","status","created_at","updated_at","merged_into_memory_id","review_resolved_at","review_event_id") VALUES('smoke-candidate-memory','Synthetic','Project','Smoke project','Status','Synthetic candidate memory for controlled-write validation','smoke-meeting-candidate','smoke-meeting-candidate','2026-08-12','2026-08-12',1,'At risk','Review','Operational','merged','smoke-target-memory','Synthetic smoke-test candidate','open','2026-08-12 15:06:25','2026-08-12 15:14:32','smoke-target-memory','2026-08-12 15:14:32','1a870a23-6e4b-4f93-ac3e-96d42a068e10');
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
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_initial_schema.sql','2026-08-12 14:36:31');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'0002_topic_memory_live_review_decisions.sql','2026-08-12 14:36:32');
CREATE TABLE topic_memory_review_events (
  review_event_id                   TEXT PRIMARY KEY,
  candidate_memory_id               TEXT NOT NULL REFERENCES topic_memory(memory_id),
  target_memory_id                  TEXT NOT NULL REFERENCES topic_memory(memory_id),
  decision                          TEXT NOT NULL CHECK (decision IN ('approve_match', 'reject_match')),
  expected_source_version           TEXT NOT NULL,
  observed_source_version           TEXT NOT NULL,
  expected_proposed_match_memory_id TEXT NOT NULL,
  observed_proposed_match_memory_id TEXT NOT NULL,
  reviewer_name                     TEXT NOT NULL,
  reviewer_note                     TEXT NOT NULL,
  warning_acknowledged              INTEGER NOT NULL CHECK (warning_acknowledged = 1),
  idempotency_key                   TEXT NOT NULL UNIQUE,
  candidate_match_status_before     TEXT NOT NULL,
  candidate_match_status_after      TEXT NOT NULL,
  target_meeting_count_before       INTEGER,
  target_meeting_count_after        INTEGER,
  created_at                        TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO "topic_memory_review_events" ("review_event_id","candidate_memory_id","target_memory_id","decision","expected_source_version","observed_source_version","expected_proposed_match_memory_id","observed_proposed_match_memory_id","reviewer_name","reviewer_note","warning_acknowledged","idempotency_key","candidate_match_status_before","candidate_match_status_after","target_meeting_count_before","target_meeting_count_after","created_at") VALUES('1a870a23-6e4b-4f93-ac3e-96d42a068e10','smoke-candidate-memory','smoke-target-memory','approve_match','smoke-source-v1','smoke-source-v1','smoke-target-memory','smoke-target-memory','Peter','N/A',1,'f93c857d-b095-4f8c-924c-bdbf0d315d3f','pending_review','merged',1,2,'2026-08-12 15:14:32');
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',2);
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
CREATE INDEX idx_topic_memory_merged_into
  ON topic_memory(merged_into_memory_id);
CREATE INDEX idx_topic_memory_review_resolution
  ON topic_memory(match_status, review_resolved_at);
CREATE INDEX idx_topic_memory_review_events_candidate_created
  ON topic_memory_review_events(candidate_memory_id, created_at DESC);
CREATE INDEX idx_topic_memory_review_events_target_created
  ON topic_memory_review_events(target_memory_id, created_at DESC);
