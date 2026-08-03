-- ============================================================
-- Copyright (c) 2026 Virrata AB. All rights reserved.
-- EIP Platform — Canonical Topic Memory
-- Migration 0009: Phase 1 decision-to-evidence vertical slice
-- ============================================================
-- Additive schema only. Existing topics and topic_occurrences remain
-- legacy operational projections during Azure-authoritative coexistence.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS taxonomy_topics (
  topic_id              TEXT NOT NULL,
  taxonomy_version      TEXT NOT NULL,
  topic_name            TEXT NOT NULL,
  primary_domain        TEXT NOT NULL,
  topic_family          TEXT NOT NULL,
  aliases_json          TEXT NOT NULL DEFAULT '[]',
  created_at            TEXT NOT NULL,
  PRIMARY KEY (topic_id, taxonomy_version)
);

CREATE TABLE IF NOT EXISTS evidence_items (
  evidence_id           TEXT PRIMARY KEY,
  source_system         TEXT NOT NULL,
  source_native_id      TEXT NOT NULL,
  source_locator        TEXT NOT NULL,
  occurred_at           TEXT NOT NULL,
  content_hash          TEXT NOT NULL,
  ingested_at           TEXT NOT NULL,
  source_version        TEXT NOT NULL,
  confidence            REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  access_classification TEXT NOT NULL,
  r2_key                TEXT,
  source_metadata_json  TEXT NOT NULL DEFAULT '{}',
  supersedes_evidence_id TEXT REFERENCES evidence_items(evidence_id),
  UNIQUE (source_system, source_native_id, source_locator, content_hash)
);

CREATE TABLE IF NOT EXISTS topic_cases (
  case_id               TEXT PRIMARY KEY,
  case_title            TEXT NOT NULL,
  lifecycle_state       TEXT NOT NULL CHECK (lifecycle_state IN ('Open', 'Monitoring', 'Resolved', 'Closed', 'Superseded')),
  creation_evidence_id  TEXT NOT NULL REFERENCES evidence_items(evidence_id),
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_topics (
  case_id               TEXT NOT NULL REFERENCES topic_cases(case_id),
  topic_id              TEXT NOT NULL,
  taxonomy_version      TEXT NOT NULL,
  rationale             TEXT NOT NULL,
  provenance_json       TEXT NOT NULL DEFAULT '{}',
  created_at            TEXT NOT NULL,
  PRIMARY KEY (case_id, topic_id, taxonomy_version),
  FOREIGN KEY (topic_id, taxonomy_version) REFERENCES taxonomy_topics(topic_id, taxonomy_version)
);

CREATE TABLE IF NOT EXISTS claims (
  claim_id              TEXT PRIMARY KEY,
  case_id               TEXT NOT NULL REFERENCES topic_cases(case_id),
  context_type          TEXT NOT NULL CHECK (context_type IN ('Discussion', 'Update', 'Decision', 'Agreement', 'Proposal', 'Concern', 'Commitment', 'Observation', 'Assumption')),
  topic_id              TEXT,
  taxonomy_version      TEXT NOT NULL,
  category              TEXT NOT NULL CHECK (category IN ('Risk', 'Issue', 'Action', 'Decision', 'Progress', 'Opportunity', 'Dependency', 'Strategy', 'Insight', 'Assumption')),
  classification_status TEXT NOT NULL CHECK (classification_status IN ('Candidate', 'Reviewed', 'Rejected', 'Unclassified')),
  claim_text            TEXT NOT NULL,
  confidence            REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  provenance_json       TEXT NOT NULL DEFAULT '{}',
  created_at            TEXT NOT NULL,
  FOREIGN KEY (topic_id, taxonomy_version) REFERENCES taxonomy_topics(topic_id, taxonomy_version),
  CHECK ((classification_status = 'Unclassified' AND topic_id IS NULL) OR (classification_status != 'Unclassified' AND topic_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS claim_evidence (
  claim_id              TEXT NOT NULL REFERENCES claims(claim_id),
  evidence_id           TEXT NOT NULL REFERENCES evidence_items(evidence_id),
  support_role          TEXT NOT NULL CHECK (support_role IN ('Primary', 'Supporting', 'Contradicting')),
  created_at            TEXT NOT NULL,
  PRIMARY KEY (claim_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS canonical_decisions (
  decision_id           TEXT PRIMARY KEY,
  case_id               TEXT NOT NULL REFERENCES topic_cases(case_id),
  decision_claim_id     TEXT NOT NULL REFERENCES claims(claim_id),
  decision_authority    TEXT NOT NULL,
  intended_outcome      TEXT,
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decision_claims (
  decision_id           TEXT NOT NULL REFERENCES canonical_decisions(decision_id),
  claim_id              TEXT NOT NULL REFERENCES claims(claim_id),
  contribution_type     TEXT NOT NULL CHECK (contribution_type IN ('Decision', 'Rationale', 'Assumption', 'Risk', 'Dependency', 'Action', 'Outcome')),
  created_at            TEXT NOT NULL,
  PRIMARY KEY (decision_id, claim_id, contribution_type)
);

CREATE TABLE IF NOT EXISTS governance_items (
  governance_item_id    TEXT PRIMARY KEY,
  decision_id           TEXT REFERENCES canonical_decisions(decision_id),
  case_id               TEXT NOT NULL REFERENCES topic_cases(case_id),
  exco_materiality      TEXT NOT NULL CHECK (exco_materiality IN ('Inform', 'Monitor', 'Discuss', 'Decide', 'Escalate')),
  governance_status     TEXT NOT NULL CHECK (governance_status IN ('Open', 'InReview', 'AwaitingDecision', 'Committed', 'OnTrack', 'AtRisk', 'Blocked', 'Closed', 'Superseded')),
  accountable_executive TEXT NOT NULL,
  review_cadence        TEXT NOT NULL CHECK (review_cadence IN ('weekly', 'monthly', 'quarterly', 'ad_hoc')),
  next_review_at        TEXT,
  required_intervention TEXT,
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_events (
  event_id              TEXT PRIMARY KEY,
  event_type            TEXT NOT NULL CHECK (event_type IN ('Extracted', 'Reviewed', 'Corrected', 'Superseded', 'CaseLinked', 'CaseMergeProposed', 'CaseMerged', 'GovernanceUpdated', 'Redacted', 'SourceReprocessed')),
  actor_type            TEXT NOT NULL CHECK (actor_type IN ('Automation', 'Human')),
  actor_id              TEXT NOT NULL,
  occurred_at           TEXT NOT NULL,
  reason                TEXT NOT NULL,
  affected_entity_type  TEXT NOT NULL,
  affected_entity_id    TEXT NOT NULL,
  prior_event_id        TEXT REFERENCES memory_events(event_id),
  payload_json          TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS submission_receipts (
  submission_id         TEXT PRIMARY KEY,
  contract_version      TEXT NOT NULL,
  extraction_run_id     TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('Accepted', 'Rejected', 'RetryableFailure')),
  evidence_id           TEXT REFERENCES evidence_items(evidence_id),
  response_json         TEXT NOT NULL,
  received_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_source_identity
  ON evidence_items(source_system, source_native_id, source_locator);
CREATE INDEX IF NOT EXISTS idx_claims_case_id ON claims(case_id);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_evidence_id ON claim_evidence(evidence_id);
CREATE INDEX IF NOT EXISTS idx_canonical_decisions_case_id ON canonical_decisions(case_id);
CREATE INDEX IF NOT EXISTS idx_governance_case_id ON governance_items(case_id);
CREATE INDEX IF NOT EXISTS idx_events_affected_entity ON memory_events(affected_entity_type, affected_entity_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_receipts_extraction_run ON submission_receipts(extraction_run_id);
