import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Env, MeetingOutput } from './types';
import { matchTopicsToMemory } from './topic-memory';

function createMockDb() {
  const rows: Record<string, any>[] = [];
  return {
    rows,
    prepare(query: string) {
      return {
        _query: query,
        _bound: [] as unknown[],
        bind(...params: unknown[]) {
          this._bound = params;
          return this;
        },
        async first<T>() {
          if (query.includes('FROM topic_memory WHERE')) {
            const entityType = this._bound[0] as string;
            const entity = this._bound[1] as string;
            const normalizedEntity = entity.trim().toLowerCase();
            const found = rows.find((row) => row.entity_type === entityType && row.entity.trim().toLowerCase() === normalizedEntity);
            return found ? (found as T) : undefined;
          }
          return undefined;
        },
        async run() {
          if (query.startsWith('INSERT INTO topic_memory')) {
            const [
              memoryId,
              domain,
              entityType,
              entity,
              aspect,
              canonicalStatement,
              firstSeenMeetingId,
              firstSeenDate,
              lastSeenMeetingId,
              lastSeenDate,
              meetingCount,
              latestOutcome,
              latestDisposition,
              latestExecutiveScope,
              matchStatus,
              proposedMatchMemoryId,
              proposedMatchReason,
              status,
            ] = this._bound as any[];
            rows.push({
              memory_id: memoryId,
              domain,
              entity_type: entityType,
              entity,
              aspect,
              canonical_statement: canonicalStatement,
              first_seen_meeting_id: firstSeenMeetingId,
              first_seen_date: firstSeenDate,
              last_seen_meeting_id: lastSeenMeetingId,
              last_seen_date: lastSeenDate,
              meeting_count: meetingCount,
              latest_outcome: latestOutcome,
              latest_disposition: latestDisposition,
              latest_executive_scope: latestExecutiveScope,
              match_status: matchStatus,
              proposed_match_memory_id: proposedMatchMemoryId,
              proposed_match_reason: proposedMatchReason,
              status,
            });
            return { success: true };
          }
          return { success: true };
        },
      };
    },
  };
}

function createEnv(options?: { webhookUrl?: string }): Env {
  return {
    DB: createMockDb() as unknown as D1Database,
    OUTPUT_BUCKET: {} as unknown as R2Bucket,
    ENVIRONMENT: 'test',
    AZURE_OPENAI_ENDPOINT: 'https://example.com',
    AZURE_OPENAI_DEPLOYMENT: 'test-deployment',
    AZURE_OPENAI_API_KEY: 'test-key',
    SUBMISSION_TOKEN: 'test-token',
    TEAMS_WEBHOOK_URL: options?.webhookUrl,
  };
}

const meetingOutputBase: MeetingOutput = {
  meetingId: '2026-08-07_0900_sales_call',
  sourceSystem: 'azure',
  nativeId: 'meeting-12345',
  subject: 'Sales review',
  organiser: 'peter@example.com',
  eventDate: '2026-08-07T09:00:00Z',
  transcriptSha256: 'abc123',
  processing: {
    runtime: 'cloudflare',
    runtimeVersion: '1.0.0',
    contractVersion: '1',
    classificationPromptVersion: '1',
    classificationEngineVersion: '1',
    topicMatchingVersion: '1',
    normalisationVersion: '1',
    model: 'test-deployment',
    deployment: 'test-deployment',
  },
  classification: { mode: null, confidence: null },
  summaryAssertions: [],
  topics: [],
  people: [],
  actions: [],
  decisions: [],
  validation: { status: 'pass', reasons: [] },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('matchTopicsToMemory', () => {
  test('AC7 no existing memory inserts confirmed status', async () => {
    const env = createEnv();
    const output = {
      ...meetingOutputBase,
      topics: [
        {
          topicId: '2026-08-07_0900_sales_call-topic-1',
          domain: 'Finance',
          entityType: 'Project',
          entity: 'Reader 3',
          aspect: 'Schedule',
          outcome: 'Risk',
          disposition: 'Action',
          executiveScope: 'Operational',
          topicStatement: 'Reader 3 schedule is delayed',
          summary: null,
          keyFacts: [],
          decisions: [],
          actions: [],
          risks: [],
          owners: [],
          confidence: null,
          validation: { status: 'pass', reasons: [] },
        },
      ],
    } as MeetingOutput;

    await matchTopicsToMemory(output, env);
    const db = env.DB as unknown as ReturnType<typeof createMockDb>;
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].match_status).toBe('confirmed');
  });

  test('AC8 existing memory with ≥2 keyword overlap creates pending_review', async () => {
    const db = createMockDb();
    db.rows.push({
      memory_id: 'existing-memory-1',
      entity_type: 'Project',
      entity: 'reader 3',
      canonical_statement: 'Reader 3 schedule is delayed and cost is rising',
    });

    const env = createEnv({ webhookUrl: undefined });
    (env.DB as unknown as ReturnType<typeof createMockDb>).rows.push(...db.rows);

    const output = {
      ...meetingOutputBase,
      topics: [
        {
          topicId: '2026-08-07_0900_sales_call-topic-1',
          domain: 'Finance',
          entityType: 'Project',
          entity: 'Reader 3',
          aspect: 'Schedule',
          outcome: 'Risk',
          disposition: 'Action',
          executiveScope: 'Operational',
          topicStatement: 'Reader 3 schedule is delayed',
          summary: null,
          keyFacts: [],
          decisions: [],
          actions: [],
          risks: [],
          owners: [],
          confidence: null,
          validation: { status: 'pass', reasons: [] },
        },
      ],
    } as MeetingOutput;

    await matchTopicsToMemory(output, env);
    const resultDb = env.DB as unknown as ReturnType<typeof createMockDb>;
    expect(resultDb.rows).toHaveLength(2);
    expect(resultDb.rows[1].match_status).toBe('pending_review');
    expect(resultDb.rows[1].proposed_match_memory_id).toBe('existing-memory-1');
  });

  test('AC9 existing memory with 0 overlap creates confirmed', async () => {
    const db = createMockDb();
    db.rows.push({
      memory_id: 'existing-memory-1',
      entity_type: 'Project',
      entity: 'reader 3',
      canonical_statement: 'Budget has been approved',
    });

    const env = createEnv({ webhookUrl: undefined });
    (env.DB as unknown as ReturnType<typeof createMockDb>).rows.push(...db.rows);

    const output = {
      ...meetingOutputBase,
      topics: [
        {
          topicId: '2026-08-07_0900_sales_call-topic-1',
          domain: 'Finance',
          entityType: 'Project',
          entity: 'Reader 3',
          aspect: 'Schedule',
          outcome: 'Risk',
          disposition: 'Action',
          executiveScope: 'Operational',
          topicStatement: 'Schedule has slipped due to vendor delays',
          summary: null,
          keyFacts: [],
          decisions: [],
          actions: [],
          risks: [],
          owners: [],
          confidence: null,
          validation: { status: 'pass', reasons: [] },
        },
      ],
    } as MeetingOutput;

    await matchTopicsToMemory(output, env);
    const resultDb = env.DB as unknown as ReturnType<typeof createMockDb>;
    expect(resultDb.rows).toHaveLength(2);
    expect(resultDb.rows[1].match_status).toBe('confirmed');
  });

  test('AC10 no webhook URL does not attempt fetch', async () => {
    const env = createEnv();
    const output = {
      ...meetingOutputBase,
      topics: [
        {
          topicId: '2026-08-07_0900_sales_call-topic-1',
          domain: 'Finance',
          entityType: 'Project',
          entity: 'Reader 3',
          aspect: 'Schedule',
          outcome: 'Risk',
          disposition: 'Action',
          executiveScope: 'Operational',
          topicStatement: 'Reader 3 schedule is delayed',
          summary: null,
          keyFacts: [],
          decisions: [],
          actions: [],
          risks: [],
          owners: [],
          confidence: null,
          validation: { status: 'pass', reasons: [] },
        },
      ],
    } as MeetingOutput;

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await matchTopicsToMemory(output, env);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('AC11 webhook fetch errors do not throw and are logged', async () => {
    const db = createMockDb();
    db.rows.push({
      memory_id: 'existing-memory-1',
      entity_type: 'Project',
      entity: 'reader 3',
      canonical_statement: 'Reader 3 schedule is delayed and cost is rising',
    });

    const env = createEnv({ webhookUrl: 'https://example.com/webhook' });
    (env.DB as unknown as ReturnType<typeof createMockDb>).rows.push(...db.rows);

    const output = {
      ...meetingOutputBase,
      topics: [
        {
          topicId: '2026-08-07_0900_sales_call-topic-1',
          domain: 'Finance',
          entityType: 'Project',
          entity: 'Reader 3',
          aspect: 'Schedule',
          outcome: 'Risk',
          disposition: 'Action',
          executiveScope: 'Operational',
          topicStatement: 'Reader 3 schedule is delayed',
          summary: null,
          keyFacts: [],
          decisions: [],
          actions: [],
          risks: [],
          owners: [],
          confidence: null,
          validation: { status: 'pass', reasons: [] },
        },
      ],
    } as MeetingOutput;

    const fetchMock = vi.fn().mockRejectedValue(new Error('network failure'));
    vi.stubGlobal('fetch', fetchMock);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(matchTopicsToMemory(output, env)).resolves.not.toThrow();
    expect(fetchMock).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });
});
