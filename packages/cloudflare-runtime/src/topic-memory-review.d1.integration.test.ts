import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { describe, expect, test, afterEach, beforeEach } from 'vitest';
import runtime from './index';
import type { Env } from './types';

const migrationFiles = [
  'migrations/0001_initial_schema.sql',
  'migrations/0002_topic_memory_live_review_decisions.sql',
  'migrations/0003_topic_memory_review_transaction_guard.sql',
];

async function sqlFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function exec(db: D1Database, sql: string): Promise<void> {
  const withoutComments = sql.replace(/--.*$/gm, '');
  const statements = withoutComments
    .split(/;(?=\s*(?:CREATE|ALTER|INSERT|UPDATE|DELETE|DROP))/i)
    .map(statement => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await db.prepare(statement).run();
}

function env(db: D1Database): Env {
  return {
    DB: db,
    OUTPUT_BUCKET: {} as R2Bucket,
    PROCESSING_QUEUE: { send: async () => undefined } as unknown as Queue,
    ENVIRONMENT: 'test', AZURE_OPENAI_ENDPOINT: '', AZURE_OPENAI_DEPLOYMENT: '', AZURE_OPENAI_API_KEY: '',
    SUBMISSION_TOKEN: 'submit-token', REVIEW_DECISION_TOKEN: 'review-token',
  };
}

function request(decision: 'approve_match' | 'reject_match', key: string, version = 'source-v1') {
  return new Request('http://local/v1/topic-memory/candidate/match', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer review-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, expectedSourceVersion: version, expectedProposedMatchMemoryId: 'target',
      reviewerName: 'Integration Reviewer', note: 'Real local D1 integration evidence.', warningAcknowledged: true, idempotencyKey: key }),
  });
}

async function seed(db: D1Database): Promise<void> {
  await exec(db, `
    INSERT INTO meetings (meeting_id, source_system, native_id, subject, transcript_sha256, state)
    VALUES ('candidate-meeting', 'synthetic', 'candidate-native', 'Candidate', 'candidate-hash', 'completed'),
           ('target-meeting', 'synthetic', 'target-native', 'Target', 'target-hash', 'completed');
    INSERT INTO topic_memory (
      memory_id, domain, entity_type, entity, canonical_statement,
      first_seen_meeting_id, last_seen_meeting_id, first_seen_date, last_seen_date,
      meeting_count, match_status, proposed_match_memory_id, proposed_match_reason,
      status, updated_at
    ) VALUES
      ('target', 'Synthetic', 'Project', 'Guard test', 'Target memory', 'target-meeting', 'target-meeting', '2026-08-01', '2026-08-01', 1, 'confirmed', NULL, NULL, 'open', 'target-v1'),
      ('candidate', 'Synthetic', 'Project', 'Guard test', 'Candidate memory', 'candidate-meeting', 'candidate-meeting', '2026-08-02', '2026-08-02', 1, 'pending_review', 'target', 'same thread', 'open', 'source-v1');
  `);
}

describe('topic-memory review against real local D1', () => {
  let miniflare: Miniflare;
  let db: D1Database;

  beforeEach(async () => {
    miniflare = new Miniflare({ modules: true, script: 'export default {}', compatibilityDate: '2026-08-07', d1Databases: { DB: 'topic-memory-review-integration' } });
    db = await miniflare.getD1Database('DB');
    for (const file of migrationFiles) await exec(db, await sqlFile(file));
    await seed(db);
  });

  afterEach(async () => { await miniflare.dispose(); });

  test('approve, reject, and idempotency work with real D1', async () => {
    const approved = await runtime.fetch(request('approve_match', 'approve-1'), env(db));
    expect(approved.status).toBe(200);
    const target = await db.prepare('SELECT meeting_count FROM topic_memory WHERE memory_id = ?').bind('target').first<{ meeting_count: number }>();
    expect(target?.meeting_count).toBe(2);
    const replay = await runtime.fetch(request('approve_match', 'approve-1'), env(db));
    expect(replay.status).toBe(200);
    expect((await replay.json() as { idempotentReplay: boolean }).idempotentReplay).toBe(true);
    const eventCount = await db.prepare('SELECT COUNT(*) AS count FROM topic_memory_review_events').first<{ count: number }>();
    expect(eventCount?.count).toBe(1);

    await exec(db, `UPDATE topic_memory SET match_status = 'pending_review', proposed_match_memory_id = 'target', proposed_match_reason = 'same thread', merged_into_memory_id = NULL, review_event_id = NULL, updated_at = 'source-v1' WHERE memory_id = 'candidate'; DELETE FROM topic_memory_review_events;`);
    const rejected = await runtime.fetch(request('reject_match', 'reject-1'), env(db));
    expect(rejected.status).toBe(200);
    const candidate = await db.prepare('SELECT match_status, proposed_match_memory_id FROM topic_memory WHERE memory_id = ?').bind('candidate').first<{ match_status: string; proposed_match_memory_id: string | null }>();
    expect(candidate).toEqual({ match_status: 'confirmed', proposed_match_memory_id: null });
  });

  test('aborted compare-and-set rolls back audit, candidate, and target mutations', async () => {
    const competingDb = new Proxy(db, {
      get(targetDb, property, receiver) {
        if (property !== 'batch') return Reflect.get(targetDb, property, receiver);
        return async (statements: D1PreparedStatement[]) => {
          await targetDb.prepare(`UPDATE topic_memory SET updated_at = 'competing-version' WHERE memory_id = 'candidate'`).run();
          return targetDb.batch(statements);
        };
      },
    }) as unknown as D1Database;

    const response = await runtime.fetch(request('approve_match', 'race-1'), env(competingDb));
    expect(response.status).toBe(409);
    const rows = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM topic_memory_review_events) AS events,
      (SELECT match_status FROM topic_memory WHERE memory_id = 'candidate') AS candidate_status,
      (SELECT merged_into_memory_id FROM topic_memory WHERE memory_id = 'candidate') AS candidate_target,
      (SELECT meeting_count FROM topic_memory WHERE memory_id = 'target') AS target_count`).first<{
        events: number; candidate_status: string; candidate_target: string | null; target_count: number;
      }>();
    expect(rows).toEqual({ events: 0, candidate_status: 'pending_review', candidate_target: null, target_count: 1 });
  });
});
