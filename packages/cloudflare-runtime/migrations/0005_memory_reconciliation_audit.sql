CREATE TABLE IF NOT EXISTS memory_reconciliation_audit (
  reconciliation_id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  classification TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT NOT NULL,
  invalidated_meeting_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_reconciliation_memory
  ON memory_reconciliation_audit(memory_id, created_at DESC);
