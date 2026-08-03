import type { ComparisonDifference, ComparisonResult } from './contracts';

function display(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2) ?? 'null';
  return `\`\`\`json\n${serialized}\n\`\`\``;
}

function differenceSection(difference: ComparisonDifference): string {
  return [
    `### ${difference.severity.toUpperCase()} — \`${difference.path}\``,
    '',
    difference.reason,
    '',
    '**Azure baseline**',
    display(difference.azure),
    '',
    '**Cloudflare output**',
    display(difference.cloudflare),
  ].join('\n');
}

/** Produces a reviewable artifact without embedding transcript or prompt content. */
export function renderComparisonReport(comparison: ComparisonResult): string {
  const heading = comparison.status === 'blocked'
    ? 'Blocked'
    : comparison.status === 'review_required'
      ? 'Human review required'
      : 'Parity passed';
  const sections = comparison.differences.length === 0
    ? ['No normalized-output differences were detected.']
    : comparison.differences.map(differenceSection);

  return [
    '# EIP Runtime Shadow Comparison Report',
    '',
    `**Outcome:** ${heading}`,
    '',
    `- Fixture: \`${comparison.fixtureId}\``,
    `- Run: \`${comparison.runId}\``,
    `- Manifest SHA-256: \`${comparison.manifestSha256}\``,
    `- Generated: ${comparison.generatedAt}`,
    `- Differences: ${comparison.counts.blocking} blocking, ${comparison.counts.material} material, ${comparison.counts.permitted} permitted`,
    '',
    '## Differences',
    '',
    ...sections,
    '',
    '## Review policy',
    '',
    'Blocking differences fail fixture parity. Every material difference requires a recorded reviewer disposition. Permitted differences are automatically accepted after normalization.',
    '',
  ].join('\n');
}
