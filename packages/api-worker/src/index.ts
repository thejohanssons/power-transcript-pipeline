// ============================================================
// Copyright (c) 2026 Virrata AB. All rights reserved.
// Executive Insights Pipeline (EIP) — Proprietary & Confidential
// Unauthorised use or distribution is strictly prohibited.
// ============================================================

/**
 * EIP API Worker
 * REST API over Cloudflare D1 (canonical topic store) and R2 (blob storage).
 *
 * Endpoints:
 *   GET  /health                        — Health check
 *   GET  /topics                        — List topics (filterable)
 *   GET  /topics/:id                    — Get topic by ID
 *   POST /topics                        — Upsert topic (with fuzzy dedup)
 *   GET  /topics/:id/occurrences        — Get all occurrences of a topic
 *   POST /transcripts                   — Register transcript metadata
 *   GET  /queue                         — Get pending items for agent review
 *   PATCH /queue/:id                    — Update queue item (approve/reject/amend)
 *   POST /sessions                      — Create agent session log entry
 *   GET  /merge-candidates              — Get pending merge candidates
 */

import { findFuzzyMatches } from './fuzzy';
import type {
  Topic, PostTopicBody, PostTranscriptBody, PatchQueueBody, PostSessionBody,
  PostParticipantsBatchBody
} from './types';

export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  ENVIRONMENT: string;
  /** Staging secret for the shadow's read-only Azure artifact endpoint. */
  SHADOW_ARTIFACT_READ_TOKEN: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// ---------------------------------------------------------------
// ROUTER
// ---------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // --- Health ---
      if (path === '/health' && method === 'GET') {
        return handleHealth(env);
      }

      // --- Topics ---
      if (path === '/topics' && method === 'GET') {
        return handleGetTopics(env, url);
      }
      if (path === '/topics' && method === 'POST') {
        return handlePostTopic(env, request);
      }
      if (path.match(/^\/topics\/[^/]+$/) && method === 'GET') {
        return handleGetTopic(env, path.split('/')[2]);
      }
      if (path.match(/^\/topics\/[^/]+\/occurrences$/) && method === 'GET') {
        return handleGetOccurrences(env, path.split('/')[2]);
      }

      // --- Transcripts ---
      if (path === '/transcripts' && method === 'POST') {
        return handlePostTranscript(env, request);
      }

      // --- Queue ---
      if (path === '/queue' && method === 'GET') {
        return handleGetQueue(env, url);
      }
      if (path.match(/^\/queue\/[^/]+$/) && method === 'PATCH') {
        return handlePatchQueue(env, path.split('/')[2], request);
      }

      // --- Sessions ---
      if (path === '/sessions' && method === 'POST') {
        return handlePostSession(env, request);
      }

      // --- Merge candidates ---
      if (path === '/merge-candidates' && method === 'GET') {
        return handleGetMergeCandidates(env);
      }

      // --- Participants ---
      if (path === '/participants' && method === 'POST') {
        return handlePostParticipants(env, request);
      }
      if (path.match(/^\/meetings\/[^/]+\/participants$/) && method === 'GET') {
        return handleGetMeetingParticipants(env, path.split('/')[2]);
      }

      // --- Transcripts PATCH ---
      if (path.match(/^\/transcripts\/[^/]+$/) && method === 'PATCH') {
        return handlePatchTranscript(env, path.split('/')[2], request);
      }

      // --- Topics PATCH ---
      if (path.match(/^\/topics\/[^/]+$/) && method === 'PATCH') {
        return handlePatchTopic(env, decodeURIComponent(path.split('/')[2]), request);
      }

      // --- Runtime-shadow artifact reader (staging only; no R2 write path) ---
      if (path.match(/^\/internal\/runtime-shadow\/azure-artifacts\/.+$/) && method === 'GET') {
        return handleGetRuntimeShadowAzureArtifact(env, request, path.slice('/internal/runtime-shadow/azure-artifacts/'.length));
      }

      // --- Files (R2) ---
      if (path === '/files' && method === 'POST') {
        return handlePostFile(env, request);
      }
      if (path.match(/^\/files\/.+$/) && method === 'GET') {
        return handleGetFile(env, path.slice('/files/'.length));
      }
      if (path.match(/^\/files\/.+$/) && method === 'DELETE') {
        return handleDeleteFile(env, path.slice('/files/'.length));
      }

      return errorResponse('Not found', 404);
    } catch (err) {
      console.error('EIP API Worker error:', err);
      return errorResponse(
        `Internal server error: ${err instanceof Error ? err.message : String(err)}`,
        500
      );
    }
  },
};

// ---------------------------------------------------------------
// HANDLERS
// ---------------------------------------------------------------

async function handleHealth(env: Env): Promise<Response> {
  const dbCheck = await env.DB.prepare('SELECT 1 as ok').first<{ ok: number }>();
  return jsonResponse({
    status: 'ok',
    environment: env.ENVIRONMENT,
    db: dbCheck?.ok === 1 ? 'connected' : 'error',
    timestamp: now(),
  });
}

// ---------------------------------------------------------------
// GET /topics — list with optional filters
// ---------------------------------------------------------------
async function handleGetTopics(env: Env, url: URL): Promise<Response> {
  const domain = url.searchParams.get('domain');
  const status = url.searchParams.get('status');
  const priority = url.searchParams.get('priority');
  const since = url.searchParams.get('since');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100'), 500);

  let query = 'SELECT * FROM topics WHERE 1=1';
  const params: string[] = [];

  if (domain)   { query += ' AND domain = ?';           params.push(domain); }
  if (status)   { query += ' AND current_status = ?';   params.push(status); }
  if (priority) { query += ' AND current_priority = ?'; params.push(priority); }
  if (since)    { query += ' AND last_seen >= ?';        params.push(since); }

  query += ' ORDER BY last_seen DESC LIMIT ?';
  params.push(String(limit));

  const { results } = await env.DB.prepare(query).bind(...params).all<Topic>();
  return jsonResponse({ topics: results, count: results.length });
}

// ---------------------------------------------------------------
// GET /topics/:id
// ---------------------------------------------------------------
async function handleGetTopic(env: Env, topicId: string): Promise<Response> {
  const topic = await env.DB.prepare('SELECT * FROM topics WHERE topic_id = ?')
    .bind(topicId).first<Topic>();
  if (!topic) return errorResponse('Topic not found', 404);
  return jsonResponse(topic);
}

// ---------------------------------------------------------------
// POST /topics — upsert with fuzzy dedup
// ---------------------------------------------------------------
async function handlePostTopic(env: Env, request: Request): Promise<Response> {
  const body = await request.json() as PostTopicBody;

  if (!body.topic_name || !body.domain || !body.category) {
    return errorResponse('Required fields: topic_name, domain, category');
  }

  // Normalise topic_id — use provided or generate from name
  const topicId = body.topic_id ?? slugify(body.topic_name);
  const topicName = body.topic_name.trim();
  const meetingDate = body.meeting_date ?? now().slice(0, 10);

  // --- Fuzzy dedup check ---
  const { results: allTopics } = await env.DB.prepare(
    'SELECT topic_id, topic_name, domain FROM topics'
  ).all<{ topic_id: string; topic_name: string; domain: string }>();

  const fuzzyMatches = findFuzzyMatches(topicId, topicName, body.domain, allTopics);
  const exactMatch = fuzzyMatches.find(m => m.similarity === 1.0);
  const nearMatches = fuzzyMatches.filter(m => m.similarity < 1.0 && m.similarity >= 0.5);

  let isNew = false;
  let canonicalTopicId = topicId;

  if (exactMatch) {
    // Update existing topic
    canonicalTopicId = exactMatch.topic_id;
    await env.DB.prepare(`
      UPDATE topics SET
        last_seen = ?,
        occurrence_count = occurrence_count + 1,
        current_priority = ?,
        owner = COALESCE(?, owner),
        confluence_url = COALESCE(?, confluence_url),
        domain = CASE WHEN ? IS NOT NULL AND length(?) > 0 AND length(?) < 40 THEN ? ELSE domain END,
        category = CASE WHEN ? IS NOT NULL AND length(?) > 0 THEN ? ELSE category END,
        updated_at = ?
      WHERE topic_id = ?
    `).bind(
      meetingDate,
      body.priority ?? 'Medium',
      body.owner ?? null,
      body.confluence_url ?? null,
      body.domain ?? null, body.domain ?? '', body.domain ?? '', body.domain ?? null,
      body.category ?? null, body.category ?? '', body.category ?? null,
      now(),
      canonicalTopicId
    ).run();
  } else {
    // Create new topic
    isNew = true;
    await env.DB.prepare(`
      INSERT INTO topics (
        topic_id, topic_name, domain, category,
        current_status, current_priority, owner,
        first_seen, last_seen, occurrence_count, trend,
        confluence_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Open', ?, ?, ?, ?, 1, 'Stable', ?, ?, ?)
    `).bind(
      canonicalTopicId, topicName, body.domain, body.category,
      body.priority ?? 'Medium',
      body.owner ?? null,
      meetingDate, meetingDate,
      body.confluence_url ?? null,
      now(), now()
    ).run();

    // Write near-match candidates to merge table for later review
    for (const candidate of nearMatches) {
      const exists = await env.DB.prepare(`
        SELECT 1 FROM topic_merge_candidates
        WHERE (topic_id_a = ? AND topic_id_b = ?) OR (topic_id_a = ? AND topic_id_b = ?)
          AND status = 'Pending'
      `).bind(canonicalTopicId, candidate.topic_id, candidate.topic_id, canonicalTopicId).first();

      if (!exists) {
        await env.DB.prepare(`
          INSERT INTO topic_merge_candidates
            (candidate_id, topic_id_a, topic_id_b, similarity, method, suggested_canonical, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          generateId(),
          canonicalTopicId,
          candidate.topic_id,
          candidate.similarity,
          candidate.method,
          candidate.topic_id, // suggest the existing (older) topic as canonical
          now()
        ).run();
      }
    }
  }

  // --- Always create a new occurrence ---
  const occurrenceId = generateId();
  await env.DB.prepare(`
    INSERT INTO topic_occurrences (
      occurrence_id, topic_id, meeting_ref, meeting_date,
      context, priority, summary, source, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)
  `).bind(
    occurrenceId,
    canonicalTopicId,
    body.meeting_ref ?? null,
    meetingDate,
    body.context ?? null,
    body.priority ?? 'Medium',
    body.summary ?? null,
    body.source ?? 'Transcript',
    now()
  ).run();

  return jsonResponse({
    topic_id: canonicalTopicId,
    occurrence_id: occurrenceId,
    is_new: isNew,
    fuzzy_candidates: nearMatches,
  }, isNew ? 201 : 200);
}

// ---------------------------------------------------------------
// GET /topics/:id/occurrences
// ---------------------------------------------------------------
async function handleGetOccurrences(env: Env, topicId: string): Promise<Response> {
  const topic = await env.DB.prepare('SELECT topic_id FROM topics WHERE topic_id = ?')
    .bind(topicId).first();
  if (!topic) return errorResponse('Topic not found', 404);

  const { results } = await env.DB.prepare(
    'SELECT * FROM topic_occurrences WHERE topic_id = ? ORDER BY meeting_date DESC'
  ).bind(topicId).all();
  return jsonResponse({ topic_id: topicId, occurrences: results, count: results.length });
}

// ---------------------------------------------------------------
// POST /transcripts
// ---------------------------------------------------------------
async function handlePostTranscript(env: Env, request: Request): Promise<Response> {
  const body = await request.json() as PostTranscriptBody;

  if (!body.meeting_ref || !body.meeting_date) {
    return errorResponse('Required fields: meeting_ref, meeting_date');
  }

  const transcriptId = body.transcript_id ?? generateId();

  await env.DB.prepare(`
    INSERT INTO transcripts (
      transcript_id, meeting_ref, r2_key, meeting_date,
      source_system, segment_count, processed, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(transcript_id) DO UPDATE SET
      r2_key = COALESCE(excluded.r2_key, r2_key),
      segment_count = excluded.segment_count
  `).bind(
    transcriptId,
    body.meeting_ref,
    body.r2_key ?? null,
    body.meeting_date,
    body.source_system ?? 'M365',
    body.segment_count ?? 1,
    now()
  ).run();

  return jsonResponse({ transcript_id: transcriptId }, 201);
}

// ---------------------------------------------------------------
// GET /queue — pending occurrences for agent review
// ---------------------------------------------------------------
async function handleGetQueue(env: Env, url: URL): Promise<Response> {
  const domain = url.searchParams.get('domain');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200);

  let query = `
    SELECT o.*, t.topic_name, t.domain, t.category, t.trend
    FROM topic_occurrences o
    JOIN topics t ON o.topic_id = t.topic_id
    WHERE o.status = 'Pending'
  `;
  const params: string[] = [];

  if (domain) { query += ' AND t.domain = ?'; params.push(domain); }
  query += ' ORDER BY o.created_at ASC LIMIT ?';
  params.push(String(limit));

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return jsonResponse({ queue: results, count: results.length });
}

// ---------------------------------------------------------------
// PATCH /queue/:id — approve / reject / amend
// ---------------------------------------------------------------
async function handlePatchQueue(env: Env, occurrenceId: string, request: Request): Promise<Response> {
  const body = await request.json() as PatchQueueBody;

  if (!body.status || !['Approved', 'Rejected'].includes(body.status)) {
    return errorResponse('Required field: status (Approved or Rejected)');
  }

  const occurrence = await env.DB.prepare(
    'SELECT * FROM topic_occurrences WHERE occurrence_id = ?'
  ).bind(occurrenceId).first<{ topic_id: string; priority: string }>();

  if (!occurrence) return errorResponse('Occurrence not found', 404);

  // Update the occurrence
  await env.DB.prepare(`
    UPDATE topic_occurrences SET
      status = ?,
      user_notes = COALESCE(?, user_notes),
      priority = COALESCE(?, priority),
      session_id = COALESCE(?, session_id),
      processed_at = ?
    WHERE occurrence_id = ?
  `).bind(
    body.status,
    body.user_notes ?? null,
    body.priority ?? null,
    body.session_id ?? null,
    body.status === 'Approved' ? now() : null,
    occurrenceId
  ).run();

  // If approved and priority amended, update the parent topic
  if (body.status === 'Approved' && body.priority) {
    await env.DB.prepare(`
      UPDATE topics SET
        current_priority = ?,
        updated_at = ?
      WHERE topic_id = ?
    `).bind(body.priority, now(), occurrence.topic_id).run();
  }

  return jsonResponse({ occurrence_id: occurrenceId, status: body.status });
}

// ---------------------------------------------------------------
// POST /sessions
// ---------------------------------------------------------------
async function handlePostSession(env: Env, request: Request): Promise<Response> {
  const body = await request.json() as PostSessionBody;

  if (!body.session_id) {
    return errorResponse('Required field: session_id');
  }

  await env.DB.prepare(`
    INSERT INTO sessions (
      session_id, session_date, session_type, user_intent,
      topics_reviewed, topics_added, topics_rejected,
      agent_summary, follow_up_flags, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      agent_summary = COALESCE(excluded.agent_summary, agent_summary),
      topics_reviewed = excluded.topics_reviewed,
      topics_added = excluded.topics_added,
      topics_rejected = excluded.topics_rejected,
      follow_up_flags = COALESCE(excluded.follow_up_flags, follow_up_flags)
  `).bind(
    body.session_id,
    now().slice(0, 10),
    body.session_type ?? 'AdHoc',
    body.user_intent ?? null,
    body.topics_reviewed ?? 0,
    body.topics_added ?? 0,
    body.topics_rejected ?? 0,
    body.agent_summary ?? null,
    body.follow_up_flags ? JSON.stringify(body.follow_up_flags) : null,
    now()
  ).run();

  return jsonResponse({ session_id: body.session_id }, 201);
}

// ---------------------------------------------------------------
// GET /merge-candidates
// ---------------------------------------------------------------
async function handleGetMergeCandidates(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`
    SELECT mc.*, 
      ta.topic_name as topic_name_a, ta.domain as domain_a,
      tb.topic_name as topic_name_b, tb.domain as domain_b
    FROM topic_merge_candidates mc
    JOIN topics ta ON mc.topic_id_a = ta.topic_id
    JOIN topics tb ON mc.topic_id_b = tb.topic_id
    WHERE mc.status = 'Pending'
    ORDER BY mc.similarity DESC
  `).all();
  return jsonResponse({ candidates: results, count: results.length });
}

// ---------------------------------------------------------------
// POST /participants — batch upsert meeting participants
// ---------------------------------------------------------------
async function handlePostParticipants(env: Env, request: Request): Promise<Response> {
  const body = await request.json() as PostParticipantsBatchBody;

  if (!body.meeting_ref || !body.meeting_date || !Array.isArray(body.participants)) {
    return errorResponse('Required fields: meeting_ref, meeting_date, participants[]');
  }

  const source = body.source ?? 'PeopleLog';
  let inserted = 0;
  let skipped = 0;

  for (const p of body.participants) {
    if (!p.person_id) continue;
    try {
      await env.DB.prepare(`
        INSERT INTO meeting_participants
          (participant_id, meeting_ref, meeting_date, person_id,
           display_name, role, was_organiser, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(meeting_ref, person_id) DO UPDATE SET
          display_name = COALESCE(excluded.display_name, display_name),
          role = COALESCE(excluded.role, role),
          was_organiser = excluded.was_organiser
      `).bind(
        generateId(),
        body.meeting_ref,
        body.meeting_date,
        p.person_id,
        p.display_name ?? null,
        p.role ?? null,
        p.was_organiser ? 1 : 0,
        source,
        now()
      ).run();
      inserted++;
    } catch (_e) {
      skipped++;
    }
  }

  return jsonResponse({
    meeting_ref: body.meeting_ref,
    inserted,
    skipped,
  }, 201);
}

// ---------------------------------------------------------------
// GET /meetings/:ref/participants
// ---------------------------------------------------------------
async function handleGetMeetingParticipants(env: Env, meetingRef: string): Promise<Response> {
  const decodedRef = decodeURIComponent(meetingRef);
  const { results } = await env.DB.prepare(
    'SELECT * FROM meeting_participants WHERE meeting_ref = ? ORDER BY was_organiser DESC, display_name ASC'
  ).bind(decodedRef).all();
  return jsonResponse({ meeting_ref: decodedRef, participants: results, count: results.length });
}

// ---------------------------------------------------------------
// PATCH /transcripts/:id — update transcript (e.g. mark processed, add r2_key)
// ---------------------------------------------------------------
async function handlePatchTranscript(env: Env, transcriptId: string, request: Request): Promise<Response> {
  const body = await request.json() as { processed?: boolean; r2_key?: string };

  const transcript = await env.DB.prepare(
    'SELECT transcript_id FROM transcripts WHERE transcript_id = ?'
  ).bind(transcriptId).first();
  if (!transcript) return errorResponse('Transcript not found', 404);

  await env.DB.prepare(`
    UPDATE transcripts SET
      processed = COALESCE(?, processed),
      r2_key = COALESCE(?, r2_key)
    WHERE transcript_id = ?
  `).bind(
    body.processed !== undefined ? (body.processed ? 1 : 0) : null,
    body.r2_key ?? null,
    transcriptId
  ).run();

  return jsonResponse({ transcript_id: transcriptId, updated: true });
}

// ============================================================
// Topics PATCH
// PATCH /topics/:id  { topic_id?, topic_name?, domain?, category?,
//                      current_status?, current_priority?, owner?,
//                      confluence_url?, sp_list_item_id? }
// Used by normalize-topic-ids-d1.ps1 to remap topic_id to canonical T-codes.
// When topic_id is changed, all topic_occurrences rows are updated to match.
// ============================================================

async function handlePatchTopic(env: Env, topicId: string, request: Request): Promise<Response> {
  const body = await request.json() as Record<string, string | null>;

  // Verify topic exists
  const existing = await env.DB.prepare(
    'SELECT topic_id FROM topics WHERE topic_id = ?'
  ).bind(topicId).first();
  if (!existing) return errorResponse(`Topic not found: ${topicId}`, 404);

  const newTopicId = body.topic_id ?? null;

  // If renaming topic_id, ensure the new one doesn't already exist
  // (if it does, we merge — update occurrences to point to existing, delete old)
  if (newTopicId && newTopicId !== topicId) {
    const collision = await env.DB.prepare(
      'SELECT topic_id FROM topics WHERE topic_id = ?'
    ).bind(newTopicId).first();

    if (collision) {
      // Merge: point all occurrences of old ID to existing canonical row, then delete old row
      await env.DB.prepare(
        'UPDATE topic_occurrences SET topic_id = ? WHERE topic_id = ?'
      ).bind(newTopicId, topicId).run();
      await env.DB.prepare(
        'DELETE FROM topics WHERE topic_id = ?'
      ).bind(topicId).run();
      return jsonResponse({ topic_id: newTopicId, action: 'merged', merged_from: topicId });
    }

    // No collision — rename in place + cascade to occurrences
    // SQLite doesn't support FK cascade on UPDATE, so do it manually
    await env.DB.batch([
      env.DB.prepare('UPDATE topic_occurrences SET topic_id = ? WHERE topic_id = ?').bind(newTopicId, topicId),
      env.DB.prepare('UPDATE topic_merge_candidates SET topic_id_a = ? WHERE topic_id_a = ?').bind(newTopicId, topicId),
      env.DB.prepare('UPDATE topic_merge_candidates SET topic_id_b = ? WHERE topic_id_b = ?').bind(newTopicId, topicId),
      env.DB.prepare('UPDATE topics SET topic_id = ? WHERE topic_id = ?').bind(newTopicId, topicId),
    ]);
  }

  // Apply any other field updates
  const effectiveId = newTopicId ?? topicId;
  const fields: string[] = [];
  const values: (string | null)[] = [];
  const allowed = ['topic_name','domain','category','current_status','current_priority','owner','confluence_url','sp_list_item_id'];
  for (const key of allowed) {
    if (key in body) { fields.push(`${key} = ?`); values.push(body[key]); }
  }
  if (fields.length > 0) {
    values.push(effectiveId);
    await env.DB.prepare(
      `UPDATE topics SET ${fields.join(', ')} WHERE topic_id = ?`
    ).bind(...values).run();
  }

  return jsonResponse({ topic_id: effectiveId, updated: true, renamed_from: newTopicId ? topicId : null });
}

// ============================================================
// R2 File Store
// ------------------------------------------------------------
// Key convention (enforced by pipeline, not the Worker):
//   transcripts/{yyyy-MM}/{meeting_id}.txt
//   summaries/{yyyy-MM}/{meeting_id}-summary.txt
//   topic-records/{yyyy-MM}/{meeting_id}/{topic_id}-{label}.md
//   people/{yyyy-MM}/{meeting_id}-people.txt
//   logs/{filename}
//
// POST /files   { key, content, content_type? }
//   → writes text content to R2 under the given key
//   → if key matches "transcripts/*/...", updates D1 transcript r2_key
//   Returns: { key, size, updated_transcript }
//
// GET  /files/{key}   → returns raw file content
// DELETE /files/{key} → deletes file from R2
// ============================================================

interface PostFileBody {
  key: string;
  content: string;       // UTF-8 text content
  content_type?: string; // default: text/plain; charset=utf-8
}

async function handlePostFile(env: Env, request: Request): Promise<Response> {
  const body = await request.json() as PostFileBody;

  if (!body.key || !body.content) {
    return errorResponse('Required fields: key, content');
  }

  // Sanitise key: no leading slash, no path traversal
  const key = body.key.replace(/^\/+/, '').replace(/\.\.\//g, '');
  if (!key) return errorResponse('Invalid key');

  const contentType = body.content_type ?? 'text/plain; charset=utf-8';
  const bytes = new TextEncoder().encode(body.content);

  await env.STORAGE.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { uploaded_at: now(), environment: env.ENVIRONMENT },
  });

  // If this is a transcript file, update r2_key on the matching D1 transcript row
  let updatedTranscript: string | null = null;
  const transcriptKeyMatch = key.match(/^transcripts\/[\d-]+\/([^/]+?)(?:-[^/]+)?\.txt$/);
  if (transcriptKeyMatch) {
    const meetingRef = transcriptKeyMatch[1];
    const result = await env.DB.prepare(`
      UPDATE transcripts SET r2_key = ? WHERE meeting_ref = ? AND (r2_key IS NULL OR r2_key = '')
    `).bind(key, meetingRef).run();
    if (result.meta.changes > 0) updatedTranscript = meetingRef;
  }

  return jsonResponse({
    key,
    size: bytes.length,
    content_type: contentType,
    updated_transcript: updatedTranscript,
  }, 201);
}

const SHADOW_READ_PREFIXES = ['transcripts/', 'summaries/', 'people/', 'topic-records/'];

async function hasMatchingShadowReadToken(request: Request, expectedToken: string): Promise<boolean> {
  const suppliedToken = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!suppliedToken || !expectedToken) return false;

  const encoder = new TextEncoder();
  const supplied = encoder.encode(suppliedToken);
  const expected = encoder.encode(expectedToken);
  if (supplied.byteLength !== expected.byteLength) return false;
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(supplied, expected);
  }

  let mismatch = 0;
  for (let index = 0; index < supplied.length; index += 1) mismatch |= supplied[index] ^ expected[index];
  return mismatch === 0;
}

/**
 * Staging-only, authenticated, role-limited reader for the runtime shadow.
 * This endpoint cannot write, list, or delete operational Azure artifacts.
 */
async function handleGetRuntimeShadowAzureArtifact(env: Env, request: Request, key: string): Promise<Response> {
  if (env.ENVIRONMENT !== 'staging') return errorResponse('Not found', 404);
  if (!await hasMatchingShadowReadToken(request, env.SHADOW_ARTIFACT_READ_TOKEN)) return errorResponse('Unauthorized', 401);

  const decodedKey = decodeURIComponent(key);
  if (!SHADOW_READ_PREFIXES.some((prefix) => decodedKey.startsWith(prefix))
    || decodedKey.startsWith('/') || decodedKey.includes('..') || decodedKey.includes('\\')) {
    return errorResponse('Artifact key is outside the permitted Azure export hierarchy', 400);
  }

  const object = await env.STORAGE.get(decodedKey);
  if (!object) return errorResponse('File not found', 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(object.size),
      'ETag': object.etag,
      ...CORS_HEADERS,
    },
  });
}

async function handleGetFile(env: Env, key: string): Promise<Response> {
  const decodedKey = decodeURIComponent(key).replace(/^\/+/, '');
  if (!decodedKey) return errorResponse('Invalid key', 400);

  const object = await env.STORAGE.get(decodedKey);
  if (!object) return errorResponse('File not found', 404);

  const contentType = object.httpMetadata?.contentType ?? 'text/plain; charset=utf-8';
  const text = await object.text();
  return new Response(text, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'ETag': object.etag,
      'Last-Modified': object.uploaded.toUTCString(),
      ...CORS_HEADERS,
    },
  });
}

async function handleDeleteFile(env: Env, key: string): Promise<Response> {
  const decodedKey = decodeURIComponent(key).replace(/^\/+/, '');
  if (!decodedKey) return errorResponse('Invalid key', 400);

  // Verify it exists first
  const head = await env.STORAGE.head(decodedKey);
  if (!head) return errorResponse('File not found', 404);

  await env.STORAGE.delete(decodedKey);
  return jsonResponse({ key: decodedKey, deleted: true });
}
