export type FixtureRunRequestAction = 'create' | 'replay' | 'recover';

/**
 * Keeps duplicate submission and retry recovery decisions deterministic.
 * A failed run retains its immutable fixture reservation and is re-queued under
 * the same run ID; all other existing states are replayed without another send.
 */
export function fixtureRunRequestAction(existingState: string | undefined): FixtureRunRequestAction {
  if (existingState === undefined) return 'create';
  return existingState === 'failed' ? 'recover' : 'replay';
}

/**
 * The conditional D1 state transition grants processing ownership only when it
 * updates one queued or failed reservation. A delayed delivery must otherwise
 * no-op; allowing failed also preserves bounded Queue retries.
 */
export const CLAIM_FIXTURE_RUN_PROCESSING_SQL =
  "UPDATE fixture_runs SET state = 'processing', updated_at = ? WHERE run_id = ? AND fixture_id = ? AND manifest_sha256 = ? AND runtime_version = ? AND state IN ('queued', 'failed')";

export const RECOVER_FIXTURE_RUN_SQL =
  "UPDATE fixture_runs SET state = 'queued', error_class = NULL, updated_at = ? WHERE run_id = ? AND state = 'failed'";

// Preserve an active claim if a recovered queue send fails after a delayed
// delivery has already claimed the newly queued reservation.
export const MARK_QUEUE_SUBMISSION_FAILED_SQL =
  "UPDATE fixture_runs SET state = 'failed', error_class = ?, updated_at = ? WHERE run_id = ? AND state = 'queued'";

export function didClaimFixtureRunProcessing(changedRows: number): boolean {
  return changedRows === 1;
}
