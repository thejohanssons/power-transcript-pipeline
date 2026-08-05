CREATE TABLE IF NOT EXISTS azure_export_runs (
  run_id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
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
  UNIQUE (package_id, manifest_sha256, runtime_version)
);

CREATE INDEX IF NOT EXISTS idx_azure_export_runs_package
  ON azure_export_runs (package_id, created_at DESC);
