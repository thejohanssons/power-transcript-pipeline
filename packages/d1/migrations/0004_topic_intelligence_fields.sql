-- ============================================================
-- Copyright (c) 2026 Virrata AB. All rights reserved.
-- EIP Platform — D1 Canonical Schema
-- Migration 0004: Add intelligence fields to topic_occurrences + meeting_participants
-- ============================================================

-- Add rich intelligence fields to topic_occurrences
ALTER TABLE topic_occurrences ADD COLUMN key_facts        TEXT;
ALTER TABLE topic_occurrences ADD COLUMN decisions        TEXT; -- JSON array
ALTER TABLE topic_occurrences ADD COLUMN actions          TEXT; -- JSON array
ALTER TABLE topic_occurrences ADD COLUMN risks            TEXT; -- JSON array
ALTER TABLE topic_occurrences ADD COLUMN next_steps       TEXT;
ALTER TABLE topic_occurrences ADD COLUMN topic_family     TEXT; -- taxonomy bucket (e.g. "Resource Allocation v1.0")
ALTER TABLE topic_occurrences ADD COLUMN retrieval_anchors TEXT; -- JSON {people,projects,products,systems}
ALTER TABLE topic_occurrences ADD COLUMN r2_key           TEXT; -- pointer to .md file in R2

-- Add enrichment fields to meeting_participants
ALTER TABLE meeting_participants ADD COLUMN summary              TEXT;
ALTER TABLE meeting_participants ADD COLUMN topics_referenced    TEXT; -- JSON array of topic names
ALTER TABLE meeting_participants ADD COLUMN stance               TEXT; -- JSON {topic: stance} pairs
ALTER TABLE meeting_participants ADD COLUMN contributions_r2_key TEXT; -- pointer to full narrative in R2

-- Add topic title (specific named issue) separate from topic_id slug
ALTER TABLE topics ADD COLUMN topic_family TEXT; -- taxonomy bucket name
