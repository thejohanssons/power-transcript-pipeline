import { describe, expect, test } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { backfillAllTopicEvidence, buildEvidenceBackfillParams, buildEvidenceBackfillSql } from './evidence-backfill';

function createFixtureDb() {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const meetings = [
    { meeting_id: 'meeting-a', r2_output_key: 'meetings/meeting-a/meeting-output.json' },
    { meeting_id: 'meeting-b', r2_output_key: 'meetings/meeting-b/meeting-output.json' },
  ];
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          statements.push({ sql, params });
          return {
            async first<T>() {
              if (sql.startsWith('SELECT COUNT(*)')) return { count: 2 } as T;
              return null;
            },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
        async all<T>() { return { results: meetings } as T; },
        async first<T>() {
          if (sql.startsWith('SELECT COUNT(*)')) return { count: 2 } as T;
          return null;
        },
      };
    },
    async batch(batchStatements: Array<{ run: () => Promise<{ meta: { changes: number } }> }>) {
      return Promise.all(batchStatements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;
  return { db, statements };
}

function createFixtureBucket(outputs: Record<string, unknown>) {
  return {
    async get(key: string) {
      const value = outputs[key];
      return value === undefined ? null : { json: async <T>() => value as T };
    },
  } as unknown as R2Bucket;
}

describe('topic evidence backfill', () => {
  test('updates every existing topic from every stored meeting output', async () => {
    const { db, statements } = createFixtureDb();
    const bucket = createFixtureBucket({
      'meetings/meeting-a/meeting-output.json': {
        topics: [{
          topicId: 'meeting-a-topic-1',
          domain: 'Information Technology',
          entityType: 'Technology Platform',
          entity: 'Inspire QR-login camera',
          aspect: 'Performance',
          outcome: 'Risk',
          disposition: 'Deferral',
          executiveScope: 'Tactical',
          topicStatement: 'The camera workaround is deferred until the MVP release.',
          summary: 'Browser refresh is the interim workaround.',
          keyFacts: [{ id: 'fact-1', text: 'The feed freezes when reopened.' }],
          decisions: [{ id: 'decision-1', text: 'Defer the permanent fix.' }],
          actions: [{ id: 'action-1', text: 'Document the workaround.' }],
          risks: [{ id: 'risk-1', text: 'QR login may be interrupted.' }],
          validation: { status: 'pass', reasons: [] },
        }],
      },
      'meetings/meeting-b/meeting-output.json': {
        topics: [{
          topicId: 'meeting-b-topic-1',
          topicStatement: 'A second topic exists.',
          keyFacts: [],
          decisions: [],
          actions: [],
          risks: [],
          validation: { status: 'warning', reasons: ['legacy output'] },
        }],
      },
    });

    const result = await backfillAllTopicEvidence(db, bucket);

    expect(result.meetingsScanned).toBe(2);
    expect(result.meetingsUpdated).toBe(2);
    expect(result.topicsUpdated).toBe(2);
    expect(result.outputsMissing).toBe(0);
    expect(result.outputsInvalid).toBe(0);
    expect(statements).toHaveLength(2);
    expect(statements[0].sql).toBe(buildEvidenceBackfillSql());
    expect(statements[0].params).toContain(JSON.stringify([{ id: 'fact-1', text: 'The feed freezes when reopened.' }]));
    expect(statements[0].params).toContain('meeting-a-topic-1');
    expect(statements[1].params).toContain('meeting-b-topic-1');
  });

  test('serializes complete evidence fields for D1', () => {
    const params = buildEvidenceBackfillParams({
      topicId: 'topic-1',
      meetingId: 'meeting-1',
      domain: 'Information Technology',
      entityType: 'Technology Platform',
      entity: 'Camera',
      aspect: 'Performance',
      outcome: 'Risk',
      disposition: 'Deferral',
      executiveScope: 'Tactical',
      topicStatement: 'Camera delivery is at risk.',
      summary: 'Summary',
      keyFacts: [{ id: 'f', text: 'Fact' }],
      decisions: [{ id: 'd', text: 'Decision' }],
      actions: [{ id: 'a', text: 'Action' }],
      risks: [{ id: 'r', text: 'Risk' }],
      validationStatus: 'pass',
      validationReasons: [],
    });

    expect(params.slice(9, 13)).toEqual([
      JSON.stringify([{ id: 'f', text: 'Fact' }]),
      JSON.stringify([{ id: 'd', text: 'Decision' }]),
      JSON.stringify([{ id: 'a', text: 'Action' }]),
      JSON.stringify([{ id: 'r', text: 'Risk' }]),
    ]);
  });
});
