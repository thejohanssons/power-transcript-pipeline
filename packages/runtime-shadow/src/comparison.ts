import type {
  ComparisonDifference,
  ComparisonResult,
  ComparisonSeverity,
  ContinuousNormalizedOutput,
  NormalizedTopic,
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

function assertionTexts(output: Pick<ContinuousNormalizedOutput, 'summaryAssertions' | 'topics'>): string[] {
  // The normalized output presents the same evidence in both the leadership
  // summary and a topic projection. Compare the distinct semantic assertions,
  // rather than treating a presentation-level repeat as a second claim.
  return [...new Set([
    ...output.summaryAssertions.map((item) => item.text),
    ...output.topics.flatMap((topic) => [
      ...topic.keyFacts.map((item) => item.text),
      ...topic.decisions.map((item) => item.text),
      ...topic.actions.map((item) => item.text),
      ...topic.risks.map((item) => item.text),
    ]),
  ].map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

function compareSemanticOutputs(
  fixtureId: string,
  manifestSha256: string,
  runId: string,
  azure: ContinuousNormalizedOutput,
  cloudflare: ContinuousNormalizedOutput,
  options: { comparePublicationIntent?: boolean; publicationIntent?: { azure: PublicationIntent; cloudflare: PublicationIntent } } = {},
): ComparisonResult {
  const differences: ComparisonDifference[] = [];

  if (!equal(azure.source, cloudflare.source)) {
    differences.push(difference('source', 'blocking', 'Source identity or transcript hash differs', azure.source, cloudflare.source));
  }
  if (azure.schemaVersion !== cloudflare.schemaVersion) {
    differences.push(difference('schemaVersion', 'blocking', 'Normalized output schema differs', azure.schemaVersion, cloudflare.schemaVersion));
  }
  const azureProcessingContract = {
    pipelineVersion: azure.processing.pipelineVersion,
    promptVersion: azure.processing.promptVersion,
    model: azure.processing.model,
    deployment: azure.processing.deployment,
    configurationHashes: azure.processing.configurationHashes,
  };
  const cloudflareProcessingContract = {
    pipelineVersion: cloudflare.processing.pipelineVersion,
    promptVersion: cloudflare.processing.promptVersion,
    model: cloudflare.processing.model,
    deployment: cloudflare.processing.deployment,
    configurationHashes: cloudflare.processing.configurationHashes,
  };
  if (!equal(azureProcessingContract, cloudflareProcessingContract)) {
    differences.push(difference('processing', 'blocking', 'Pipeline, prompt, model, deployment, or configuration contract differs', azureProcessingContract, cloudflareProcessingContract));
  }
  if (options.comparePublicationIntent && options.publicationIntent) {
    differences.push(...comparePublicationIntent(options.publicationIntent.azure, options.publicationIntent.cloudflare));
  }
  if (!equal(assertionTexts(azure), assertionTexts(cloudflare))) {
    differences.push(difference('assertions', 'blocking', 'Evidence-backed facts, decisions, actions, or risks differ', assertionTexts(azure), assertionTexts(cloudflare)));
  }
  if (!equal(azure.validation, cloudflare.validation)) {
    differences.push(difference('validation', 'blocking', 'Required validation result differs', azure.validation, cloudflare.validation));
  }

  // Match topics by stable composite key: topicId + category.
  // Azure topic records can reuse the same topicId across different categories
  // (e.g. T13/Risk and T13/Dependency are distinct topic entries). Using only
  // topicId as the key would cause later entries to silently overwrite earlier ones.
  // Positional matching on sorted arrays is unreliable when topic counts or
  // ordering diverge between Azure and Cloudflare outputs.
  const topicKey = (t: NormalizedTopic) => `${t.topicId ?? ''}|${t.category ?? ''}`;
  const azureById = new Map(azure.topics.filter((t) => t.topicId !== null).map((t) => [topicKey(t), t]));
  const cloudflareById = new Map(cloudflare.topics.filter((t) => t.topicId !== null).map((t) => [topicKey(t), t]));

  // Topics present in Azure but not matched by Cloudflare.
  for (const [key, azureTopic] of azureById) {
    if (!cloudflareById.has(key)) {
      differences.push(difference(`topics[${key}]`, 'material', 'Azure topic not reproduced by Cloudflare', { topicId: azureTopic.topicId, topic: azureTopic.topic, category: azureTopic.category }, null));
    }
  }
  // Topics produced by Cloudflare that Azure did not declare.
  for (const [key, cloudflareTopic] of cloudflareById) {
    if (!azureById.has(key)) {
      differences.push(difference(`topics[${key}]`, 'material', 'Cloudflare produced a topic not declared by Azure', null, { topicId: cloudflareTopic.topicId, topic: cloudflareTopic.topic, category: cloudflareTopic.category }));
    }
  }
  // Compare matched pairs by controlled fields.
  for (const [key, azureTopic] of azureById) {
    const cloudflareTopic = cloudflareById.get(key);
    if (!cloudflareTopic) continue;
    for (const field of CONTROLLED_TOPIC_FIELDS) {
      if (azureTopic[field] !== cloudflareTopic[field]) {
        differences.push(difference(`topics[${key}].${field}`, 'material', 'Controlled topic classification differs', azureTopic[field], cloudflareTopic[field]));
      }
    }
    if (!equal(azureTopic.owners, cloudflareTopic.owners) || azureTopic.confidence !== cloudflareTopic.confidence) {
      differences.push(difference(`topics[${key}].ownership`, 'material', 'Owner or confidence differs', { owners: azureTopic.owners, confidence: azureTopic.confidence }, { owners: cloudflareTopic.owners, confidence: cloudflareTopic.confidence }));
    }
  }

  // Null-topicId topics on either side cannot be matched by ID — compare them
  // positionally as a fallback, noting the instability.
  const azureNullId = azure.topics.filter((t) => t.topicId === null);
  const cloudflareNullId = cloudflare.topics.filter((t) => t.topicId === null);
  if (azureNullId.length !== cloudflareNullId.length) {
    differences.push(difference('topics.nullId.length', 'material', 'Count of topics without stable IDs differs (positional matching unreliable)', azureNullId.length, cloudflareNullId.length));
  }
  for (let index = 0; index < Math.min(azureNullId.length, cloudflareNullId.length); index += 1) {
    for (const field of CONTROLLED_TOPIC_FIELDS) {
      if (azureNullId[index][field] !== cloudflareNullId[index][field]) {
        differences.push(difference(`topics[null-${index}].${field}`, 'material', 'Controlled topic classification differs (positional, no stable ID)', azureNullId[index][field], cloudflareNullId[index][field]));
      }
    }
    if (!equal(azureNullId[index].owners, cloudflareNullId[index].owners) || azureNullId[index].confidence !== cloudflareNullId[index].confidence) {
      differences.push(difference(`topics[null-${index}].ownership`, 'material', 'Owner or confidence differs (positional, no stable ID)', { owners: azureNullId[index].owners, confidence: azureNullId[index].confidence }, { owners: cloudflareNullId[index].owners, confidence: cloudflareNullId[index].confidence }));
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

/** Legacy frozen-fixture comparator: business publication intent remains in scope. */
export function compareNormalizedOutputs(
  fixtureId: string,
  manifestSha256: string,
  runId: string,
  azure: NormalizedOutput,
  cloudflare: NormalizedOutput,
): ComparisonResult {
  return compareSemanticOutputs(fixtureId, manifestSha256, runId, azure, cloudflare, {
    comparePublicationIntent: true,
    publicationIntent: { azure: azure.publicationIntent, cloudflare: cloudflare.publicationIntent },
  });
}

/**
 * Continuous Azure-export parity deliberately compares semantic processing only.
 * Azure publication and Cloudflare D1/R2 persistence are separate concerns.
 */
export function compareContinuousNormalizedOutputs(
  packageId: string,
  manifestSha256: string,
  runId: string,
  azure: ContinuousNormalizedOutput,
  cloudflare: ContinuousNormalizedOutput,
): ComparisonResult {
  return compareSemanticOutputs(packageId, manifestSha256, runId, azure, cloudflare);
}
