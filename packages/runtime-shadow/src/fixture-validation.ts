import {
  AZURE_EXPORT_PACKAGE_SCHEMA_VERSION,
  FIXTURE_MANIFEST_SCHEMA_VERSION,
  NORMALIZED_OUTPUT_SCHEMA_VERSION,
  type AzureExportArtifactKind,
  type AzureExportPackageManifest,
  type FixtureManifest,
  type ContinuousNormalizedOutput,
  type NormalizedOutput,
  type PublicationIntent,
} from './contracts';

const ACQUISITION_MODES = new Set(['calendar', 'vtt_inbox', 'direct_vtt']);
const CLASSIFICATIONS = new Set(['internal', 'confidential']);
const VALIDATION_STATUSES = new Set(['pass', 'warning', 'fail']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FIXTURE_PREFIX = 'fixtures/';
const MAX_FIXTURE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const AZURE_EXPORT_PREFIX = 'azure-exports/';
const AZURE_EXPORT_ARTIFACT_PREFIXES: Record<AzureExportArtifactKind, string[]> = {
  transcript: [AZURE_EXPORT_PREFIX, 'transcripts/'],
  summary: [AZURE_EXPORT_PREFIX, 'summaries/'],
  people: [AZURE_EXPORT_PREFIX, 'people/'],
  topic_record: [AZURE_EXPORT_PREFIX, 'topic-records/'],
};
const AZURE_EXPORT_CONTENT_TYPES: Record<AzureExportArtifactKind, ReadonlySet<string>> = {
  transcript: new Set(['text/plain', 'text/vtt']),
  summary: new Set(['text/plain', 'text/markdown']),
  people: new Set(['text/plain', 'text/markdown']),
  topic_record: new Set(['text/markdown']),
};

export function isSafeObjectKey(key: unknown, prefix: string): key is string {
  return typeof key === 'string'
    && key.startsWith(prefix)
    && !key.startsWith('/')
    && !key.includes('..')
    && !key.includes('\\');
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isObjectReference(value: unknown, prefix: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const reference = value as Partial<FixtureManifest['transcript']>;
  return isSafeObjectKey(reference.key, prefix)
    && isSha256(reference.sha256)
    && typeof reference.bytes === 'number'
    && Number.isSafeInteger(reference.bytes)
    && reference.bytes >= 0
    && isNonEmptyString(reference.contentType);
}

function isVersionReference(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const reference = value as { name?: unknown; version?: unknown; sha256?: unknown };
  return isNonEmptyString(reference.name)
    && (reference.version === undefined || isNonEmptyString(reference.version))
    && isSha256(reference.sha256);
}

function isAzureExportArtifactReference(value: unknown, kind: AzureExportArtifactKind): boolean {
  if (!value || typeof value !== 'object') return false;
  const reference = value as { key?: unknown; sha256?: unknown; bytes?: unknown; kind?: unknown; contentType?: unknown };
  const keyIsSafe = AZURE_EXPORT_ARTIFACT_PREFIXES[kind].some((prefix) => isSafeObjectKey(reference.key, prefix));
  return keyIsSafe
    && isSha256(reference.sha256)
    && typeof reference.bytes === 'number'
    && Number.isSafeInteger(reference.bytes)
    && reference.bytes >= 0
    && reference.kind === kind
    && typeof reference.contentType === 'string'
    && AZURE_EXPORT_CONTENT_TYPES[kind].has(reference.contentType.toLowerCase());
}

export function isAzureExportPackageManifest(value: unknown): value is AzureExportPackageManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<AzureExportPackageManifest>;
  const artifacts = manifest.artifacts;
  if (!artifacts) return false;

  const allKeys = [
    artifacts.transcript?.key,
    artifacts.summary?.key,
    artifacts.people?.key,
    ...(artifacts.topicRecords ?? []).map((artifact) => artifact.key),
  ];

  return manifest.schemaVersion === AZURE_EXPORT_PACKAGE_SCHEMA_VERSION
    && isNonEmptyString(manifest.packageId)
    && isNonEmptyString(manifest.source?.system)
    && isNonEmptyString(manifest.source?.nativeId)
    && isNonEmptyString(manifest.processing?.azurePipelineVersion)
    && Array.isArray(manifest.processing?.configuration)
    && manifest.processing.configuration.every(isVersionReference)
    && isAzureExportArtifactReference(artifacts.transcript, 'transcript')
    && isAzureExportArtifactReference(artifacts.summary, 'summary')
    && isAzureExportArtifactReference(artifacts.people, 'people')
    && Array.isArray(artifacts.topicRecords)
    && artifacts.topicRecords.every((artifact) => isAzureExportArtifactReference(artifact, 'topic_record'))
    && allKeys.every((key): key is string => typeof key === 'string')
    && new Set(allKeys).size === allKeys.length;
}

export function isFixtureManifest(value: unknown): value is FixtureManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<FixtureManifest>;
  const approvedAt = Date.parse(manifest.approvedAt ?? '');
  const expiresAt = Date.parse(manifest.expiresAt ?? '');

  return manifest.schemaVersion === FIXTURE_MANIFEST_SCHEMA_VERSION
    && isNonEmptyString(manifest.fixtureId)
    && isNonEmptyString(manifest.revision)
    && ACQUISITION_MODES.has(manifest.acquisitionMode ?? '')
    && isNonEmptyString(manifest.source?.system)
    && isNonEmptyString(manifest.source?.nativeId)
    && isObjectReference(manifest.transcript, FIXTURE_PREFIX)
    && isObjectReference(manifest.azureBaseline?.normalizedOutput, FIXTURE_PREFIX)
    && isObjectReference(manifest.azureBaseline?.publicationIntent, FIXTURE_PREFIX)
    && isObjectReference(manifest.configurationSnapshot, FIXTURE_PREFIX)
    && Array.isArray(manifest.configuration)
    && manifest.configuration.every(isVersionReference)
    && isNonEmptyString(manifest.processing?.azurePipelineVersion)
    && isNonEmptyString(manifest.processing?.promptVersion)
    && isNonEmptyString(manifest.processing?.model)
    && isNonEmptyString(manifest.processing?.deployment)
    && CLASSIFICATIONS.has(manifest.classification ?? '')
    && isNonEmptyString(manifest.approvedBy)
    && isIsoTimestamp(manifest.approvedAt)
    && isIsoTimestamp(manifest.expiresAt)
    && expiresAt > approvedAt
    && expiresAt <= approvedAt + MAX_FIXTURE_RETENTION_MS;
}

export function isPublicationIntent(value: unknown): value is PublicationIntent {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Record<string, unknown>;
  return [
    'transcript', 'summary', 'peopleFile', 'topicRecords', 'masterLog',
    'confluence', 'teamsNotification', 'canonicalTopicMemory', 'legacyCloudflareSync',
  ].every((key) => typeof intent[key] === 'boolean');
}

export function isNoPublication(value: unknown): value is PublicationIntent {
  return isPublicationIntent(value) && Object.values(value).every((published) => published === false);
}

export function isContinuousNormalizedOutput(value: unknown): value is ContinuousNormalizedOutput {
  if (!value || typeof value !== 'object') return false;
  const output = value as Partial<ContinuousNormalizedOutput>;
  const processing = output.processing;
  return output.schemaVersion === NORMALIZED_OUTPUT_SCHEMA_VERSION
    && isNonEmptyString(output.source?.system)
    && isNonEmptyString(output.source?.nativeId)
    && isSha256(output.source?.transcriptSha256)
    && (processing?.runtime === 'azure' || processing?.runtime === 'cloudflare')
    && isNonEmptyString(processing?.pipelineVersion)
    // The Azure callback can omit these provenance values while the deployed
    // adapter records its own model metadata in the immutable checkpoint.
    // Preserve the callback's declared values exactly, including empty strings.
    && typeof processing?.promptVersion === 'string'
    && typeof processing?.model === 'string'
    && typeof processing?.deployment === 'string'
    && !!processing?.configurationHashes
    && Array.isArray(output.summaryAssertions)
    && Array.isArray(output.topics)
    && Array.isArray(output.people)
    && VALIDATION_STATUSES.has(output.validation?.status ?? '')
    && Array.isArray(output.validation?.reasons);
}

export function isNormalizedOutput(value: unknown): value is NormalizedOutput {
  if (!value || typeof value !== 'object') return false;
  const output = value as Partial<NormalizedOutput>;
  return output.schemaVersion === NORMALIZED_OUTPUT_SCHEMA_VERSION
    && isNonEmptyString(output.source?.system)
    && isNonEmptyString(output.source?.nativeId)
    && isSha256(output.source?.transcriptSha256)
    && ACQUISITION_MODES.has(output.source?.acquisitionMode ?? '')
    && Array.isArray(output.summaryAssertions)
    && Array.isArray(output.topics)
    && Array.isArray(output.people)
    && isPublicationIntent(output.publicationIntent)
    && (output.actualPublication === undefined || isPublicationIntent(output.actualPublication))
    && VALIDATION_STATUSES.has(output.validation?.status ?? '')
    && Array.isArray(output.validation?.reasons);
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
