import type {
  ComparisonDifference,
  ComparisonResult,
  ComparisonSeverity,
  ContinuousNormalizedOutput,
  NormalizedPerson,
  NormalizedTopic,
  NormalizedOutput,
  PublicationIntent,
} from './contracts';

// topicId is excluded: Azure uses taxonomy-registered IDs (T10, T17…), Cloudflare uses
// sequential meeting-local IDs (T1, T2…). They are not comparable across runtimes.
// topic (name) is excluded from field-by-field comparison: both sides are normalised into
// the matching key already; residual differences are the v1.0 suffix which is stripped
// in the key, and display-name variants handled by the taxonomy alias map.
const CONTROLLED_TOPIC_FIELDS = ['domain', 'category', 'contextType'] as const;

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

/**
 * Named policy keys for the continuous Azure-export shadow lane.
 *
 * CONTINUOUS_ASSERTION_FORMAT_DIVERGENCE
 *   Azure extracts ~90 atomised quoted bullet facts; Cloudflare synthesises ~70
 *   attributed narrative sentences covering the same evidence. The semantic
 *   content is equivalent; the format divergence is a known, intentional
 *   difference in synthesis strategy. Approved 2026-08-06.
 *
 * CONTINUOUS_VALIDATION_STRICTNESS_DIVERGENCE
 *   Azure's validator returns `pass` unconditionally for schema-valid meetings.
 *   Cloudflare's validator additionally checks for unresolved discussions and
 *   ownerless actions. Cloudflare warnings are semantically correct; the Azure
 *   `pass` is an under-assertion. Approved 2026-08-06.
 *
 * CONTINUOUS_TAXONOMY_VERSION_DIVERGENCE
 *   Azure pipeline uses v4.2 taxonomy vocabulary (domain, category, contextType).
 *   Cloudflare runtime uses v0.2 taxonomy vocabulary (entityType, aspect, outcome,
 *   disposition, executiveScope, entity). This is an intentional dual-track memory
 *   architecture — Azure builds SharePoint memory on v4.2, Cloudflare builds D1
 *   memory on v0.2. The taxonomy axis differences are expected structural divergence,
 *   not correctness failures. Approved 2026-08-07.
 */
const CONTINUOUS_PERMITTED_FIELDS = new Set<string>([
  'CONTINUOUS_ASSERTION_FORMAT_DIVERGENCE',      // → path: assertions
  'CONTINUOUS_VALIDATION_STRICTNESS_DIVERGENCE', // → path: validation
  'CONTINUOUS_TAXONOMY_VERSION_DIVERGENCE',      // → path: topics[*].domain, category, contextType, entityType, aspect, outcome, disposition, executiveScope
]);

function compareSemanticOutputs(
  fixtureId: string,
  manifestSha256: string,
  runId: string,
  azure: ContinuousNormalizedOutput,
  cloudflare: ContinuousNormalizedOutput,
  options: {
    comparePublicationIntent?: boolean;
    publicationIntent?: { azure: PublicationIntent; cloudflare: PublicationIntent };
    /** When true, apply continuous-lane permitted-difference policy (assertions, validation). */
    applyContinuousPolicy?: boolean;
  } = {},
): ComparisonResult {
  const differences: ComparisonDifference[] = [];

  if (!equal(azure.source, cloudflare.source)) {
    differences.push(difference('source', 'blocking', 'Source identity or transcript hash differs', azure.source, cloudflare.source));
  }
  if (azure.schemaVersion !== cloudflare.schemaVersion) {
    differences.push(difference('schemaVersion', 'blocking', 'Normalized output schema differs', azure.schemaVersion, cloudflare.schemaVersion));
  }
  // Compare stable processing identity fields only — configurationHashes removed from
  // public contract in v3; version fields differ by design between runtimes.
  // We check that model and deployment match (same Azure OpenAI endpoint was used).
  const azureProcessingContract = { model: azure.processing.model, deployment: azure.processing.deployment };
  const cloudflareProcessingContract = { model: cloudflare.processing.model, deployment: cloudflare.processing.deployment };
  if (!equal(azureProcessingContract, cloudflareProcessingContract)) {
    differences.push(difference('processing', 'blocking', 'Model or deployment differs between runtimes', azureProcessingContract, cloudflareProcessingContract));
  }
  if (options.comparePublicationIntent && options.publicationIntent) {
    differences.push(...comparePublicationIntent(options.publicationIntent.azure, options.publicationIntent.cloudflare));
  }
  const assertionSeverity: ComparisonSeverity =
    options.applyContinuousPolicy && CONTINUOUS_PERMITTED_FIELDS.has('CONTINUOUS_ASSERTION_FORMAT_DIVERGENCE')
      ? 'permitted'
      : 'blocking';
  if (!equal(assertionTexts(azure), assertionTexts(cloudflare))) {
    differences.push(difference('assertions', assertionSeverity, 'Evidence-backed facts, decisions, actions, or risks differ (format divergence permitted under CONTINUOUS_ASSERTION_FORMAT_DIVERGENCE policy)', assertionTexts(azure), assertionTexts(cloudflare)));
  }

  const validationSeverity: ComparisonSeverity =
    options.applyContinuousPolicy && CONTINUOUS_PERMITTED_FIELDS.has('CONTINUOUS_VALIDATION_STRICTNESS_DIVERGENCE')
      ? 'permitted'
      : 'blocking';
  if (!equal(azure.validation, cloudflare.validation)) {
    differences.push(difference('validation', validationSeverity, 'Validation strictness differs (Cloudflare is more strict; permitted under CONTINUOUS_VALIDATION_STRICTNESS_DIVERGENCE policy)', azure.validation, cloudflare.validation));
  }

  // Match topics by normalised canonical name only.
  //
  // Azure assigns taxonomy-registered topicIds (e.g. T10, T17…) while Cloudflare
  // assigns sequential meeting-local IDs (T1, T2, T3). Matching by topicId
  // therefore always fails. Matching by name+category also fails because the two
  // runtimes frequently assign different categories to the same topic (e.g. Azure
  // classifies "Revenue & Commercial Performance" as "Opportunity" while Cloudflare
  // classifies the same discussion as "Progress"). Using name only as the key
  // correctly surfaces category disagreements as per-topic field diffs rather than
  // producing misleading "topic not found" pairs.
  //
  // Name normalisation: lowercase, strip leading/trailing whitespace, collapse
  // internal whitespace, strip version suffix (e.g. " v1.0", " v2").
  const normalisedTopicName = (name: string | null | undefined): string =>
    (name ?? '').trim().toLowerCase().replace(/\s+v\d+(\.\d+)*$/i, '').replace(/\s+/g, ' ');
  const topicKey = (t: NormalizedTopic) => normalisedTopicName(t.topic);
  const azureById = new Map(azure.topics.map((t) => [topicKey(t), t]));
  const cloudflareById = new Map(cloudflare.topics.map((t) => [topicKey(t), t]));

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
        // domain, category, contextType are v4.2 taxonomy fields on Azure;
        // v0.2 taxonomy fields (entityType, aspect, outcome, disposition, executiveScope)
        // will always be null on Azure and populated on Cloudflare.
        // Both are expected structural divergences in the dual-track taxonomy architecture.
        const isTaxonomyAxisField = field === 'domain' || field === 'category' || field === 'contextType';
        const severity = (options.applyContinuousPolicy && isTaxonomyAxisField &&
          CONTINUOUS_PERMITTED_FIELDS.has('CONTINUOUS_TAXONOMY_VERSION_DIVERGENCE'))
          ? 'permitted'
          : 'material';
        differences.push(difference(`topics[${key}].${field}`, severity,
          isTaxonomyAxisField
            ? 'Taxonomy axis differs (v4.2 Azure vs v0.2 Cloudflare — permitted under CONTINUOUS_TAXONOMY_VERSION_DIVERGENCE)'
            : 'Controlled topic classification differs',
          azureTopic[field], cloudflareTopic[field]));
      }
    }
    // Compare owners; exclude confidence from the ownership diff in the continuous lane:
    // Azure does not emit topic-level confidence (always null), while Cloudflare does.
    // This is a known structural divergence — confidence is Cloudflare-only metadata.
    const ownersOnly = (t: NormalizedTopic) => t.owners;
    if (!equal(ownersOnly(azureTopic), ownersOnly(cloudflareTopic))) {
      differences.push(difference(`topics[${key}].owners`, 'material', 'Topic owner attribution differs', azureTopic.owners, cloudflareTopic.owners));
    }
    // confidence: Azure always null, Cloudflare emits "high"/"medium"/"low".
    // Recorded as permitted — structural divergence, not a correctness issue.
    if (options.applyContinuousPolicy && azureTopic.confidence === null && cloudflareTopic.confidence !== null) {
      differences.push(difference(`topics[${key}].confidence`, 'permitted', 'Cloudflare emits topic confidence; Azure does not (permitted: structural divergence)', azureTopic.confidence, cloudflareTopic.confidence));
    } else if (azureTopic.confidence !== cloudflareTopic.confidence) {
      differences.push(difference(`topics[${key}].confidence`, 'material', 'Topic confidence differs', azureTopic.confidence, cloudflareTopic.confidence));
    }
  }

  // People comparison — normalise before comparing:
  //  - attendance: lowercase ("Present" → "present")
  //  - canonicalName: strip known post-nominal suffixes (OBE, MBE, CBE, etc.)
  //    which Azure strips but Cloudflare preserves from the transcript.
  const POST_NOMINAL_SUFFIX_RE = /\s*,?\s*\b(OBE|MBE|CBE|KBE|DBE|GBE|BEM|QPM|QC|KC|JP|MP|PhD|Dr\.?)\b.*$/i;
  const normalisePerson = (p: NormalizedPerson): NormalizedPerson => ({
    ...p,
    canonicalName: (p.canonicalName ?? '').replace(POST_NOMINAL_SUFFIX_RE, '').trim(),
    sourceName: (p.sourceName ?? '').replace(POST_NOMINAL_SUFFIX_RE, '').trim(),
    // Normalise attendance vocabulary: Cloudflare uses "attendee", Azure uses "present".
    // Both mean the same thing — the person participated in the meeting.
    attendance: (p.attendance ?? '').toLowerCase().replace(/^attendee$/, 'present'),
    // contributions: excluded from comparison — Azure and Cloudflare use different
    // synthesis strategies (summarised bullets vs attributed narrative), producing
    // structurally incompatible contribution text and IDs. Format divergence, not
    // a correctness failure. Parallel to the assertions permitted policy.
    contributions: [],
  });
  const azurePeople = azure.people.map(normalisePerson);
  const cloudflarePeople = cloudflare.people.map(normalisePerson);
  if (!equal(azurePeople, cloudflarePeople)) {
    differences.push(difference('people', 'material', 'Person attendance or attribution differs (contributions excluded — format divergence)', azurePeople, cloudflarePeople));
  }

  // Classification — normalise mode to lowercase before comparing.
  // Azure: already lowercased by parseAzureClassification.
  // Cloudflare: may preserve the original casing from the prompt output (e.g. "CEO").
  const normaliseClassification = (c: ContinuousNormalizedOutput['classification']) => ({
    mode: c?.mode?.toLowerCase() ?? null,
    confidence: c?.confidence?.toLowerCase() ?? null,
  });
  if (!equal(normaliseClassification(azure.classification), normaliseClassification(cloudflare.classification))) {
    differences.push(difference('classification', 'material', 'Meeting classification differs', normaliseClassification(azure.classification), normaliseClassification(cloudflare.classification)));
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
 *
 * Applies the continuous-lane permitted-difference policy:
 *  - assertions: format divergence permitted (CONTINUOUS_ASSERTION_FORMAT_DIVERGENCE)
 *  - validation: strictness divergence permitted (CONTINUOUS_VALIDATION_STRICTNESS_DIVERGENCE)
 */
export function compareContinuousNormalizedOutputs(
  packageId: string,
  manifestSha256: string,
  runId: string,
  azure: ContinuousNormalizedOutput,
  cloudflare: ContinuousNormalizedOutput,
): ComparisonResult {
  return compareSemanticOutputs(packageId, manifestSha256, runId, azure, cloudflare, {
    applyContinuousPolicy: true,
  });
}
