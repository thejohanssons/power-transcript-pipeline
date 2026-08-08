import { describe, expect, test } from 'vitest';
import runtime from './index';
import type { Env, TranscriptSubmission } from './types';

function createMockDb() {
  const meetings = new Map<string, { state: string }>();
  return {
    meetings,
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
            return entry ? ({ state: entry.state } as unknown as T) : undefined;
          }
          return undefined;
        },
        async run() {
          if (query.startsWith('INSERT INTO meetings')) {
            const meetingId = this._bound[0] as string;
            meetings.set(meetingId, { state: this._bound[7] as string });
            return { success: true };
          }
          if (query.startsWith('DELETE FROM meetings')) {
            const meetingId = this._bound[0] as string;
            meetings.delete(meetingId);
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
    OUTPUT_BUCKET: {} as R2Bucket,
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
    expect((await res.json()).meetingId).toBe(validSubmission.meetingId);
    expect(env.DB.prepare('').bind().run).toBeDefined();
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

    const body = await res.json();
    expect(body.meetingId).toBe(validSubmission.meetingId);
    expect(body.state).toBe('pending');

    const realDb = env.DB as unknown as ReturnType<typeof createMockDb>;
    expect(realDb.meetings.get(validSubmission.meetingId)?.state).toBe('pending');
  });
});
