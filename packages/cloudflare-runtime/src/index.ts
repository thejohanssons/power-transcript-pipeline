import type { Env, TranscriptSubmission, ProcessingQueueMessage } from './types';
import type { Message, QueueEvent } from '@cloudflare/workers-types';
import { RUNTIME_VERSION } from './types';
import { isTranscriptSubmission } from './validation';
import {
  buildMeetingRow,
  insertMeetingSql,
  updateMeetingCompletedSql,
  updateMeetingFailureSql,
  updateMeetingStateSql,
  insertTopicSql,
  insertPersonSql,
  insertActionSql,
  insertDecisionSql,
  buildTopicRow,
  buildPersonRow,
  buildActionRow,
  buildDecisionRow,
} from './db';
import { processMeeting } from './meeting-processing';
import { matchTopicsToMemory } from './topic-memory';

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
  async fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === '/health' && method === 'GET') {
        return jsonResponse({ status: 'ok', version: RUNTIME_VERSION, environment: env.ENVIRONMENT });
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
    const transcriptKey = `meetings/${submission.meetingId}/transcript.txt`;

    await enableForeignKeys(env.DB);
    const existing = await env.DB.prepare('SELECT state, updated_at FROM meetings WHERE meeting_id = ?')
      .bind(submission.meetingId)
      .first<{ state: string; updated_at: string | null }>();

    if (existing?.state === 'processing' && this.isStaleProcessing(existing.updated_at)) {
      await env.DB.prepare(updateMeetingFailureSql()).bind('failed', 'stale processing recovery', submission.meetingId).run();
      existing.state = 'failed';
    }

    if (existing?.state === 'completed' || existing?.state === 'processing' || existing?.state === 'pending') {
      return jsonResponse({ meetingId: submission.meetingId, state: existing.state, already_exists: true }, 200);
    }

    await env.OUTPUT_BUCKET.put(transcriptKey, submission.transcript, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    });

    if (existing?.state === 'failed') {
      const insert = insertMeetingSql();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM actions WHERE meeting_id = ?').bind(submission.meetingId),
        env.DB.prepare('DELETE FROM decisions WHERE meeting_id = ?').bind(submission.meetingId),
        env.DB.prepare('DELETE FROM people WHERE meeting_id = ?').bind(submission.meetingId),
        env.DB.prepare('DELETE FROM topics WHERE meeting_id = ?').bind(submission.meetingId),
        env.DB.prepare('DELETE FROM topic_memory WHERE first_seen_meeting_id = ?').bind(submission.meetingId),
        env.DB.prepare('DELETE FROM meetings WHERE meeting_id = ?').bind(submission.meetingId),
        env.DB.prepare(insert).bind(...buildMeetingRow(submission, transcriptSha256, null)),
      ]);
    } else {
      const insert = insertMeetingSql();
      await env.DB.prepare(insert)
        .bind(...buildMeetingRow(submission, transcriptSha256, null))
        .run();
    }

    await env.PROCESSING_QUEUE.send({ meetingId: submission.meetingId });
    return jsonResponse({ meetingId: submission.meetingId, state: 'pending' }, 202);
  },

  async queue(queueEvent: QueueEvent<ProcessingQueueMessage>, env: Env): Promise<void> {
    for (const message of queueEvent.messages) {
      await this.handleQueueMessage(message, env);
    }
  },

  async handleQueueMessage(message: Message<ProcessingQueueMessage>, env: Env): Promise<void> {
    const payload = message.body;
    if (!payload?.meetingId) {
      console.error('Queue message missing meetingId');
      return;
    }

    const meetingRow = await env.DB.prepare('SELECT source_system, native_id, subject, organiser, event_date, transcript_sha256, state, updated_at FROM meetings WHERE meeting_id = ?')
      .bind(payload.meetingId)
      .first<{
        source_system: string;
        native_id: string;
        subject: string;
        organiser: string;
        event_date: string;
        transcript_sha256: string;
        state: string;
        updated_at: string | null;
      }>();

    if (!meetingRow) {
      console.error('Queue message references missing meeting row:', payload.meetingId);
      return;
    }

    if (meetingRow.state === 'completed') {
      return;
    }

    if (meetingRow.state === 'processing') {
      if (!this.isStaleProcessing(meetingRow.updated_at)) {
        return;
      }
      await env.DB.prepare(updateMeetingFailureSql()).bind('failed', 'stale processing recovery', payload.meetingId).run();
    }

    const transcriptKey = `meetings/${payload.meetingId}/transcript.txt`;
    const transcriptObject = await env.OUTPUT_BUCKET.get(transcriptKey);
    if (!transcriptObject) {
      await env.DB.prepare(updateMeetingFailureSql()).bind('failed', 'transcript missing from R2', payload.meetingId).run();
      console.error('Transcript missing for meeting:', payload.meetingId);
      return;
    }

    const transcript = await transcriptObject.text();
    const submission: TranscriptSubmission = {
      meetingId: payload.meetingId,
      sourceSystem: meetingRow.source_system,
      nativeId: meetingRow.native_id,
      subject: meetingRow.subject,
      organiser: meetingRow.organiser,
      eventDate: meetingRow.event_date,
      transcript,
    };

    await this.processAndPersist(submission, meetingRow.transcript_sha256, env);
  },

  isStaleProcessing(updatedAt: string | null | undefined, thresholdMinutes = 5): boolean {
    if (!updatedAt) return false;
    const timestamp = Date.parse(updatedAt);
    if (Number.isNaN(timestamp)) return false;
    return Date.now() - timestamp > thresholdMinutes * 60_000;
  },

  async processAndPersist(submission: TranscriptSubmission, transcriptSha256: string, env: Env): Promise<void> {
    const meetingId = submission.meetingId;

    try {
      await env.DB.prepare(updateMeetingStateSql()).bind('processing', meetingId).run();

      const meetingOutput = await processMeeting(submission, transcriptSha256, {
        AZURE_OPENAI_ENDPOINT: env.AZURE_OPENAI_ENDPOINT,
        AZURE_OPENAI_DEPLOYMENT: env.AZURE_OPENAI_DEPLOYMENT,
        AZURE_OPENAI_API_KEY: env.AZURE_OPENAI_API_KEY,
      });

      const r2Key = `meetings/${meetingId}/meeting-output.json`;
      await env.OUTPUT_BUCKET.put(r2Key, JSON.stringify(meetingOutput, null, 2), {
        httpMetadata: { contentType: 'application/json' },
      });

      const batchStatements = [
        env.DB.prepare(updateMeetingCompletedSql()).bind('completed', r2Key, meetingId),
      ];

      for (const topic of meetingOutput.topics) {
        batchStatements.push(env.DB.prepare(insertTopicSql()).bind(...buildTopicRow(topic, meetingId)));
      }

      for (const person of meetingOutput.people) {
        batchStatements.push(env.DB.prepare(insertPersonSql()).bind(...buildPersonRow(person, meetingId)));
      }

      for (const action of meetingOutput.actions) {
        batchStatements.push(env.DB.prepare(insertActionSql()).bind(...buildActionRow(action)));
      }

      for (const decision of meetingOutput.decisions) {
        batchStatements.push(env.DB.prepare(insertDecisionSql()).bind(...buildDecisionRow(decision)));
      }

      await env.DB.batch(batchStatements);
      await matchTopicsToMemory(meetingOutput, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await env.DB.prepare(updateMeetingFailureSql()).bind('failed', message, submission.meetingId).run();
      console.error('Meeting processing failed:', message);
    }
  },

  async handleGetTopicMemory(_env: Env): Promise<Response> {
    return jsonResponse({ topicMemory: [] });
  },

  async handlePostTopicMemoryMatch(id: string, _request: Request, _env: Env): Promise<Response> {
    return jsonResponse({ message: `Match review endpoint — implementation pending (id: ${id})` });
  },
};
