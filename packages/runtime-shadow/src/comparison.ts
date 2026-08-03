import type {
  ComparisonDifference,
  ComparisonResult,
  ComparisonSeverity,
  NormalizedOutput,
  PublicationIntent,
} from './contracts';

const CONTROLLED_TOPIC_FIELDS = ['topicId', 'topic', 'domain', 'category', 'contextType'] as const;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).sort().join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function equal(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function difference(
  path: string,
  severity: ComparisonSeverity,
  reason: string,
  azure: unknown,
  cloudflare: unknown,
): ComparisonDifference {
  return { path, severity, reason, azure, cloudflare };
}

function comparePublicationIntent(
  azure: PublicationIntent,
  cloudflare: PublicationIntent,
): ComparisonDifference[] {
  return Object.keys(azure).flatMap((key) => {
    const typedKey = key as keyof PublicationIntent;
    return azure[typedKey] === cloudflare[typedKey]
      ? []
      : [difference(`publicationIntent.${typedKey}`, 'blocking', 'Publication intent changed', azure[typedKey], cloudflare[typedKey])];
  });
}

function assertionTexts(output: NormalizedOutput): string[] {
  return [
    ...output.summaryAssertions.map((item) => item.text),
    ...output.topics.flatMap((topic) => [
      ...topic.keyFacts.map((item) => item.text),
      ...topic.decisions.map((item) => item.text),
      ...topic.actions.map((item) => item.text),
      ...topic.risks.map((item) => item.text),
    ]),
  ].map((value) => value.trim().toLowerCase()).filter(Boolean).sort();
}

export function compareNormalizedOutputs(
  fixtureId: string,
  manifestSha256: string,
  runId: string,
  azure: NormalizedOutput,
  cloudflare: NormalizedOutput,
): ComparisonResult {
  const differences: ComparisonDifference[] = [];

  if (!equal(azure.source, cloudflare.source)) {
    differences.push(difference('source', 'blocking', 'Source identity, mode, or transcript hash differs', azure.source, cloudflare.source));
  }
  if (azure.schemaVersion !== cloudflare.schemaVersion) {
    differences.push(difference('schemaVersion', 'blocking', 'Normalized output schema differs', azure.schemaVersion, cloudflare.schemaVersion));
  }
  if (!equal(azure.publicationIntent, cloudflare.publicationIntent)) {
    differences.push(...comparePublicationIntent(azure.publicationIntent, cloudflare.publicationIntent));
  }
  if (!equal(assertionTexts(azure), assertionTexts(cloudflare))) {
    differences.push(difference('assertions', 'blocking', 'Evidence-backed facts, decisions, actions, or risks differ', assertionTexts(azure), assertionTexts(cloudflare)));
  }
  if (!equal(azure.validation, cloudflare.validation)) {
    differences.push(difference('validation', 'blocking', 'Required validation result differs', azure.validation, cloudflare.validation));
  }

  const azureTopics = [...azure.topics].sort((a, b) => `${a.topicId}|${a.topic}`.localeCompare(`${b.topicId}|${b.topic}`));
  const cloudflareTopics = [...cloudflare.topics].sort((a, b) => `${a.topicId}|${a.topic}`.localeCompare(`${b.topicId}|${b.topic}`));
  if (azureTopics.length !== cloudflareTopics.length) {
    differences.push(difference('topics.length', 'material', 'Topic count differs', azureTopics.length, cloudflareTopics.length));
  }
  for (let index = 0; index < Math.min(azureTopics.length, cloudflareTopics.length); index += 1) {
    for (const field of CONTROLLED_TOPIC_FIELDS) {
      if (azureTopics[index][field] !== cloudflareTopics[index][field]) {
        differences.push(difference(`topics[${index}].${field}`, 'material', 'Controlled topic classification differs', azureTopics[index][field], cloudflareTopics[index][field]));
      }
    }
    if (!equal(azureTopics[index].owners, cloudflareTopics[index].owners) || azureTopics[index].confidence !== cloudflareTopics[index].confidence) {
      differences.push(difference(`topics[${index}].ownership`, 'material', 'Owner or confidence differs', { owners: azureTopics[index].owners, confidence: azureTopics[index].confidence }, { owners: cloudflareTopics[index].owners, confidence: cloudflareTopics[index].confidence }));
    }
  }
  if (!equal(azure.people, cloudflare.people)) {
    differences.push(difference('people', 'material', 'Person attribution differs', azure.people, cloudflare.people));
  }
  if (!equal(azure.classification, cloudflare.classification)) {
    differences.push(difference('classification', 'material', 'Meeting classification differs', azure.classification, cloudflare.classification));
  }

  const counts: Record<ComparisonSeverity, number> = { blocking: 0, material: 0, permitted: 0 };
  for (const item of differences) counts[item.severity] += 1;
  const status = counts.blocking > 0 ? 'blocked' : counts.material > 0 ? 'review_required' : 'pass';

  return {
    schemaVersion: '1.0.0',
    fixtureId,
    manifestSha256,
    runId,
    generatedAt: new Date().toISOString(),
    status,
    differences,
    counts,
  };
}
