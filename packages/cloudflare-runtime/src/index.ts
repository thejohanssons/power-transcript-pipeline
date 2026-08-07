import type { Env } from './types';

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

  async handlePostMeeting(request: Request, _env: Env): Promise<Response> {
    const body = await request.json().catch(() => null);
    if (!body) return errorResponse('Request body must be valid JSON', 400);
    return jsonResponse({ message: 'Meeting submission endpoint — implementation pending' });
  },

  async handleGetTopicMemory(_env: Env): Promise<Response> {
    return jsonResponse({ topicMemory: [] });
  },

  async handlePostTopicMemoryMatch(id: string, _request: Request, _env: Env): Promise<Response> {
    return jsonResponse({ message: `Match review endpoint — implementation pending (id: ${id})` });
  },
};
