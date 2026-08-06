import type {
  AzureExportPackageManifest,
  EvidenceAssertion,
  NormalizedPerson,
  NormalizedTopic,
} from './contracts';
import { parseFixtureTranscript, type ParsedTranscript } from './fixture-processing';

export interface AzureArtifactHeader {
  metadata: Record<string, string>;
  body: string;
}

export interface AzureExportBaselineProjection {
  transcript: ParsedTranscript;
  summaryAssertions: EvidenceAssertion[];
  people: NormalizedPerson[];
  topics: NormalizedTopic[];
}

const EXTERNAL_LINK_FIELD = /(?:BACK-LINK|SOURCE_MEETING)/i;
const EMPTY_VALUE = /^(?:none|unknown)?$/i;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizedKey(value: string): string {
  return value.trim().replace(/\s+/g, '_').toUpperCase();
}

function cleanValue(value: string): string | null {
  const cleaned = normalizeWhitespace(value.replace(/\[[^\]]*]\([^)]*\)/g, '').replace(/https?:\/\/\S+/gi, ''));
  return cleaned && !EMPTY_VALUE.test(cleaned) ? cleaned : null;
}

function assertions(values: string[], prefix: string): EvidenceAssertion[] {
  return [...new Set(values.map(cleanValue).filter((value): value is string => value !== null))]
    .map((text, index) => ({ id: `${prefix}-${index + 1}`, text }));
}

function section(text: string, heading: string, nextHeadings: string[]): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
  if (start < 0) return '';
  const next = nextHeadings.map((item) => item.toLowerCase());
  const endOffset = lines.slice(start + 1).findIndex((line) => {
    const candidate = line.trim().toLowerCase();
    return next.some((heading) => candidate === heading || candidate.startsWith(heading));
  });
  return lines.slice(start + 1, endOffset < 0 ? undefined : start + 1 + endOffset).join('\n');
}

function linesAsAssertions(text: string, prefix: string): EvidenceAssertion[] {
  return assertions(text.split('\n').map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s*/, '').replace(/^\[[^\]]+]\s*[^:]*:\s*/i, '')), prefix);
}

/** Parses the Azure key/value header and excludes external publication links. */
export function parseAzureArtifactHeader(artifact: string): AzureArtifactHeader {
  const lines = artifact.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const hasOpeningDelimiter = lines[0]?.trim() === '---';
  const closingIndex = hasOpeningDelimiter
    ? lines.slice(1).findIndex((line) => line.trim() === '---') + 1
    : lines.findIndex((line) => line.trim() === '---');
  if (closingIndex < 0) throw new Error('Azure export artifact metadata header is not closed');

  const metadata: Record<string, string> = {};
  const headerLines = lines.slice(hasOpeningDelimiter ? 1 : 0, closingIndex);
  for (const line of headerLines) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = normalizedKey(line.slice(0, separator));
    if (EXTERNAL_LINK_FIELD.test(key)) continue;
    const value = cleanValue(line.slice(separator + 1));
    if (value) metadata[key] = value;
  }
  return { metadata, body: lines.slice(closingIndex + 1).join('\n').trim() };
}

/** Extracts the VTT evidence body; Azure's header is never sent to the model. */
export function parseAzureTranscript(artifact: string): { metadata: Record<string, string>; transcript: ParsedTranscript } {
  const { metadata, body } = parseAzureArtifactHeader(artifact);
  if (!/^WEBVTT(?:\s|$)/i.test(body)) throw new Error('Azure export transcript has no WEBVTT body');
  return { metadata, transcript: parseFixtureTranscript(body) };
}

/** Extracts tagged Azure summary statements without inventing content for empty fields. */
export function parseAzureSummary(artifact: string): EvidenceAssertion[] {
  const { body } = parseAzureArtifactHeader(artifact);
  const values = body.split('\n').flatMap((line) => {
    const match = line.match(/^\s*[-*]?\s*(?:\[[^\]]+]\s*)?(?:Decision|Action|Risk(?:s?\s*\/\s*Issues?)?|Key Fact)\s*:\s*(.+)$/i);
    return match ? [match[1]] : [];
  });
  return assertions(values, 'summary');
}

/** Parses repeated people blocks while retaining duplicate identities as unresolved records. */
export function parseAzurePeople(artifact: string): NormalizedPerson[] {
  const { body } = parseAzureArtifactHeader(artifact);
  const blocks = body.split(/^---\s*$/m).map((block) => block.trim()).filter(Boolean);
  return blocks.flatMap((block, index) => {
    const name = block.match(/^PERSON:\s*(.+)$/mi)?.[1];
    if (!name) return [];
    const sourceName = normalizeWhitespace(name.replace(/\s*\(duplicate canonical name already covered\)\s*$/i, ''));
    const attendance = cleanValue(block.match(/^ATTENDANCE:\s*(.+)$/mi)?.[1] ?? '');
    const readSection = (heading: string): EvidenceAssertion[] => linesAsAssertions(section(block, heading, ['CONTRIBUTIONS:', 'ACTIONS ASSIGNED TO THIS PERSON:', 'ACTIONS ASSIGNED BY THIS PERSON:', 'DECISIONS OWNED:', 'RISKS RAISED:', 'TOPICS REFERENCED:', 'STANCE:', 'SUMMARY:']), `person-${index + 1}-${heading.toLowerCase().replace(/[^a-z]+/g, '-')}`);
    const topics = (block.match(/^TOPICS REFERENCED:\s*(.+)$/mi)?.[1] ?? '').split(',').map((topic) => topic.trim()).filter((topic) => /^T\d+$/i.test(topic));
    const duplicate = /duplicate canonical name already covered/i.test(name);
    return [{
      canonicalName: duplicate ? null : sourceName,
      sourceName,
      attendance,
      contributions: readSection('CONTRIBUTIONS:'),
      actions: [...readSection('ACTIONS ASSIGNED TO THIS PERSON:'), ...readSection('ACTIONS ASSIGNED BY THIS PERSON:')],
      decisionsOwned: readSection('DECISIONS OWNED:'),
      risksRaised: readSection('RISKS RAISED:'),
      topicIds: topics,
      stance: cleanValue(block.match(/^STANCE:\s*(.+)$/mi)?.[1] ?? ''),
      unresolved: duplicate,
    }];
  });
}

/** Parses the topic record's semantic fields, ignoring retrieval and publication links. */
export function parseAzureTopicRecord(artifact: string): NormalizedTopic {
  const metadata = (name: string): string | null => cleanValue(artifact.match(new RegExp(`^-\\s*\\*\\*${name}:\\*\\*\\s*(.+)$`, 'mi'))?.[1] ?? '');
  const structured = section(artifact, '## Structured Intelligence', ['## Retrieval Anchors']);
  return {
    topicId: metadata('TOPIC_ID'),
    topic: metadata('TOPIC') ?? metadata('TITLE'),
    domain: metadata('DOMAIN'),
    category: metadata('CATEGORY'),
    contextType: metadata('CONTEXT_TYPE'),
    summary: cleanValue(section(artifact, '## Summary', ['## Structured Intelligence', '## Retrieval Anchors'])),
    keyFacts: linesAsAssertions(section(artifact, '## Key Facts', ['## Summary', '## Structured Intelligence']), 'topic-key-fact'),
    decisions: linesAsAssertions(section(structured, '### Decisions', ['### Actions', '### Risks & Issues', '### Next Steps']), 'topic-decision'),
    actions: linesAsAssertions(section(structured, '### Actions', ['### Risks & Issues', '### Next Steps']), 'topic-action'),
    risks: linesAsAssertions(section(structured, '### Risks & Issues', ['### Next Steps']), 'topic-risk'),
    owners: [metadata('PRIMARY_OWNER'), metadata('SECONDARY_OWNER')].filter((owner): owner is string => owner !== null),
    confidence: metadata('EIP_VALIDATION')?.match(/^(PASS|WARNING|FAIL)/i)?.[1].toLowerCase() ?? null,
    validation: { status: (metadata('EIP_VALIDATION')?.match(/^(PASS|WARNING|FAIL)/i)?.[1].toLowerCase() as 'pass' | 'warning' | 'fail' | undefined) ?? 'warning', reasons: [] },
  };
}

/**
 * Extracts meeting-level classification metadata from the Azure summary artifact header.
 * Looks for MEETING_TYPE / CLASSIFICATION (mode) and CONFIDENCE fields.
 * Returns null for both fields when absent — never invents values.
 */
export function parseAzureClassification(artifact: string): { mode: string | null; confidence: string | null } {
  const { metadata } = parseAzureArtifactHeader(artifact);
  // The pipeline writes MODE / MODE_CONFIDENCE to the summary header.
  // MEETING_TYPE and CLASSIFICATION are retained as legacy fallbacks.
  const mode = metadata['MEETING_TYPE'] ?? metadata['CLASSIFICATION'] ?? metadata['MODE'] ?? null;
  const confidence = metadata['CONFIDENCE'] ?? metadata['MODE_CONFIDENCE'] ?? null;
  return { mode: mode ? normalizeWhitespace(mode).toLowerCase() : null, confidence: confidence ? normalizeWhitespace(confidence).toLowerCase() : null };
}

export interface AzureExportBaselineProjection {
  transcript: ParsedTranscript;
  summaryAssertions: EvidenceAssertion[];
  people: NormalizedPerson[];
  topics: NormalizedTopic[];
  classification: { mode: string | null; confidence: string | null };
}

/** Creates the Azure semantic baseline from supplied package contents only. */
export function projectAzureExportPackage(
  manifest: AzureExportPackageManifest,
  contents: { transcript: string; summary: string; people: string; topicRecords: string[] },
): AzureExportBaselineProjection {
  if (contents.topicRecords.length !== manifest.artifacts.topicRecords.length) {
    throw new Error('Azure export topic record content count does not match the manifest');
  }
  return {
    transcript: parseAzureTranscript(contents.transcript).transcript,
    summaryAssertions: parseAzureSummary(contents.summary),
    people: parseAzurePeople(contents.people),
    topics: contents.topicRecords.map(parseAzureTopicRecord),
    classification: parseAzureClassification(contents.summary),
  };
}
