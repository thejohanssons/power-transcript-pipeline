// ============================================================
// EIP Local Cockpit Server — Loopback guard tests (Step 9)
// ============================================================

import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { enforceLoopback } from './loopback-guard.js';

// ── Unit tests for enforceLoopback ────────────────────────

function makeReq(host: string): IncomingMessage {
  return { headers: { host } } as unknown as IncomingMessage;
}

function makeRes(): { res: ServerResponse; statusCode: number | null; ended: boolean } {
  const state = { statusCode: null as number | null, ended: false };
  const res = {
    writeHead(code: number) { state.statusCode = code; },
    end() { state.ended = true; },
  } as unknown as ServerResponse;
  return { res, ...state };
}

describe('enforceLoopback', () => {
  it('allows localhost', () => {
    const { res } = makeRes();
    const allowed = enforceLoopback(makeReq('localhost:4321'), res);
    expect(allowed).toBe(true);
  });

  it('allows 127.0.0.1', () => {
    const { res } = makeRes();
    const allowed = enforceLoopback(makeReq('127.0.0.1:4321'), res);
    expect(allowed).toBe(true);
  });

  it('allows ::1 (IPv6 loopback)', () => {
    const { res } = makeRes();
    const allowed = enforceLoopback(makeReq('[::1]:4321'), res);
    expect(allowed).toBe(true);
  });

  it('allows bare localhost without port', () => {
    const { res } = makeRes();
    const allowed = enforceLoopback(makeReq('localhost'), res);
    expect(allowed).toBe(true);
  });

  it('rejects remote hostname', () => {
    const state = { statusCode: null as number | null, ended: false };
    const res = {
      writeHead(code: number) { state.statusCode = code; },
      end() { state.ended = true; },
    } as unknown as ServerResponse;
    const allowed = enforceLoopback(makeReq('example.com'), res);
    expect(allowed).toBe(false);
    expect(state.statusCode).toBe(403);
    expect(state.ended).toBe(true);
  });

  it('rejects remote IP', () => {
    const state = { statusCode: null as number | null, ended: false };
    const res = {
      writeHead(code: number) { state.statusCode = code; },
      end() { state.ended = true; },
    } as unknown as ServerResponse;
    const allowed = enforceLoopback(makeReq('192.168.1.100:4321'), res);
    expect(allowed).toBe(false);
    expect(state.statusCode).toBe(403);
  });

  it('rejects missing host header', () => {
    const req = { headers: {} } as unknown as IncomingMessage;
    const state = { statusCode: null as number | null, ended: false };
    const res = {
      writeHead(code: number) { state.statusCode = code; },
      end() { state.ended = true; },
    } as unknown as ServerResponse;
    const allowed = enforceLoopback(req, res);
    expect(allowed).toBe(false);
    expect(state.statusCode).toBe(403);
  });
});
