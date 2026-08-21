-- Topic observation ↔ topic memory relationship.
-- Applied idempotently to production through the D1 binding because older runtime
-- databases may not contain topics.memory_id.

ALTER TABLE topic_memory ADD COLUMN root_topic_id TEXT;
ALTER TABLE topics ADD COLUMN memory_id TEXT;
CREATE INDEX IF NOT EXISTS idx_topics_memory ON topics(memory_id);
CREATE INDEX IF NOT EXISTS idx_topic_memory_root_topic ON topic_memory(root_topic_id);
