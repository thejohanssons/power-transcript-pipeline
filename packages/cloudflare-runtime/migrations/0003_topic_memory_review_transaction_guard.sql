-- EIP Cloudflare Runtime D1 Schema
-- Migration 0003: Transactional guard for controlled review decisions
-- The guard row is inserted and deleted inside the decision batch. It must not persist.

CREATE TABLE IF NOT EXISTS topic_memory_review_commit_guards (
  review_event_id          TEXT PRIMARY KEY,
  candidate_memory_id      TEXT NOT NULL,
  target_memory_id         TEXT NOT NULL,
  decision                 TEXT NOT NULL CHECK (decision IN ('approve_match', 'reject_match')),
  target_meeting_count_after INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS trg_topic_memory_review_commit_guard
BEFORE INSERT ON topic_memory_review_commit_guards
WHEN NOT EXISTS (
  SELECT 1
  FROM topic_memory_review_events e
  JOIN topic_memory candidate ON candidate.memory_id = NEW.candidate_memory_id
  JOIN topic_memory target ON target.memory_id = NEW.target_memory_id
  WHERE e.review_event_id = NEW.review_event_id
    AND e.candidate_memory_id = NEW.candidate_memory_id
    AND e.target_memory_id = NEW.target_memory_id
    AND e.decision = NEW.decision
    AND e.target_meeting_count_after = NEW.target_meeting_count_after
    AND (
      (NEW.decision = 'approve_match'
       AND candidate.match_status = 'merged'
       AND candidate.merged_into_memory_id = NEW.target_memory_id
       AND candidate.review_event_id = NEW.review_event_id
       AND candidate.proposed_match_memory_id = NEW.target_memory_id
       AND target.match_status != 'merged'
       AND target.merged_into_memory_id IS NULL
       AND target.meeting_count = NEW.target_meeting_count_after)
      OR
      (NEW.decision = 'reject_match'
       AND candidate.match_status = 'confirmed'
       AND candidate.merged_into_memory_id IS NULL
       AND candidate.review_event_id = NEW.review_event_id
       AND candidate.proposed_match_memory_id IS NULL
       AND target.match_status != 'merged'
       AND target.merged_into_memory_id IS NULL
       AND target.meeting_count = NEW.target_meeting_count_after)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'review decision invariant failed');
END;
