import { describe, expect, test, vi } from 'vitest';
import * as meetingProcessing from './meeting-processing';
import runtime from './index';
import type { Env, MeetingOutput, ProcessingQueueMessage, TranscriptSubmission } from './types';

function createMockDb() {
  const meetings = new Map<string, { state: string; error_message?: string; r2_output_key?: string }>();
  const topics: Array<{ meeting_id: string }> = [];
  const people: Array<{ meeting_id: string }> = [];
  const actions: Array<{ meeting_id: string }> = [];
  const decisions: Array<{ meeting_id: string }> = [];

  return {
    meetings,
    topics,
    people,
    actions,
    decisions,
    prepare(query: string) {
      return {
        _query: query,
        _bound: [] as unknown[],
        bind(...params: unknown[]) {
          this._bound = params;
          return this;
        },
        async first<T>() {
          if (query.includes('FROM meetings WHERE meeting_id = ?')) {
            const meetingId = this._bound[0] as string;
            const entry = meetings.get(meetingId);
            return entry ? (entry as unknown as T) : undefined;
          }
          return undefined;
        },
        async run() {
          if (query.startsWith('INSERT INTO meetings')) {
            const meetingId = this._bound[0] as string;
            meetings.set(meetingId, {
              state: this._bound[7] as string,
              r2_output_key: this._bound[9] as string | undefined,
            });
            return { success: true };
          }
          if (query.startsWith('UPDATE meetings SET state = ?, r2_output_key = ?, updated_at')) {
            const state = this._bound[0] as string;
            const r2_output_key = this._bound[1] as string;
            const meetingId = this._bound[2] as string;
            const entry = meetings.get(meetingId);
            if (entry) {
              entry.state = state;
              entry.r2_output_key = r2_output_key;
            }
            return { success: true };
          }
          if (query.startsWith('UPDATE meetings SET state = ?, error_message = ?, updated_at')) {
            const state = this._bound[0] as string;
            const errorMessage = this._bound[1] as string;
            const meetingId = this._bound[2] as string;
            const entry = meetings.get(meetingId);
            if (entry) {
              entry.state = state;
              entry.error_message = errorMessage;
            }
            return { success: true };
          }
          if (query.startsWith('UPDATE meetings SET state = ?')) {
            const state = this._bound[0] as string;
            const meetingId = this._bound[1] as string;
            const entry = meetings.get(meetingId);
            if (entry) {
              entry.state = state;
            }
            return { success: true };
          }
          if (query.startsWith('DELETE FROM actions')) {
            const meetingId = this._bound[0] as string;
            actions.splice(0, actions.length, ...actions.filter((row) => row.meeting_id !== meetingId));
            return { success: true };
          }
          if (query.startsWith('DELETE FROM decisions')) {
            const meetingId = this._bound[0] as string;
            decisions.splice(0, decisions.length, ...decisions.filter((row) => row.meeting_id !== meetingId));
            return { success: true };
          }
          if (query.startsWith('DELETE FROM people')) {
            const meetingId = this._bound[0] as string;
            people.splice(0, people.length, ...people.filter((row) => row.meeting_id !== meetingId));
            return { success: true };
          }
          if (query.startsWith('DELETE FROM topics')) {
            const meetingId = this._bound[0] as string;
            topics.splice(0, topics.length, ...topics.filter((row) => row.meeting_id !== meetingId));
            return { success: true };
          }
          if (query.startsWith('DELETE FROM meetings')) {
            const meetingId = this._bound[0] as string;
            meetings.delete(meetingId);
            return { success: true };
          }
          if (query.startsWith('INSERT INTO topics')) {
            const meetingId = this._bound[1] as string;
            topics.push({ meeting_id: meetingId });
            return { success: true };
          }
          if (query.startsWith('INSERT INTO people')) {
            const meetingId = this._bound[1] as string;
            people.push({ meeting_id: meetingId });
            return { success: true };
          }
          if (query.startsWith('INSERT INTO actions')) {
            const meetingId = this._bound[1] as string;
            actions.push({ meeting_id: meetingId });
            return { success: true };
          }
          if (query.startsWith('INSERT INTO decisions')) {
            const meetingId = this._bound[1] as string;
            decisions.push({ meeting_id: meetingId });
            return { success: true };
          }
          return { success: true };
        },
      };
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      const results = [] as unknown[];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    },
  };
}

function createEnv(state?: string): Env {
  const db = createMockDb();
  if (state) {
    db.meetings.set('2026-08-07_0900_sales_call', { state });
  }
  return {
    DB: db as unknown as D1Database,
    OUTPUT_BUCKET: {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Bucket,
    PROCESSING_QUEUE: {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue,
    ENVIRONMENT: 'test',
    AZURE_OPENAI_ENDPOINT: 'https://example.com',
    AZURE_OPENAI_DEPLOYMENT: 'test-deployment',
    AZURE_OPENAI_API_KEY: 'test-key',
    SUBMISSION_TOKEN: 'test-token',
    TEAMS_WEBHOOK_URL: undefined,
  };
}

async function dispatch(request: Request, env: Env) {
  return runtime.fetch(request, env as Env, undefined as any);
}

function makeMeetingOutput(topicCount = 0): MeetingOutput {
  return {
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
    topics: Array.from({ length: topicCount }, (_, i) => ({
      topicId: `2026-08-07_0900_sales_call-topic-${i + 1}`,
      domain: 'Finance' as const,
      entityType: 'Project' as const,
      entity: 'Reader 3',
      aspect: 'Schedule' as const,
      outcome: 'Risk' as const,
      disposition: 'Action' as const,
      executiveScope: 'Operational' as const,
      topicStatement: `Topic ${i + 1}`,
      summary: null,
      keyFacts: [],
      decisions: [],
      actions: [],
      risks: [],
      owners: [],
      confidence: null,
      validation: { status: 'pass' as const, reasons: [] },
    })),
    people: [],
    actions: [],
    decisions: [],
    validation: { status: 'pass', reasons: [] },
  };
}

describe('POST /v1/meetings', () => {
  const validSubmission: TranscriptSubmission = {
    meetingId: '2026-08-07_0900_sales_call',
    sourceSystem: 'azure',
    nativeId: 'meeting-12345',
    subject: 'Sales review',
    organiser: 'peter@example.com',
    eventDate: '2026-08-07T09:00:00Z',
    transcript: 'This is a valid transcript text with enough length to pass validation.',
  };

  test('returns 401 when Authorization is missing', async () => {
    const request = new Request('http://localhost/v1/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validSubmission),
    });

    const res = await dispatch(request, createEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorised' });
  });

  test('returns 400 for short transcript', async () => {
    const request = new Request('http://localhost/v1/meetings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({ ...validSubmission, transcript: 'short transcript' }),
    });

    const res = await dispatch(request, createEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Request body must be a valid TranscriptSubmission' });
  });

  test('returns 202 and creates a pending meeting row', async () => {
    const env = createEnv();
    const request = new Request('http://localhost/v1/meetings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify(validSubmission),
    });

    const res = await dispatch(request, env);
    expect(res.status).toBe(202);
    expect(((await res.json()) as any).meetingId).toBe(validSubmission.meetingId);
    expect(env.DB.prepare('').bind().run).toBeDefined();
  });

  test('sends a queue message after submission', async () => {
    const env = createEnv();
    const request = new Request('http://localhost/v1/meetings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify(validSubmission),
    });

    const res = await runtime.fetch(request, env, undefined as any);
    expect(res.status).toBe(202);
    expect(env.PROCESSING_QUEUE.send).toHaveBeenCalledWith({ meetingId: validSubmission.meetingId });
  });

  test('AC13 valid submission creates a pending row and enqueues processing', async () => {
    const env = createEnv();
    const request = new Request('http://localhost/v1/meetings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify(validSubmission),
    });

    const res = await runtime.fetch(request, env, undefined as any);
    expect(res.status).toBe(202);
    const db = env.DB as unknown as ReturnType<typeof createMockDb>;
    expect(db.meetings.get(validSubmission.meetingId)?.state).toBe('pending');
    expect(env.PROCESSING_QUEUE.send).toHaveBeenCalled();
  });

  test('AC14 valid submission enqueues failed processing if LLM fails in queue handler', async () => {
    const env = createEnv();
    const db = env.DB as unknown as ReturnType<typeof createMockDb>;
    db.meetings.set(validSubmission.meetingId, {
      state: 'pending',
      source_system: validSubmission.sourceSystem,
      native_id: validSubmission.nativeId,
      subject: validSubmission.subject,
      organiser: validSubmission.organiser,
      event_date: validSubmission.eventDate,
      transcript_sha256: 'abc123',
    } as any);
    (env.OUTPUT_BUCKET.get as any).mockResolvedValue({ text: vi.fn().mockResolvedValue(validSubmission.transcript) });

    const processSpy = vi.spyOn(meetingProcessing, 'processMeeting').mockRejectedValue(new Error('LLM failed'));
    await runtime.queue({ messages: [{ body: { meetingId: validSubmission.meetingId }, id: '1', timestamp: new Date(), attempts: 1, ack: () => {}, retry: () => {} }] } as unknown as QueueEvent<ProcessingQueueMessage>, env);

    expect(processSpy).toHaveBeenCalled();
    expect(db.meetings.get(validSubmission.meetingId)?.state).toBe('failed');
    expect(db.meetings.get(validSubmission.meetingId)?.error_message).toContain('LLM failed');
  });

  test('AC15 valid queue processing persists topic rows when processMeeting returns topics', async () => {
    const env = createEnv();
    const db = env.DB as unknown as ReturnType<typeof createMockDb>;
    db.meetings.set(validSubmission.meetingId, {
      state: 'pending',
      source_system: validSubmission.sourceSystem,
      native_id: validSubmission.nativeId,
      subject: validSubmission.subject,
      organiser: validSubmission.organiser,
      event_date: validSubmission.eventDate,
      transcript_sha256: 'abc123',
    } as any);
    (env.OUTPUT_BUCKET.get as any).mockResolvedValue({ text: vi.fn().mockResolvedValue(validSubmission.transcript) });

    const outputWithTopics = makeMeetingOutput(2);
    vi.spyOn(meetingProcessing, 'processMeeting').mockResolvedValue(outputWithTopics);

    await runtime.queue({ messages: [{ body: { meetingId: validSubmission.meetingId }, id: '1', timestamp: new Date(), attempts: 1, ack: () => {}, retry: () => {} }] } as unknown as QueueEvent<ProcessingQueueMessage>, env);

    expect(db.topics.filter((row) => row.meeting_id === validSubmission.meetingId)).toHaveLength(2);
  });

  test('returns 200 already_exists for completed meeting', async () => {
    const env = createEnv('completed');
    const request = new Request('http://localhost/v1/meetings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify(validSubmission),
    });

    const res = await dispatch(request, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ meetingId: validSubmission.meetingId, state: 'completed', already_exists: true });
  });

  test('returns 200 already_exists for pending meeting', async () => {
    const env = createEnv('pending');
    const request = new Request('http://localhost/v1/meetings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify(validSubmission),
    });

    const res = await dispatch(request, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ meetingId: validSubmission.meetingId, state: 'pending', already_exists: true });
  });

  test('allows resubmission for failed meeting', async () => {
    const env = createEnv('failed');
    const request = new Request('http://localhost/v1/meetings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify(validSubmission),
    });

    const res = await dispatch(request, env);
    expect(res.status).toBe(202);

    const body = await res.json() as any;
    expect(body.meetingId).toBe(validSubmission.meetingId);
    expect(body.state).toBe('pending');

    const realDb = env.DB as unknown as ReturnType<typeof createMockDb>;
    expect(realDb.meetings.get(validSubmission.meetingId)?.state).toBe('pending');
  });
});
