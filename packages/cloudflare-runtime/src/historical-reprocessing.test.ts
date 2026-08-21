import { afterEach, describe, expect, test, vi } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { parseHistoricalReprocessingRequest, reprocessHistoricalMeetings } from './historical-reprocessing';

const llmEnv = {
  AZURE_OPENAI_ENDPOINT: 'https://example.com',
  AZURE_OPENAI_DEPLOYMENT: 'test-deployment',
  AZURE_OPENAI_API_KEY: 'test-key',
};

function createDb(existingTopicIds: string[]) {
  const updates: Array<{ key: string; meetingId: string }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first<T>() {
              return { topics: existingTopicIds.length, with_key_facts: 0 } as T;
            },
            async all<T>() {
              if (sql.includes('FROM meetings')) {
                return { results: [{
                  meeting_id: 'meeting-a', source_system: 'azure', native_id: 'native-a',
                  subject: 'Historical meeting', organiser: 'test@example.com',
                  event_date: '2026-08-01T08:00:00Z', transcript_sha256: 'sha',
                  r2_output_key: 'meetings/meeting-a/meeting-output.json',
                }] } as T;
              }
              return { results: existingTopicIds.map((topic_id) => ({ topic_id })) } as T;
            },
            async run() {
              if (sql.startsWith('UPDATE meetings SET r2_output_key')) {
                updates.push({ key: String(params[0]), meetingId: String(params[1]) });
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, updates };
}

function createBucket() {
  const writes: Array<{ key: string; value: string }> = [];
  const bucket = {
    async get(key: string) {
      if (key.endsWith('/transcript.txt')) return { text: async () => 'A sufficiently long historical transcript for reprocessing.' };
      return null;
    },
    async put(key: string, value: string) {
      writes.push({ key, value });
    },
  } as unknown as R2Bucket;
  return { bucket, writes };
}

function mockEvidenceOutput(topicIds: string[]) {
  return {
    choices: [{ message: { content: JSON.stringify({
      meetingId: 'meeting-a', sourceSystem: 'azure', nativeId: 'native-a', subject: 'Historical meeting',
      organiser: 'test@example.com', eventDate: '2026-08-01T08:00:00Z', transcriptSha256: 'sha',
      processing: {}, classification: {}, summaryAssertions: [],
      topics: topicIds.map((topicId) => ({
        topicId, domain: 'Product Management', entityType: 'Technology Platform', entity: 'Inspire QR-login camera',
        aspect: 'Performance', outcome: 'Risk', disposition: 'Deferral', executiveScope: 'Tactical',
        topicStatement: 'The camera workaround is deferred.',
        keyFacts: [{ id: `${topicId}-fact-1`, text: 'The camera freezes when reopened.' }],
        decisions: [], actions: [], risks: [], owners: [], confidence: 'high',
        validation: { status: 'pass', reasons: [] },
      })),
      people: [], actions: [], decisions: [], validation: { status: 'pass', reasons: [] },
    }) } }],
  };
}

afterEach(() => vi.restoreAllMocks());

describe('historical reprocessing', () => {
  test('defaults to a dry-run and bounds the requested batch', () => {
    expect(parseHistoricalReprocessingRequest({})).toEqual({ dryRun: true, limit: 5, cursor: null, meetingIds: [], includeFailed: false, mode: 'standard' });
    expect(parseHistoricalReprocessingRequest({ dryRun: false, limit: 999, cursor: 'meeting-0' })).toEqual({
      dryRun: false, limit: 20, cursor: 'meeting-0', meetingIds: [], includeFailed: false, mode: 'standard',
    });
  });

  test('promotes a validated candidate without changing topic rows', async () => {
    const { db, updates } = createDb(['meeting-a-topic-1']);
    const { bucket, writes } = createBucket();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: vi.fn().mockResolvedValue(mockEvidenceOutput(['meeting-a-topic-1'])),
      text: vi.fn().mockResolvedValue(''),
    }));

    const result = await reprocessHistoricalMeetings(db, bucket, llmEnv, {
      dryRun: false, limit: 5, cursor: null, meetingIds: [], includeFailed: false, mode: 'standard',
    });

    expect(result.promoted).toBe(1);
    expect(result.quarantined).toEqual([]);
    expect(writes[0].key).toContain('meeting-output.reprocessed-v2.json');
    expect(updates[0].meetingId).toBe('meeting-a');
  });

  test('quarantines topic-id drift without writing R2 or D1', async () => {
    const { db, updates } = createDb(['meeting-a-topic-1']);
    const { bucket, writes } = createBucket();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: vi.fn().mockResolvedValue(mockEvidenceOutput(['meeting-a-topic-new'])),
      text: vi.fn().mockResolvedValue(''),
    }));

    const result = await reprocessHistoricalMeetings(db, bucket, llmEnv, {
      dryRun: false, limit: 5, cursor: null, meetingIds: [], includeFailed: false, mode: 'standard',
    });

    expect(result.promoted).toBe(0);
    expect(result.quarantined[0].reason).toContain('topic ID set changed');
    expect(writes).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
