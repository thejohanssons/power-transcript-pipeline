-- Topic Memory merge-integrity diagnostic report
-- READ ONLY: this file contains SELECT statements only.
--
-- Run against the Runtime D1 database after reviewing the command and target.
-- The report returns a summary row for each classification followed by detail rows.
-- It does not repair or mutate any data.

WITH latest_review AS (
  SELECT
    review_event_id,
    candidate_memory_id,
    target_memory_id,
    decision,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY candidate_memory_id
      ORDER BY created_at DESC, review_event_id DESC
    ) AS review_rank
  FROM topic_memory_review_events
), base AS (
  SELECT
    m.memory_id,
    m.match_status,
    m.merged_into_memory_id,
    m.proposed_match_memory_id,
    m.review_event_id,
    m.review_resolved_at,
    m.updated_at,
    lr.review_event_id AS latest_audit_event_id,
    lr.target_memory_id AS audit_target_memory_id,
    lr.decision AS audit_decision,
    lr.created_at AS audit_created_at,
    target.memory_id AS target_exists,
    target.match_status AS target_match_status,
    CASE
      WHEN m.match_status = 'merged' AND m.merged_into_memory_id IS NULL
        THEN 'merged_missing_target'
      WHEN m.match_status = 'merged' AND lr.target_memory_id IS NULL
        THEN 'merged_missing_audit'
      WHEN m.match_status = 'merged'
        AND m.merged_into_memory_id IS NOT NULL
        AND lr.target_memory_id IS NOT NULL
        AND m.merged_into_memory_id <> lr.target_memory_id
        THEN 'merged_target_audit_mismatch'
      WHEN m.match_status = 'merged' AND target.memory_id IS NULL
        THEN 'merged_target_missing'
      WHEN m.match_status = 'merged' AND target.match_status = 'merged'
        THEN 'merged_target_is_merged'
      WHEN m.match_status = 'merged'
        THEN 'healthy_merged'
      WHEN m.match_status <> 'merged' AND m.merged_into_memory_id IS NOT NULL
        THEN 'non_merged_has_target'
      ELSE 'not_merged'
    END AS report_status
  FROM topic_memory m
  LEFT JOIN latest_review lr
    ON lr.candidate_memory_id = m.memory_id
   AND lr.review_rank = 1
  LEFT JOIN topic_memory target
    ON target.memory_id = m.merged_into_memory_id
), summary AS (
  SELECT
    report_status,
    COUNT(*) AS issue_count
  FROM base
  GROUP BY report_status
)
SELECT
  'summary' AS row_type,
  report_status,
  issue_count,
  NULL AS memory_id,
  NULL AS match_status,
  NULL AS merged_into_memory_id,
  NULL AS proposed_match_memory_id,
  NULL AS review_event_id,
  NULL AS latest_audit_event_id,
  NULL AS audit_target_memory_id,
  NULL AS target_match_status,
  NULL AS updated_at
FROM summary

UNION ALL

SELECT
  'detail' AS row_type,
  report_status,
  1 AS issue_count,
  memory_id,
  match_status,
  merged_into_memory_id,
  proposed_match_memory_id,
  review_event_id,
  latest_audit_event_id,
  audit_target_memory_id,
  target_match_status,
  updated_at
FROM base
WHERE report_status <> 'not_merged'

ORDER BY row_type, report_status, memory_id;
