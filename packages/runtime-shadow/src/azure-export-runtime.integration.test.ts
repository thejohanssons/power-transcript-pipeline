import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AzureExportJob, AzureExportPackageManifest, ContinuousNormalizedOutput } from './contracts';
import { CONTINUOUS_RUNTIME_VERSION, processAzureExportJob } from './azure-export-runtime';

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class LocalD1 {
  readonly database = new DatabaseSync(':memory:');

  constructor() {
    this.database.exec(readFileSync(new URL('../migrations/0002_azure_export_runs.sql', import.meta.url), 'utf8'));
  }

  prepare(query: string) {
    return {
      bind: (...values: SQLInputValue[]) => ({
        run: async () => {
          const result = this.database.prepare(query).run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
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

afterEach(() => vi.unstubAllGlobals());

describe('continuous Azure-export runtime', () => {
  it('reads only authenticated referenced artifacts and reuses a verified model checkpoint after downstream persistence failure', async () => {
    const artifacts = {
      transcript: '---\nSOURCE: synthetic\n---\nWEBVTT\n\n00:00.000 --> 00:02.000\nSynthetic decision: approve the test budget.\n',
      summary: '---\nSOURCE: synthetic\n---\nDecision: Approved the test budget.\n',
      people: '---\nSOURCE: synthetic\n---\nPERSON: Test Owner\n',
      topic: '- **TOPIC:** Test budget\nDecision: Approved\n',
    };
    const reference = async (kind: 'transcript' | 'summary' | 'people' | 'topic_record', key: string, value: string) => ({
      kind,
      key,
      sha256: await sha256(value),
      bytes: new TextEncoder().encode(value).byteLength,
      contentType: kind === 'transcript' ? 'text/vtt' : kind === 'topic_record' ? 'text/markdown' : 'text/plain',
    });
    const manifest: AzureExportPackageManifest = {
      schemaVersion: '1.0.0',
      packageId: 'azure-export-local-test',
      source: { system: 'synthetic_local_test', nativeId: 'synthetic-meeting-1' },
      processing: {
        azurePipelineVersion: 'synthetic-1',
        promptVersion: 'synthetic-prompt-1',
        model: 'synthetic-model',
        deployment: 'synthetic-deployment',
        configuration: [{ name: 'taxonomy', version: '1', sha256: 'a'.repeat(64) }],
      },
      artifacts: {
        transcript: await reference('transcript', 'transcripts/2026-08/synthetic.vtt', artifacts.transcript),
        summary: await reference('summary', 'summaries/2026-08/synthetic.txt', artifacts.summary),
        people: await reference('people', 'people/2026-08/synthetic.txt', artifacts.people),
        topicRecords: [await reference('topic_record', 'topic-records/2026-08/synthetic/topic.md', artifacts.topic)],
      },
    };
    const manifestText = JSON.stringify(manifest);
    const manifestSha256 = await sha256(manifestText);
    const runId = '00000000-0000-4000-8000-000000000001';
    const job: AzureExportJob = {
      packageId: manifest.packageId,
      manifestKey: `azure-export-manifests/${manifest.packageId}.json`,
      manifestSha256,
      runId,
    };
    const cloudflareOutput: ContinuousNormalizedOutput = {
      schemaVersion: '1.0.0',
      source: { system: manifest.source.system, nativeId: manifest.source.nativeId, transcriptSha256: manifest.artifacts.transcript.sha256 },
      processing: {
        runtime: 'cloudflare', pipelineVersion: 'synthetic-1', promptVersion: 'synthetic-prompt-1',
        model: 'synthetic-model', deployment: 'synthetic-deployment', configurationHashes: { taxonomy: 'a'.repeat(64) },
      },
      classification: { mode: null, confidence: null },
      summaryAssertions: [{ id: 'summary-1', text: 'Approved the test budget.' }],
      topics: [{
        topicId: null, topic: 'Test budget', domain: null, category: null, contextType: null, summary: null,
        keyFacts: [], decisions: [], actions: [], risks: [], owners: [], confidence: null,
        validation: { status: 'warning', reasons: [] },
      }],
      people: [{
        canonicalName: 'Test Owner', sourceName: 'Test Owner', attendance: null, contributions: [], actions: [],
        decisionsOwned: [], risksRaised: [], topicIds: [], stance: null, unresolved: false,
      }],
      validation: { status: 'pass', reasons: [] },
    };
    const d1 = new LocalD1();
    const r2 = new LocalR2();
    r2.objects.set(job.manifestKey, manifestText);
    await d1.prepare('INSERT INTO azure_export_runs (run_id, package_id, manifest_key, manifest_sha256, state, runtime_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(runId, manifest.packageId, job.manifestKey, manifestSha256, 'queued', CONTINUOUS_RUNTIME_VERSION, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z').run();
    const artifactBodies = new Map([
      [manifest.artifacts.transcript.key, artifacts.transcript],
      [manifest.artifacts.summary.key, artifacts.summary],
      [manifest.artifacts.people.key, artifacts.people],
      [manifest.artifacts.topicRecords[0].key, artifacts.topic],
    ]);
    const fetchStub = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://reader.local/internal/runtime-shadow/azure-artifacts/')) {
        expect(init?.headers).toEqual({ authorization: 'Bearer reader-token' });
        const key = decodeURIComponent(url.slice('https://reader.local/internal/runtime-shadow/azure-artifacts/'.length));
        return new Response(artifactBodies.get(key), { status: artifactBodies.has(key) ? 200 : 404 });
      }
      expect(url).toBe('https://openai.local/openai/deployments/synthetic-deployment/chat/completions?api-version=2024-02-15-preview');
      return new Response(JSON.stringify({
        model: 'synthetic-model',
        choices: [{ message: { content: JSON.stringify(cloudflareOutput) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchStub);
    const env = {
      SHADOW_DB: d1,
      SHADOW_ARTIFACTS: r2,
      AZURE_ARTIFACT_READER_URL: 'https://reader.local/internal/runtime-shadow/azure-artifacts/',
      SHADOW_ARTIFACT_READ_TOKEN: 'reader-token',
      AZURE_OPENAI_ENDPOINT: 'https://openai.local/openai/v1',
      AZURE_OPENAI_DEPLOYMENT: 'synthetic-deployment',
      AZURE_OPENAI_API_KEY: 'synthetic-api-key',
    } as unknown as Parameters<typeof processAzureExportJob>[1];

    try {
      r2.failNextPutFor = `runs/${runId}/continuous/azure-normalized-output.json`;
      await expect(processAzureExportJob(job, env)).rejects.toThrow('Synthetic local R2 failure');
      expect(fetchStub).toHaveBeenCalledTimes(5);
      expect(r2.objects.get(`runs/${runId}/continuous/model-response-checkpoints/continuous-normalized-output-v1.json`)).toContain('synthetic-model');

      await d1.prepare("UPDATE azure_export_runs SET state = 'queued' WHERE run_id = ?").bind(runId).run();
      await processAzureExportJob(job, env);
      expect(fetchStub).toHaveBeenCalledTimes(9);
      expect(r2.objects.get(`runs/${runId}/continuous/comparison.json`)).toContain('"status":"pass"');
    } finally {
      d1.close();
    }
  });
});
