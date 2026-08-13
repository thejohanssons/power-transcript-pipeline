// ============================================================
// EIP Local Cockpit Server — Runtime D1 adapter tests (Step 9)
//
// Proves that the adapter:
// 1. Has no write methods (immutability contract)
// 2. Issues only SELECT statements (structural read-only)
// 3. Returns correctly shaped DTOs
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeD1Adapter } from './runtime-d1.js';
import type { RuntimeD1Adapter } from './runtime-d1.js';

// ── Mock fetch ─────────────────────────────────────────────

function makeD1Response<T>(results: T[]) {
  return {
    success: true,
    errors: [],
    result: [{ results, success: true, meta: { duration: 1, rows_read: results.length, rows_written: 0 } }],
  };
}

function mockFetch(results: unknown[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => makeD1Response(results),
    text: async () => '',
  });
}

const CONFIG = {
  accountId: 'test-account',
  token: 'test-token',
  databaseId: 'test-db-id',
};

// ── Immutability: no write methods exist ───────────────────

describe('RuntimeD1Adapter — immutability contract', () => {
  it('has no insert method', () => {
    const adapter = createRuntimeD1Adapter(CONFIG);
    expect((adapter as unknown as Record<string, unknown>).insert).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).insertMeeting).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).insertTopic).toBeUndefined();
  });

  it('has no update method', () => {
    const adapter = createRuntimeD1Adapter(CONFIG);
    expect((adapter as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).updateMeeting).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).updateTopic).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).updateTopicMemory).toBeUndefined();
  });

  it('has no delete method', () => {
    const adapter = createRuntimeD1Adapter(CONFIG);
    expect((adapter as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).deleteMeeting).toBeUndefined();
  });

  it('has no generic query method', () => {
    const adapter = createRuntimeD1Adapter(CONFIG);
    expect((adapter as unknown as Record<string, unknown>).query).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).exec).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).run).toBeUndefined();
  });

  it('exposes only the expected read methods (no content-read or write methods)', () => {
    const adapter = createRuntimeD1Adapter(CONFIG);
    const keys = Object.keys(adapter).sort();
    expect(keys).toEqual([
      'baselineCounts',
      'getMeeting',
      'getTopic',
      'getTopicMemory',
      'listActions',
      'listActionsByMeeting',
      'listDecisions',
      'listDecisionsByMeeting',
      'listMeetings',
      'listPeopleByMeeting',
      'listTopicMemory',
      'listTopicMemoryReviewEvents',
      'listTopics',
      'listTopicsByMeeting',
    ].sort());
  });
});

// ── SELECT-only: all queries use SELECT ────────────────────

describe('RuntimeD1Adapter — SELECT-only queries', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = mockFetch([]);
    vi.stubGlobal('fetch', fetchSpy);
  });

  async function getSql(): Promise<string> {
    const call = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    const body = JSON.parse(call[1].body as string);
    return body.sql as string;
  }

  const adapter = () => createRuntimeD1Adapter(CONFIG);

  it('listMeetings uses SELECT', async () => {
    await adapter().listMeetings();
    expect((await getSql()).trim().toUpperCase()).toMatch(/^SELECT/);
  });

  it('getMeeting uses SELECT', async () => {
    await adapter().getMeeting('test-id');
    expect((await getSql()).trim().toUpperCase()).toMatch(/^SELECT/);
  });

  it('listTopics uses SELECT', async () => {
    await adapter().listTopics();
    expect((await getSql()).trim().toUpperCase()).toMatch(/^SELECT/);
  });

  it('listTopicMemory uses SELECT', async () => {
    await adapter().listTopicMemory();
    expect((await getSql()).trim().toUpperCase()).toMatch(/^SELECT/);
  });

  it('listTopicMemoryReviewEvents uses SELECT', async () => {
    await adapter().listTopicMemoryReviewEvents();
    expect((await getSql()).trim().toUpperCase()).toMatch(/^SELECT/);
  });

  it('listActions uses SELECT', async () => {
    await adapter().listActions();
    expect((await getSql()).trim().toUpperCase()).toMatch(/^SELECT/);
  });

  it('listDecisions uses SELECT', async () => {
    await adapter().listDecisions();
    expect((await getSql()).trim().toUpperCase()).toMatch(/^SELECT/);
  });

  it('baselineCounts uses SELECT only', async () => {
    // baselineCounts makes multiple queries — all must be SELECT
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeD1Response([{ n: 5 }]),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchSpy);
    await adapter().baselineCounts();
    for (const call of fetchSpy.mock.calls) {
      const body = JSON.parse(call[1].body as string);
      expect(body.sql.trim().toUpperCase()).toMatch(/^SELECT/);
    }
  });
});

// ── Shape: returned DTOs match expected fields ──────────────

describe('RuntimeD1Adapter — DTO shapes', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch([]));
  });

  it('listMeetings returns an array', async () => {
    const rows = await createRuntimeD1Adapter(CONFIG).listMeetings();
    expect(Array.isArray(rows)).toBe(true);
  });

  it('getMeeting returns null when not found', async () => {
    const row = await createRuntimeD1Adapter(CONFIG).getMeeting('does-not-exist');
    expect(row).toBeNull();
  });

  it('baselineCounts returns object with expected table keys', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeD1Response([{ n: 42 }]),
      text: async () => '',
    }));
    const counts = await createRuntimeD1Adapter(CONFIG).baselineCounts();
    expect(counts).toHaveProperty('meetings');
    expect(counts).toHaveProperty('topics');
    expect(counts).toHaveProperty('topic_memory');
    expect(counts).toHaveProperty('actions');
    expect(counts).toHaveProperty('decisions');
    expect(counts).toHaveProperty('people');
    for (const v of Object.values(counts)) {
      expect(typeof v).toBe('number');
    }
  });
});
