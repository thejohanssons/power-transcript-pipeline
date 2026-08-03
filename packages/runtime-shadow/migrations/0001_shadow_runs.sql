CREATE TABLE IF NOT EXISTS fixture_runs (
  run_id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL,
  manifest_key TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'processing', 'completed', 'failed')),
  runtime_version TEXT NOT NULL,
  adapter_provider TEXT,
  model TEXT,
  deployment TEXT,
  request_sha256 TEXT,
  response_sha256 TEXT,
  comparison_status TEXT CHECK (comparison_status IN ('pass', 'review_required', 'blocked')),
  blocking_count INTEGER NOT NULL DEFAULT 0,
  material_count INTEGER NOT NULL DEFAULT 0,
  error_class TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (fixture_id, manifest_sha256, runtime_version)
);

CREATE TABLE IF NOT EXISTS comparison_dispositions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES fixture_runs(run_id),
  path TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('accepted_equivalent', 'accepted_intentional_improvement', 'baseline_defect', 'cloudflare_defect', 'unresolved')),
  reviewer_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, path)
);

CREATE INDEX IF NOT EXISTS idx_fixture_runs_fixture ON fixture_runs (fixture_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comparison_dispositions_run ON comparison_dispositions (run_id, created_at DESC);
