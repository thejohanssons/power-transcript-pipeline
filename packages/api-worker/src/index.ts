// ============================================================
// Copyright (c) 2026 Virrata AB. All rights reserved.
// Executive Insights Pipeline (EIP) — Proprietary & Confidential
// Unauthorised use or distribution is strictly prohibited.
// ============================================================

/**
 * EIP API Worker
 * REST API over Cloudflare D1 (canonical topic store) and R2 (blob storage).
 *
 * Endpoints (skeleton — to be implemented):
 *   GET  /health                     — Health check
 *   GET  /topics                     — List all topics
 *   GET  /topics/:id                 — Get topic by ID
 *   POST /topics                     — Create/upsert topic
 *   GET  /topics/:id/occurrences     — Get all occurrences of a topic
 *   POST /occurrences                — Record a new topic occurrence
 *   GET  /queue                      — Get pending items for agent review
 *   PATCH /queue/:id                 — Update queue item status (approve/reject/amend)
 *   POST /sessions                   — Create agent session log entry
 */

export interface Env {
  DB: D1Database;
  // STORAGE: R2Bucket; // Uncomment once R2 is enabled
  ENVIRONMENT: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // --- Health check ---
      if (path === "/health" && method === "GET") {
        const dbCheck = await env.DB.prepare("SELECT 1 as ok").first<{ ok: number }>();
        return jsonResponse({
          status: "ok",
          environment: env.ENVIRONMENT,
          db: dbCheck?.ok === 1 ? "connected" : "error",
          timestamp: new Date().toISOString(),
        });
      }

      // --- Topics ---
      if (path === "/topics" && method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM topics ORDER BY last_seen DESC LIMIT 100"
        ).all();
        return jsonResponse({ topics: results, count: results.length });
      }

      if (path.match(/^\/topics\/[^/]+$/) && method === "GET") {
        const topicId = path.split("/")[2];
        const topic = await env.DB.prepare(
          "SELECT * FROM topics WHERE topic_id = ?"
        ).bind(topicId).first();
        if (!topic) return errorResponse("Topic not found", 404);
        return jsonResponse(topic);
      }

      if (path === "/topics" && method === "POST") {
        return jsonResponse({ message: "POST /topics — not yet implemented" }, 501);
      }

      // --- Topic Occurrences ---
      if (path.match(/^\/topics\/[^/]+\/occurrences$/) && method === "GET") {
        const topicId = path.split("/")[2];
        const { results } = await env.DB.prepare(
          "SELECT * FROM topic_occurrences WHERE topic_id = ? ORDER BY meeting_date DESC"
        ).bind(topicId).all();
        return jsonResponse({ occurrences: results, count: results.length });
      }

      if (path === "/occurrences" && method === "POST") {
        return jsonResponse({ message: "POST /occurrences — not yet implemented" }, 501);
      }

      // --- Agent Queue ---
      if (path === "/queue" && method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM topic_occurrences WHERE status = 'Pending' ORDER BY created_at ASC"
        ).all();
        return jsonResponse({ queue: results, count: results.length });
      }

      if (path.match(/^\/queue\/[^/]+$/) && method === "PATCH") {
        return jsonResponse({ message: "PATCH /queue/:id — not yet implemented" }, 501);
      }

      // --- Sessions ---
      if (path === "/sessions" && method === "POST") {
        return jsonResponse({ message: "POST /sessions — not yet implemented" }, 501);
      }

      return errorResponse("Not found", 404);
    } catch (err) {
      console.error("EIP API Worker error:", err);
      return errorResponse(
        `Internal server error: ${err instanceof Error ? err.message : String(err)}`,
        500
      );
    }
  },
};
