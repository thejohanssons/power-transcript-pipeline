export type AzureExportRunRequestAction = 'create' | 'replay' | 'recover';

/**
 * Keeps repeated Azure callbacks idempotent. A failed reservation is retried
 * under its original run ID; every other existing state is replayed without
 * queueing another model invocation.
 */
export function azureExportRunRequestAction(existingState: string | undefined): AzureExportRunRequestAction {
  if (existingState === undefined) return 'create';
  return existingState === 'failed' ? 'recover' : 'replay';
}

/**
 * Grants processing ownership to exactly one queued reservation. The package,
 * manifest digest, and runtime version prevent delayed queue deliveries from
 * processing a newer or unrelated package.
 */
export const CLAIM_AZURE_EXPORT_RUN_PROCESSING_SQL =
  "UPDATE azure_export_runs SET state = 'processing', updated_at = ? WHERE run_id = ? AND package_id = ? AND manifest_sha256 = ? AND runtime_version = ? AND state IN ('queued', 'failed')";

export const RECOVER_AZURE_EXPORT_RUN_SQL =
  "UPDATE azure_export_runs SET state = 'queued', error_class = NULL, updated_at = ? WHERE run_id = ? AND state = 'failed'";

export const MARK_AZURE_EXPORT_QUEUE_SUBMISSION_FAILED_SQL =
  "UPDATE azure_export_runs SET state = 'failed', error_class = ?, updated_at = ? WHERE run_id = ? AND state = 'queued'";

export function didClaimAzureExportRunProcessing(changedRows: number): boolean {
  return changedRows === 1;
}
