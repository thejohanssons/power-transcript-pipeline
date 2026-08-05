import { describe, expect, it } from 'vitest';
import { compareContinuousNormalizedOutputs } from './comparison';
import type { AzureExportPackageManifest, ContinuousNormalizedOutput } from './contracts';
import {
  parseAzurePeople,
  parseAzureSummary,
  parseAzureTopicRecord,
  parseAzureTranscript,
  projectAzureExportPackage,
} from './azure-export-processing';
import { isAzureExportPackageManifest, isContinuousNormalizedOutput } from './fixture-validation';

const SHA256 = 'b'.repeat(64);
const reference = (kind: 'transcript' | 'summary' | 'people' | 'topic_record', name: string, contentType: string) => ({
  kind, key: `azure-exports/payment-strategy/${name}`, sha256: SHA256, bytes: 1, contentType,
});

function manifest(): AzureExportPackageManifest {
  return {
    schemaVersion: '1.0.0', packageId: 'payment-strategy-20260721',
    source: { system: 'azure_transcript_export', nativeId: '2026-07-21_1130_payment_strategy', meetingId: 'payment-strategy' },
    processing: { azurePipelineVersion: '1.7.9', configuration: [{ name: 'taxonomy', sha256: SHA256 }] },
    artifacts: {
      transcript: reference('transcript', 'transcript.txt', 'text/plain'),
      summary: reference('summary', 'summary.txt', 'text/plain'),
      people: reference('people', 'people.txt', 'text/plain'),
      topicRecords: [reference('topic_record', 'T15-details.md', 'text/markdown')],
    },
  };
}

const transcript = `---
MEETING ID: payment-strategy
SUBJECT: Payment Strategy
BACK-LINK (MASTER LOG): https://example.invalid/private
---
WEBVTT

00:00:00.000 --> 00:00:02.000
<v Speaker>Approve the local budget.</v>`;

const summary = `MEETING ID: payment-strategy
BACK-LINK (MASTER LOG): https://example.invalid/private
---
1. Topics / Context

2. Signals
- [T15] Decision: The local budget was approved.

4. Actions
- Action: Finance will record the budget.`;

const people = `MEETING ID: payment-strategy
---

PERSON: Toby Sutton
ATTENDANCE: Present

CONTRIBUTIONS:
- Proposed the budget.

ACTIONS ASSIGNED TO THIS PERSON:
- Record the budget.

ACTIONS ASSIGNED BY THIS PERSON:
None

DECISIONS OWNED:
- Approved the local budget.

RISKS RAISED:
None

TOPICS REFERENCED: T15
STANCE: pragmatic

---
PERSON: Toby Sutton (duplicate canonical name already covered)
ATTENDANCE: Present

CONTRIBUTIONS:
- Confirmed the amount.`;

const topic = `# Topic Record: Payment Strategy

## Metadata
- **DOMAIN:** Finance
- **TOPIC:** Payment Strategy v1.0
- **TITLE:** Payment Strategy
- **CATEGORY:** Strategy
- **CONTEXT_TYPE:** Discussion

### OWNERSHIP
- **PRIMARY_OWNER:** CEO
- **SECONDARY_OWNER:** Finance
- **TOPIC_ID:** T15
- **SOURCE_MEETING:** [Payment Strategy](https://example.invalid/private)
- **EIP_VALIDATION:** PASS (Recovered)

## Key Facts
- The budget is local.

## Summary
The finance budget was reviewed.

## Structured Intelligence
### Decisions
- The local budget was approved.

### Actions
- Finance will record the budget.

### Risks & Issues
None

### Next Steps
None

## Retrieval Anchors
- **PEOPLE:** Toby Sutton`;

function continuous(overrides: Partial<ContinuousNormalizedOutput> = {}): ContinuousNormalizedOutput {
  return {
    schemaVersion: '1.0.0',
    source: { system: 'azure_transcript_export', nativeId: 'payment-strategy', transcriptSha256: SHA256 },
    processing: { runtime: 'azure', pipelineVersion: '1.7.9', promptVersion: '1', model: 'model', deployment: 'deployment', configurationHashes: {} },
    classification: { mode: 'internal', confidence: 'high' }, summaryAssertions: [], topics: [], people: [],
    validation: { status: 'pass', reasons: [] }, ...overrides,
  };
}

describe('Azure export package contract', () => {
  it('accepts required supplied artifacts without acquisition or publication fields', () => {
    expect(isAzureExportPackageManifest(manifest())).toBe(true);
    expect(isAzureExportPackageManifest({ ...manifest(), artifacts: { ...manifest().artifacts, people: { ...manifest().artifacts.people, key: 'azure-exports/payment-strategy/summary.txt' } } })).toBe(false);
    expect(isAzureExportPackageManifest({ ...manifest(), artifacts: { ...manifest().artifacts, summary: { ...manifest().artifacts.summary, contentType: 'application/json' } } })).toBe(false);
  });

  it('accepts callback-declared empty optional processing provenance', () => {
    const output = continuous({
      processing: {
        runtime: 'cloudflare', pipelineVersion: '1.7.9', promptVersion: '', model: '', deployment: '', configurationHashes: {},
      },
    });
    expect(isContinuousNormalizedOutput(output)).toBe(true);
  });
});

describe('Azure artifact adapters', () => {
  it('isolates header-prefixed VTT evidence and strips publication links', () => {
    expect(parseAzureTranscript(transcript)).toEqual({
      metadata: { MEETING_ID: 'payment-strategy', SUBJECT: 'Payment Strategy' },
      transcript: { format: 'webvtt', text: 'Approve the local budget.', cueCount: 1 },
    });
  });

  it('projects structured Azure summaries, people, and topic records without inventing empty data', () => {
    expect(parseAzureSummary(summary).map(({ text }) => text)).toEqual(['The local budget was approved.', 'Finance will record the budget.']);
    expect(parseAzurePeople(people)).toMatchObject([
      { canonicalName: 'Toby Sutton', actions: [{ text: 'Record the budget.' }], topicIds: ['T15'], unresolved: false },
      { canonicalName: null, sourceName: 'Toby Sutton', unresolved: true },
    ]);
    expect(parseAzureTopicRecord(topic)).toMatchObject({
      topicId: 'T15', domain: 'Finance', owners: ['CEO', 'Finance'],
      keyFacts: [{ text: 'The budget is local.' }], decisions: [{ text: 'The local budget was approved.' }],
      actions: [{ text: 'Finance will record the budget.' }], risks: [], validation: { status: 'pass', reasons: [] },
    });
    const projection = projectAzureExportPackage(manifest(), { transcript, summary, people, topicRecords: [topic] });
    expect(projection.transcript).toMatchObject({ text: 'Approve the local budget.' });
    expect(projection.topics).toMatchObject([{ topicId: 'T15' }]);
    expect(projection.people[0]).toMatchObject({ sourceName: 'Toby Sutton' });
  });
});

describe('continuous Azure-export comparison', () => {
  it('compares semantic processing while intentionally excluding publication and persistence behavior', () => {
    const azure = continuous();
    const cloudflare = continuous({ processing: { ...azure.processing, runtime: 'cloudflare' } });
    expect(compareContinuousNormalizedOutputs('package-1', SHA256, 'run-1', azure, cloudflare)).toMatchObject({ status: 'pass', differences: [] });
  });
});
