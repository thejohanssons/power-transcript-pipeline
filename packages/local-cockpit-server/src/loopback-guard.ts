// ============================================================
// EIP Local Cockpit Server — Loopback guard middleware
//
// Rejects any request whose Host header resolves to a non-loopback
// address. This is defence-in-depth: the server also binds only to
// 127.0.0.1, but an operator misconfiguration (e.g. 0.0.0.0) could
// expose it. The guard closes that gap at the HTTP layer.
// ============================================================

import type { IncomingMessage, ServerResponse } from 'node:http';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Returns the bare hostname from a Host header value (strips port).
 */
function parseHostname(hostHeader: string): string {
  // IPv6 literal: [::1]:4321 → ::1
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']');
    return end !== -1 ? hostHeader.slice(1, end) : hostHeader;
  }
  // hostname:port or bare hostname
  const colonIdx = hostHeader.lastIndexOf(':');
  return colonIdx !== -1 ? hostHeader.slice(0, colonIdx) : hostHeader;
}

/**
 * Middleware-style guard. Returns true if the request is allowed
 * (loopback), or writes a 403 and returns false.
 */
export function enforceLoopback(req: IncomingMessage, res: ServerResponse): boolean {
  const hostHeader = req.headers['host'] ?? '';
  const hostname = parseHostname(hostHeader).toLowerCase();

  if (LOOPBACK_HOSTNAMES.has(hostname)) return true;

  const body = JSON.stringify({
    error: 'Forbidden',
    detail:
      'This server is restricted to loopback access only (localhost / 127.0.0.1). ' +
      'It must not be accessed remotely. ' +
      'It reads live production D1 data and must never be exposed outside the local machine.',
  });

  res.writeHead(403, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-Local-POC-Boundary': 'loopback-only',
  });
  res.end(body);
  return false;
}
