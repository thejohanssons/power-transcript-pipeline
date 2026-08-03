import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FixtureJob, FixtureManifest, NormalizedOutput, PublicationIntent } from './contracts';
import worker from './index';

const fixtureId = 'synthetic-fixture-0001';
const fixtureRoot = `fixtures/${fixtureId}/revision-1`;
const transcript = 'WEBVTT\n\n00:00.000 --> 00:03.000\nSynthetic meeting: approve the test budget.\n';
const publicationIntent: PublicationIntent = {
  transcript: true,
  summary: true,
  peopleFile: true,
  topicRecords: true,
  masterLog: true,
  confluence: false,
  teamsNotification: false,
  canonicalTopicMemory: false,
  legacyCloudflareSync: false,
};

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizedOutput(transcriptSha256: string, runtime: 'azure' | 'cloudflare'): NormalizedOutput {
  return {
    schemaVersion: '1.0.0',
    source: {
      system: 'synthetic_local_test',
      nativeId: fixtureId,
      transcriptSha256,
      acquisitionMode: 'direct_vtt',
    },
    processing: {
      runtime,
      pipelineVersion: 'synthetic-1',
      promptVersion: 'synthetic-prompt-1',
      model: 'synthetic-model',
      deployment: 'synthetic-deployment',
      configurationHashes: { taxonomy: 'b'.repeat(64) },
    },
    classification: { mode: 'internal', confidence: 'high' },
    summaryAssertions: [{ id: 'summary-1', text: 'The test budget was approved.' }],
    topics: [],
    people: [],
    validation: { status: 'pass', reasons: [] },
    publicationIntent,
  };
}

class LocalD1 {
  readonly database = new DatabaseSync(':memory:');

  constructor() {
    this.database.exec(readFileSync(new URL('../migrations/0001_shadow_runs.sql', import.meta.url), 'utf8'));
  }

  prepare(query: string) {
    return {
      bind: (...values: SQLInputValue[]) => ({
        run: async () => {
          const result = this.database.prepare(query).run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
        first: async <T>() => (this.database.prepare(query).get(...values) ?? null) as T | null,
      }),
    };
  }

  close(): void {
    this.database.close();
  }
}

class LocalR2 {
  readonly objects = new Map<string, string>();

  async get(key: string) {
    const value = this.objects.get(key);
    return value === undefined ? null : { text: async () => value };
  }

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runtime-shadow synthetic local Worker integration', () => {
  it('runs a synthetic fixture request through local D1, Queue, R2, and a stubbed model response exactly once', async () => {
    const transcriptSha256 = await sha256(transcript);
    const azureOutput = normalizedOutput(transcriptSha256, 'azure');
    const cloudflareOutput = normalizedOutput(transcriptSha256, 'cloudflare');
    const baselineText = JSON.stringify(azureOutput);
    const publicationIntentText = JSON.stringify(publicationIntent);
    const manifest: FixtureManifest = {
      schemaVersion: '1.0.0',
      fixtureId,
      revision: 'revision-1',
      acquisitionMode: 'direct_vtt',
      source: { system: 'synthetic_local_test', nativeId: fixtureId },
      transcript: {
        key: `${fixtureRoot}/input/transcript.vtt`,
        sha256: transcriptSha256,
        bytes: new TextEncoder().encode(transcript).byteLength,
        contentType: 'text/vtt',
      },
      azureBaseline: {
        normalizedOutput: {
          key: `${fixtureRoot}/baseline/azure-normalized-output.json`,
          sha256: await sha256(baselineText),
          bytes: new TextEncoder().encode(baselineText).byteLength,
          contentType: 'application/json',
        },
        publicationIntent: {
          key: `${fixtureRoot}/baseline/azure-publication-intent.json`,
          sha256: await sha256(publicationIntentText),
          bytes: new TextEncoder().encode(publicationIntentText).byteLength,
          contentType: 'application/json',
        },
      },
      configuration: [{ name: 'synthetic-taxonomy', version: '1', sha256: 'b'.repeat(64) }],
      processing: {
        azurePipelineVersion: 'synthetic-1',
        promptVersion: 'synthetic-prompt-1',
        model: 'synthetic-model',
        deployment: 'synthetic-deployment',
      },
      classification: 'internal',
      approvedBy: 'synthetic-reviewer@example.test',
      approvedAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2027-08-01T00:00:00.000Z',
    };
    const manifestText = JSON.stringify(manifest);
    const manifestKey = `${fixtureRoot}/manifest.json`;
    const r2 = new LocalR2();
    r2.objects.set(manifestKey, manifestText);
    r2.objects.set(manifest.transcript.key, transcript);
    r2.objects.set(manifest.azureBaseline.normalizedOutput.key, baselineText);
    r2.objects.set(manifest.azureBaseline.publicationIntent.key, publicationIntentText);

    const d1 = new LocalD1();
    const queuedJobs: FixtureJob[] = [];
    const fetchStub = vi.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toContain('synthetic.invalid/openai/deployments/synthetic-deployment/chat/completions');
      return new Response(JSON.stringify({
        model: 'synthetic-model',
        choices: [{ message: { content: JSON.stringify(cloudflareOutput) } }],
        usage: { prompt_tokens: 12, completion_tokens: 6 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchStub);

    const env = {
      ENVIRONMENT: 'test',
      SHADOW_MODE: 'fixture_parity',
      AZURE_OPENAI_ENDPOINT: 'https://synthetic.invalid/',
      AZURE_OPENAI_DEPLOYMENT: 'synthetic-deployment',
      AZURE_OPENAI_API_VERSION: '2024-10-21',
      AZURE_OPENAI_API_KEY: 'synthetic-local-key',
      SHADOW_REVIEWER_TOKEN: 'synthetic-review-token',
      SHADOW_DB: d1,
      SHADOW_ARTIFACTS: r2,
      FIXTURE_JOBS: { send: async (job: FixtureJob) => { queuedJobs.push(job); } },
    } as unknown as Cloudflare.StagingEnv & { AZURE_OPENAI_API_KEY: string; SHADOW_REVIEWER_TOKEN: string };

    try {
      const submission = await worker.fetch(new Request('https://worker.local/v1/fixture-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ manifestKey }),
      }), env);
      expect(submission.status).toBe(202);
      const submissionBody = await submission.json() as { runId: string; state: string; replayed: boolean };
      expect(submissionBody).toMatchObject({ state: 'queued', replayed: false });
      expect(queuedJobs).toHaveLength(1);

      const delivery = { body: queuedJobs[0], ack: vi.fn(), retry: vi.fn() };
      await worker.queue({ messages: [delivery] } as unknown as MessageBatch<FixtureJob>, env);
      expect(delivery.ack).toHaveBeenCalledOnce();
      expect(delivery.retry).not.toHaveBeenCalled();
      expect(fetchStub).toHaveBeenCalledOnce();

      const run = await d1.prepare('SELECT state, comparison_status FROM fixture_runs WHERE run_id = ?')
        .bind(submissionBody.runId).first<{ state: string; comparison_status: string }>();
      expect(run).toEqual({ state: 'completed', comparison_status: 'pass' });
      expect(r2.objects.get(`runs/${submissionBody.runId}/cloudflare-normalized-output.json`)).toBe(JSON.stringify(cloudflareOutput));
      expect(r2.objects.get(`runs/${submissionBody.runId}/cloudflare-publication-intent.json`)).toBe(JSON.stringify(publicationIntent));
      expect(r2.objects.get(`runs/${submissionBody.runId}/comparison.json`)).toContain('"status":"pass"');
      expect(r2.objects.get(`runs/${submissionBody.runId}/comparison.md`)).toContain('EIP Runtime Shadow Comparison Report');

      const delayedDuplicate = { body: queuedJobs[0], ack: vi.fn(), retry: vi.fn() };
      await worker.queue({ messages: [delayedDuplicate] } as unknown as MessageBatch<FixtureJob>, env);
      expect(delayedDuplicate.ack).toHaveBeenCalledOnce();
      expect(delayedDuplicate.retry).not.toHaveBeenCalled();
      expect(fetchStub).toHaveBeenCalledOnce();
    } finally {
      d1.close();
    }
  });
});
