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

const noPublication: PublicationIntent = {
  transcript: false,
  summary: false,
  peopleFile: false,
  topicRecords: false,
  masterLog: false,
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
    },
    classification: { mode: 'internal', confidence: 'high' },
    summaryAssertions: [{ id: 'summary-1', text: 'The test budget was approved.' }],
    topics: [],
    people: [],
    validation: { status: 'pass', reasons: [] },
    publicationIntent,
    ...(runtime === 'cloudflare' ? {
      actualPublication: {
        transcript: false,
        summary: false,
        peopleFile: false,
        topicRecords: false,
        masterLog: false,
        confluence: false,
        teamsNotification: false,
        canonicalTopicMemory: false,
        legacyCloudflareSync: false,
      },
    } : {}),
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
  failNextPutFor: string | undefined;

  async get(key: string) {
    const value = this.objects.get(key);
    return value === undefined ? null : { text: async () => value };
  }

  async put(key: string, value: string): Promise<void> {
    if (key === this.failNextPutFor) {
      this.failNextPutFor = undefined;
      throw new Error(`Synthetic local R2 failure for ${key}`);
    }
    this.objects.set(key, value);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runtime-shadow synthetic local Worker integration', () => {
  it('authorizes submission, serializes recovery against a delayed delivery, and reuses a checkpoint after artifact persistence failure', async () => {
    const transcriptSha256 = await sha256(transcript);
    const azureOutput = normalizedOutput(transcriptSha256, 'azure');
    const cloudflareOutput = normalizedOutput(transcriptSha256, 'cloudflare');
    const cloudflareModelOutput = { ...cloudflareOutput, publicationIntent: noPublication };
    const baselineText = JSON.stringify(azureOutput);
    const publicationIntentText = JSON.stringify(publicationIntent);
    const configurationSnapshotText = JSON.stringify({
      taxonomy: { version: '1', sha256: 'b'.repeat(64) },
      processing: { promptVersion: 'synthetic-prompt-1', model: 'synthetic-model', deployment: 'synthetic-deployment' },
    });
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
      configurationSnapshot: {
        key: `${fixtureRoot}/baseline/config-snapshot.json`,
        sha256: await sha256(configurationSnapshotText),
        bytes: new TextEncoder().encode(configurationSnapshotText).byteLength,
        contentType: 'application/json',
      },
      configuration: [{ name: 'taxonomy', version: '1', sha256: 'b'.repeat(64) }],
      processing: {
        azurePipelineVersion: 'synthetic-1',
        promptVersion: 'synthetic-prompt-1',
        model: 'synthetic-model',
        deployment: 'synthetic-deployment',
      },
      classification: 'internal',
      approvedBy: 'synthetic-reviewer@example.test',
      approvedAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-08-30T00:00:00.000Z',
    };
    const manifestText = JSON.stringify(manifest);
    const manifestKey = `${fixtureRoot}/manifest.json`;
    const r2 = new LocalR2();
    r2.objects.set(manifestKey, manifestText);
    r2.objects.set(manifest.transcript.key, transcript);
    r2.objects.set(manifest.azureBaseline.normalizedOutput.key, baselineText);
    r2.objects.set(manifest.azureBaseline.publicationIntent.key, publicationIntentText);
    r2.objects.set(manifest.configurationSnapshot.key, configurationSnapshotText);

    const d1 = new LocalD1();
    const queuedJobs: FixtureJob[] = [];
    const fetchStub = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe(
        'https://synthetic.invalid/openai/deployments/synthetic-deployment/chat/completions?api-version=2024-02-15-preview',
      );
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({ 'api-key': 'synthetic-api-key', 'content-type': 'application/json' });
      const requestBody = JSON.parse(String(init?.body));
      expect(requestBody).toMatchObject({
        model: 'synthetic-deployment',
        max_completion_tokens: 16000,
        response_format: { type: 'json_object' },
      });
      const prompt = JSON.parse(requestBody.messages[1].content);
      expect(prompt).toMatchObject({
        outputContractVersion: 'normalized-output-v4',
        immutableValues: {
          schemaVersion: '1.0.0',
          source: {
            system: 'synthetic_local_test',
            nativeId: fixtureId,
            transcriptSha256,
            acquisitionMode: 'direct_vtt',
          },
          processing: {
            runtime: 'cloudflare',
            pipelineVersion: 'synthetic-1',
            promptVersion: 'synthetic-prompt-1',
            model: 'synthetic-model',
            deployment: 'synthetic-deployment',
          },
        },
        requiredOutputShape: {
          publicationIntent: {
            transcript: 'boolean',
            legacyCloudflareSync: 'boolean',
          },
          actualPublication: {
            transcript: 'boolean',
            legacyCloudflareSync: 'boolean',
          },
        },
        responseRules: expect.arrayContaining([
          expect.stringContaining('completed decision only where the transcript explicitly states that decision or outcome'),
        ]),
      });
      return new Response(JSON.stringify({
        model: 'synthetic-model',
        choices: [{ message: { content: JSON.stringify(cloudflareModelOutput) } }],
        usage: { prompt_tokens: 12, completion_tokens: 6 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchStub);

    const env = {
      ENVIRONMENT: 'test',
      SHADOW_MODE: 'fixture_parity',
      AZURE_OPENAI_ENDPOINT: 'https://synthetic.invalid/openai/v1',
      AZURE_OPENAI_DEPLOYMENT: 'synthetic-deployment',
      AZURE_OPENAI_API_KEY: 'synthetic-api-key',
      SHADOW_SUBMISSION_TOKEN: 'synthetic-submission-token',
      SHADOW_REVIEWER_TOKEN: 'synthetic-review-token',
      SHADOW_DB: d1,
      SHADOW_ARTIFACTS: r2,
      FIXTURE_JOBS: { send: async (job: FixtureJob) => { queuedJobs.push(job); } },
    } as unknown as Cloudflare.StagingEnv & {
      AZURE_OPENAI_API_KEY: string;
      SHADOW_SUBMISSION_TOKEN: string;
      SHADOW_REVIEWER_TOKEN: string;
    };

    try {
      // A completed execution under the preceding runtime remains immutable.
      // The current runtime version must reserve a distinct run for the same
      // manifest rather than overwrite this record or its R2 artifacts.
      await d1.prepare(
        'INSERT INTO fixture_runs (run_id, fixture_id, manifest_key, manifest_sha256, state, runtime_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        '11111111-1111-4111-8111-111111111111', fixtureId, manifestKey, await sha256(manifestText),
        'completed', '1.0.0', '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z',
      ).run();

      const submission = await worker.fetch(new Request('https://worker.local/v1/fixture-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-submission-token' },
        body: JSON.stringify({ manifestKey }),
      }), env);
      expect(submission.status).toBe(202);
      const submissionBody = await submission.json() as { runId: string; state: string; replayed: boolean };
      expect(submissionBody).toMatchObject({ state: 'queued', replayed: false });
      expect(queuedJobs).toHaveLength(1);

      const rejectedSubmission = await worker.fetch(new Request('https://worker.local/v1/fixture-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ manifestKey }),
      }), env);
      expect(rejectedSubmission.status).toBe(401);

      // Preserve a prior-contract, schema-invalid checkpoint as immutable audit
      // evidence. The versioned checkpoint lookup must not reuse it.
      r2.objects.set(`runs/${submissionBody.runId}/model-response-checkpoint.json`, JSON.stringify({
        responseText: JSON.stringify({ request: 'old invalid contract response' }),
        provider: 'azure_openai',
        model: 'synthetic-model',
        deployment: 'synthetic-deployment',
        requestSha256: 'a'.repeat(64),
        responseSha256: await sha256(JSON.stringify({ request: 'old invalid contract response' })),
      }));

      // Model a failed attempt followed by a recovery submission racing the
      // delayed original Queue delivery. Whichever caller wins the conditional
      // D1 transition owns processing; the other no-ops/replays.
      await d1.prepare("UPDATE fixture_runs SET state = 'failed' WHERE run_id = ?")
        .bind(submissionBody.runId).run();
      r2.failNextPutFor = `runs/${submissionBody.runId}/cloudflare-normalized-output.json`;
      const delayedDelivery = { body: queuedJobs[0], ack: vi.fn(), retry: vi.fn() };
      const recovery = worker.fetch(new Request('https://worker.local/v1/fixture-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-submission-token' },
        body: JSON.stringify({ manifestKey }),
      }), env);
      await Promise.all([
        recovery,
        worker.queue({ messages: [delayedDelivery] } as unknown as MessageBatch<FixtureJob>, env),
      ]);
      expect([200, 202]).toContain((await recovery).status);
      expect(delayedDelivery.ack.mock.calls.length + delayedDelivery.retry.mock.calls.length).toBe(1);
      expect(fetchStub).toHaveBeenCalledTimes(1);

      // Any recovered queue job and the retry after the synthetic R2 failure
      // reuse the persisted model result rather than call the adapter again.
      for (const job of queuedJobs) {
        const delivery = { body: job, ack: vi.fn(), retry: vi.fn() };
        await worker.queue({ messages: [delivery] } as unknown as MessageBatch<FixtureJob>, env);
      }
      expect(fetchStub).toHaveBeenCalledTimes(1);

      const run = await d1.prepare('SELECT state, comparison_status, runtime_version FROM fixture_runs WHERE run_id = ?')
        .bind(submissionBody.runId).first<{ state: string; comparison_status: string; runtime_version: string }>();
      expect(run).toEqual({ state: 'completed', comparison_status: 'pass', runtime_version: '1.0.3' });
      expect(submissionBody.runId).not.toBe('11111111-1111-4111-8111-111111111111');
      expect(await d1.prepare('SELECT state, runtime_version FROM fixture_runs WHERE run_id = ?')
        .bind('11111111-1111-4111-8111-111111111111').first<{ state: string; runtime_version: string }>())
        .toEqual({ state: 'completed', runtime_version: '1.0.0' });
      expect(r2.objects.get(`runs/${submissionBody.runId}/model-response-checkpoint.json`)).toContain('old invalid contract response');
      expect(r2.objects.get(`runs/${submissionBody.runId}/model-response-checkpoints/normalized-output-v4.json`)).toContain('"outputContractVersion":"normalized-output-v4"');
      expect(r2.objects.get(`runs/${submissionBody.runId}/cloudflare-normalized-output.json`)).toBe(JSON.stringify(cloudflareOutput));
      expect(r2.objects.get(`runs/${submissionBody.runId}/cloudflare-publication-intent.json`)).toBe(JSON.stringify(publicationIntent));
      expect(r2.objects.get(`runs/${submissionBody.runId}/cloudflare-actual-publication.json`)).toContain('"transcript":false');
      expect(r2.objects.get(`runs/${submissionBody.runId}/comparison.json`)).toContain('"status":"pass"');
      expect(r2.objects.get(`runs/${submissionBody.runId}/comparison.md`)).toContain('EIP Runtime Shadow Comparison Report');

      const delayedDuplicate = { body: queuedJobs[0], ack: vi.fn(), retry: vi.fn() };
      await worker.queue({ messages: [delayedDuplicate] } as unknown as MessageBatch<FixtureJob>, env);
      expect(delayedDuplicate.ack).toHaveBeenCalledOnce();
      expect(delayedDuplicate.retry).not.toHaveBeenCalled();
      expect(fetchStub).toHaveBeenCalledTimes(1);
    } finally {
      d1.close();
    }
  });
});
