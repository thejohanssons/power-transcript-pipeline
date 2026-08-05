import type { FixtureManifest, NormalizedOutput } from './contracts';

const APPROVED_SYNTHETIC_SOURCE_SYSTEM = 'synthetic_local_exercise';
const OWNERLESS_REASON = /\b(?:participant|participants|owner|owners)\b.*\b(?:identified|present)\b|\b(?:identified|present)\b.*\b(?:participant|participants|owner|owners)\b/i;

/**
 * An approved synthetic fixture intentionally has no real participant or owner
 * data. Retain substantive validation findings, but do not report a warning
 * whose only cause is that deliberate absence.
 */
export function normalizeApprovedSyntheticValidation(
  output: NormalizedOutput,
  manifest: FixtureManifest,
): NormalizedOutput {
  if (manifest.source.system !== APPROVED_SYNTHETIC_SOURCE_SYSTEM) return output;

  const normalizeValidation = (validation: NormalizedOutput['validation']) => {
    if (validation.status !== 'warning') return validation;
    const reasons = validation.reasons.filter((reason) => !OWNERLESS_REASON.test(reason));
    return reasons.length === 0 ? { status: 'pass' as const, reasons } : { ...validation, reasons };
  };

  return {
    ...output,
    validation: normalizeValidation(output.validation),
    topics: output.topics.map((topic) => ({
      ...topic,
      validation: normalizeValidation(topic.validation),
    })),
  };
}
