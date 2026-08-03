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
