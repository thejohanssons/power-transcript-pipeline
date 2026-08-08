import type { Env, TranscriptSubmission } from './types';
import { isTranscriptSubmission } from './validation';
import { buildMeetingRow, insertMeetingSql } from './db';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

async function computeSha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function enableForeignKeys(db: D1Database): Promise<void> {
  // D1 currently ignores PRAGMA foreign_keys = ON in the Workers binding.
  // The statement is harmless and documents the intended behavior, but it
  // does not actually enforce FK constraints in D1 today.
  await db.prepare('PRAGMA foreign_keys = ON').run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === '/health' && method === 'GET') {
        return jsonResponse({ status: 'ok', environment: env.ENVIRONMENT });
      }

      if (path === '/v1/meetings' && method === 'POST') {
        return this.handlePostMeeting(request, env);
      }

      if (path === '/v1/topic-memory' && method === 'GET') {
        return this.handleGetTopicMemory(env);
      }

      const matchPath = path.match(/^\/v1\/topic-memory\/([^/]+)\/match$/);
      if (matchPath && method === 'POST') {
        return this.handlePostTopicMemoryMatch(matchPath[1], request, env);
      }

      return errorResponse('Not found', 404);
    } catch (err) {
      console.error('Cloudflare runtime error:', err);
      return errorResponse(`Internal server error: ${err instanceof Error ? err.message : String(err)}`, 500);
    }
  },

  async handlePostMeeting(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.SUBMISSION_TOKEN}`) {
      return errorResponse('Unauthorised', 401);
    }

    const body = await request.json().catch(() => null);
    if (!body || !isTranscriptSubmission(body)) {
      return errorResponse('Request body must be a valid TranscriptSubmission', 400);
    }

    const submission = body as TranscriptSubmission;
    const transcriptSha256 = await computeSha256(submission.transcript);

    await enableForeignKeys(env.DB);
    const existing = await env.DB.prepare('SELECT state FROM meetings WHERE meeting_id = ?')
      .bind(submission.meetingId)
      .first<{ state: string }>();

    if (existing?.state === 'completed' || existing?.state === 'processing' || existing?.state === 'pending') {
      return jsonResponse({ meetingId: submission.meetingId, state: existing.state, already_exists: true }, 200);
    }

    if (existing?.state === 'failed') {
      const insert = insertMeetingSql();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM actions WHERE meeting_id = ?').bind(submission.meetingId),
        env.DB.prepare('DELETE FROM decisions WHERE meeting_id = ?').bind(submission.meetingId),
        env.DB.prepare('DELETE FROM people WHERE meeting_id = ?').bind(submission.meetingId),
        env.DB.prepare('DELETE FROM topics WHERE meeting_id = ?').bind(submission.meetingId),
        env.DB.prepare('DELETE FROM meetings WHERE meeting_id = ?').bind(submission.meetingId),
        env.DB.prepare(insert).bind(...buildMeetingRow(submission, transcriptSha256, null)),
      ]);

      return jsonResponse({ meetingId: submission.meetingId, state: 'pending' }, 202);
    }

    const insert = insertMeetingSql();
    await env.DB.prepare(insert)
      .bind(...buildMeetingRow(submission, transcriptSha256, null))
      .run();

    return jsonResponse({ meetingId: submission.meetingId, state: 'pending' }, 202);
  },

  async handleGetTopicMemory(_env: Env): Promise<Response> {
    return jsonResponse({ topicMemory: [] });
  },

  async handlePostTopicMemoryMatch(id: string, _request: Request, _env: Env): Promise<Response> {
    return jsonResponse({ message: `Match review endpoint — implementation pending (id: ${id})` });
  },
};
