import { afterEach, describe, expect, test, vi } from 'vitest';
import { processSafeEvidenceMeeting, splitTranscriptForSafeEvidence } from './safe-evidence';
import type { FixedTopicContext } from './topic-enrichment';

const env = {
  AZURE_OPENAI_ENDPOINT: 'https://example.com',
  AZURE_OPENAI_DEPLOYMENT: 'test-deployment',
  AZURE_OPENAI_API_KEY: 'test-key',
};

const fixedTopic: FixedTopicContext = {
  topicId: 'meeting-topic-1',
  domain: 'Product Management',
  entityType: 'Technology Platform',
  entity: 'Example platform',
  aspect: 'Performance',
  outcome: 'Risk',
  disposition: 'Deferral',
  executiveScope: 'Tactical',
  topicStatement: 'Example platform delivery remains at risk.',
  summary: null,
  owners: [],
  confidence: 'high',
  memoryId: undefined,
};

afterEach(() => vi.restoreAllMocks());

describe('safe evidence extraction', () => {
  test('splits long transcripts into overlapping chunks', () => {
    const chunks = splitTranscriptForSafeEvidence('x'.repeat(24000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].slice(0, 500)).toBe(chunks[0].slice(-500));
  });

  test('keeps evidence from valid chunks when another chunk is filtered', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 2) {
        return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'content_filter' }] }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({
          topics: [{
            ...fixedTopic,
            keyFacts: [{ id: 'fact-1', text: 'The platform remains blocked by an unresolved integration defect.' }],
            decisions: [], actions: [], risks: [], validation: { status: 'pass', reasons: [] },
          }],
          people: [], actions: [], decisions: [], summaryAssertions: [], validation: { status: 'pass', reasons: [] },
        }) } }] }),
      };
    }));

    const result = await processSafeEvidenceMeeting({
      meetingId: 'meeting', sourceSystem: 'test', nativeId: 'native', subject: 'Subject',
      organiser: 'test@example.com', eventDate: '2026-08-21T00:00:00Z', transcript: 'x'.repeat(24000),
    }, 'sha', env, [fixedTopic]);

    expect(result.filteredChunks).toBe(1);
    expect(result.chunksProcessed).toBe(2);
    expect(result.output.topics[0].keyFacts).toHaveLength(1);
  });
});
