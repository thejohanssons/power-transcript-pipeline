// ============================================================
// EIP Local Cockpit Server — HTTP Router
// Serves the cockpit static UI and live-data API endpoints.
// ============================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeD1Adapter } from './adapters/runtime-d1.js';
import type { FeedbackD1Adapter } from './adapters/feedback-d1.js';
import type { RuntimeReviewClient } from './adapters/runtime-review-client.js';
import { createApiRouter } from './api/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// Static assets are served from packages/exco-cockpit/public
const PUBLIC_DIR = join(__dirname, '..', '..', 'exco-cockpit', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

export interface RouterDeps {
  runtimeD1: RuntimeD1Adapter;
  feedbackD1: FeedbackD1Adapter;
  runtimeReviewClient: RuntimeReviewClient;
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-Local-POC-Boundary': 'loopback-only',
  });
  res.end(body);
}

async function serveStatic(res: ServerResponse, filePath: string): Promise<void> {
  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': content.length,
    });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export function createRouter(deps: RouterDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const apiRouter = createApiRouter(deps);

  return async function router(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    try {
      // ── API routes ───────────────────────────────────────
      if (pathname.startsWith('/api/')) {
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method ?? '')
          ? await readBody(req)
          : undefined;
        await apiRouter(req, res, url, body);
        return;
      }

      // ── Static assets ────────────────────────────────────
      // Serve from exco-cockpit/public (reuse the existing UI)
      let filePath = join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
      // Prevent directory traversal
      if (!filePath.startsWith(PUBLIC_DIR)) {
        json(res, { error: 'Forbidden' }, 403);
        return;
      }
      await serveStatic(res, filePath);

    } catch (err) {
      console.error('[router] Unhandled error:', err);
      json(res, { error: 'Internal server error' }, 500);
    }
  };
}
