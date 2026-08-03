import {
  FIXTURE_MANIFEST_SCHEMA_VERSION,
  NORMALIZED_OUTPUT_SCHEMA_VERSION,
  type FixtureManifest,
  type NormalizedOutput,
  type PublicationIntent,
} from './contracts';

const ACQUISITION_MODES = new Set(['calendar', 'vtt_inbox', 'direct_vtt']);
const CLASSIFICATIONS = new Set(['internal', 'confidential']);
const VALIDATION_STATUSES = new Set(['pass', 'warning', 'fail']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FIXTURE_PREFIX = 'fixtures/';
const MAX_FIXTURE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
