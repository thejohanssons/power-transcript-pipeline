import { describe, expect, test } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { invalidateMeetings, parseMeetingInvalidationRequest } from './meeting-invalidation';

function fixtureDb() {
  const db = {
    prepare(sql: string) {
      return {
        bind(..._params: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('FROM meetings')) {
                return { meeting_id: 'meeting-1', state: 'completed', subject: 'Bad output', r2_output_key: 'meetings/meeting-1/meeting-output.json' } as T;
              }
              return { topics: 2, actions: 1, decisions: 1, people: 1 } as T;
            },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
      };
    },
    async batch() { return []; },
  } as unknown as D1Database;
  return db;
}

function fixtureBucket() {
  return {
    async list() { return { objects: [{ key: 'meetings/meeting-1/meeting-output.json' }], truncated: false }; },
    async get() { return null; },
    async put() {},
    async delete() {},
  } as unknown as R2Bucket;
}

describe('meeting invalidation', () => {
  test('defaults to dry-run and quarantine', () => {
    expect(parseMeetingInvalidationRequest({ meetingIds: ['meeting-1'], reason: 'bad transcript' })).toEqual({
      meetingIds: ['meeting-1'], reason: 'bad transcript', dryRun: true, confirm: null, quarantineR2: true,
    });
  });

  test('dry-run previews records without deleting or mutating', async () => {
    const result = await invalidateMeetings(fixtureDb(), fixtureBucket(), {
      meetingIds: ['meeting-1'], reason: 'cross-occurrence contamination', dryRun: true,
      confirm: null, quarantineR2: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.previews[0].topicCount).toBe(2);
    expect(result.invalidated).toEqual([]);
  });

  test('requires explicit confirmation for destructive mode', async () => {
    const result = await invalidateMeetings(fixtureDb(), fixtureBucket(), {
      meetingIds: ['meeting-1'], reason: 'bad transcript', dryRun: false,
      confirm: null, quarantineR2: true,
    });
    expect(result.confirmationRequired).toBe('INVALIDATE_MEETING');
    expect(result.invalidated).toEqual([]);
  });
});
