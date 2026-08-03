import { AzureOpenAiAdapter } from './azure-openai';
import { compareNormalizedOutputs } from './comparison';
import { renderComparisonReport } from './comparison-report';
import {
  type FixtureJob,
  type FixtureManifest,
} from './contracts';
import {
  isFixtureManifest,
  isNormalizedOutput,
  isPublicationIntent,
  isSafeObjectKey,
  stableJson,
} from './fixture-validation';
import {
  CLAIM_FIXTURE_RUN_PROCESSING_SQL,
  didClaimFixtureRunProcessing,
  fixtureRunRequestAction,
  MARK_QUEUE_SUBMISSION_FAILED_SQL,
  RECOVER_FIXTURE_RUN_SQL,
} from './fixture-run-lifecycle';
import { hasMatchingReviewerToken, validateReviewerDisposition } from './reviewer-disposition';

const RUNTIME_VERSION = '1.0.0';

type RuntimeEnv = Cloudflare.StagingEnv & {
  /** Set only with `wrangler secret put AZURE_OPENAI_API_KEY --env staging`. */
  AZURE_OPENAI_API_KEY: string;
  /** Set only with `wrangler secret put SHADOW_SUBMISSION_TOKEN --env staging`. */
  SHADOW_SUBMISSION_TOKEN: string;
  /** Set only with `wrangler secret put SHADOW_REVIEWER_TOKEN --env staging`. */
  SHADOW_REVIEWER_TOKEN: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

async function sha256(value: ArrayBuffer | string): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}


async function loadFixture(env: RuntimeEnv, key: string): Promise<{ manifest: FixtureManifest; manifestSha256: string }> {
  const object = await env.SHADOW_ARTIFACTS.get(key);
  if (!object) throw new Error('Fixture manifest does not exist');
  const text = await object.text();
  const parsed = JSON.parse(text) as unknown;
  if (!isFixtureManifest(parsed)) throw new Error('Fixture manifest does not satisfy schema version 1.0.0');
  if (Date.parse(parsed.expiresAt) <= Date.now()) throw new Error('Fixture manifest has expired');
  return { manifest: parsed, manifestSha256: await sha256(text) };
}

function hasUsableAzureOpenAiConfiguration(env: RuntimeEnv): boolean {
  return env.AZURE_OPENAI_ENDPOINT.length > 0
    && env.AZURE_OPENAI_DEPLOYMENT.length > 0
    && env.AZURE_OPENAI_API_KEY.length > 0;
}

function outputPrompt(manifest: FixtureManifest, transcript: string): string {
  return JSON.stringify({
    task: 'Return only a normalized EIP output JSON object matching schema version 1.0.0.',
    constraints: [
      'Do not publish, call external systems, include URLs, or include credentials.',
      'Use evidence only from the supplied transcript.',
      'Use null rather than inventing a controlled value.',
      'Preserve source transcript SHA-256 and acquisition mode exactly.',
    ],
    source: {
      system: manifest.source.system,
      nativeId: manifest.source.nativeId,
      transcriptSha256: manifest.transcript.sha256,
      acquisitionMode: manifest.acquisitionMode,
    },
    transcript,
  });
}

interface ModelResponseCheckpoint {
  responseText: string;
  provider: 'azure_openai' | 'workers_ai';
  model: string;
  deployment: string;
  requestSha256: string;
  responseSha256: string;
}

async function loadOrCreateModelResponseCheckpoint(
  job: FixtureJob,
  manifest: FixtureManifest,
  transcript: string,
  env: RuntimeEnv,
): Promise<ModelResponseCheckpoint> {
  const checkpointKey = `runs/${job.runId}/model-response-checkpoint.json`;
  const checkpointObject = await env.SHADOW_ARTIFACTS.get(checkpointKey);
  if (checkpointObject) {
    const checkpoint = JSON.parse(await checkpointObject.text()) as ModelResponseCheckpoint;
    if (typeof checkpoint.responseText !== 'string'
      || typeof checkpoint.provider !== 'string'
      || typeof checkpoint.model !== 'string'
      || typeof checkpoint.deployment !== 'string'
      || typeof checkpoint.requestSha256 !== 'string'
      || typeof checkpoint.responseSha256 !== 'string') {
      throw new Error('Model response checkpoint is invalid');
    }
    if (await sha256(checkpoint.responseText) !== checkpoint.responseSha256) {
      throw new Error('Model response checkpoint hash mismatch');
    }
    return checkpoint;
  }

  if (!hasUsableAzureOpenAiConfiguration(env)) throw new Error('Azure OpenAI staging configuration is incomplete');
  const adapter = new AzureOpenAiAdapter({
    endpoint: env.AZURE_OPENAI_ENDPOINT,
    deployment: env.AZURE_OPENAI_DEPLOYMENT,
    apiVersion: env.AZURE_OPENAI_API_VERSION,
    apiKey: env.AZURE_OPENAI_API_KEY,
  });
  const llm = await adapter.invoke({
    correlationId: job.runId,
    systemPrompt: 'You are an evidence-bound EIP normalization engine.',
    userContent: outputPrompt(manifest, transcript),
    maxTokens: 16000,
    responseFormat: 'json_object',
    promptVersion: manifest.processing.promptVersion,
  });
  const checkpoint: ModelResponseCheckpoint = {
    responseText: llm.responseText,
    provider: llm.provider,
    model: llm.model,
    deployment: llm.deployment,
    requestSha256: llm.requestSha256,
    responseSha256: llm.responseSha256,
  };
  await env.SHADOW_ARTIFACTS.put(checkpointKey, JSON.stringify(checkpoint), {
    httpMetadata: { contentType: 'application/json' },
  });
  return checkpoint;
}

async function processJob(job: FixtureJob, env: RuntimeEnv): Promise<void> {
  if (!isSafeObjectKey(job.manifestKey, 'fixtures/')) throw new Error('Queue job references an invalid fixture key');
  const { manifest, manifestSha256 } = await loadFixture(env, job.manifestKey);
  if (manifest.fixtureId !== job.fixtureId || manifestSha256 !== job.manifestSha256) throw new Error('Queue job does not match immutable fixture manifest');

  // Claim only a queued reservation. The conditional transition is the
  // concurrency boundary between a recovered job and any delayed queue retry.
  const claim = await env.SHADOW_DB.prepare(CLAIM_FIXTURE_RUN_PROCESSING_SQL)
    .bind(new Date().toISOString(), job.runId, manifest.fixtureId, manifestSha256, RUNTIME_VERSION).run();
  if (!didClaimFixtureRunProcessing(claim.meta.changes)) {
    log('fixture_run_unclaimed', { fixtureId: manifest.fixtureId, runId: job.runId });
    return;
  }

  try {
    if (!isSafeObjectKey(manifest.transcript.key, 'fixtures/')
      || !isSafeObjectKey(manifest.azureBaseline.normalizedOutput.key, 'fixtures/')
      || !isSafeObjectKey(manifest.azureBaseline.publicationIntent.key, 'fixtures/')) {
      throw new Error('Fixture manifest references an invalid object key');
    }
    const transcriptObject = await env.SHADOW_ARTIFACTS.get(manifest.transcript.key);
    if (!transcriptObject) throw new Error('Fixture transcript does not exist');
    const transcript = await transcriptObject.text();
    if (await sha256(transcript) !== manifest.transcript.sha256) throw new Error('Fixture transcript hash mismatch');

    // Persist the model response before comparison artifacts and D1 completion.
    // A retry after a downstream persistence failure reuses this checkpoint and
    // does not invoke the model again.
    const llm = await loadOrCreateModelResponseCheckpoint(job, manifest, transcript, env);
    const cloudflareOutput = JSON.parse(llm.responseText) as unknown;
    if (!isNormalizedOutput(cloudflareOutput)) throw new Error('Cloudflare LLM output does not satisfy normalized output schema');
    if (cloudflareOutput.source.transcriptSha256 !== manifest.transcript.sha256) throw new Error('Cloudflare output transcript hash mismatch');

    const baselineObject = await env.SHADOW_ARTIFACTS.get(manifest.azureBaseline.normalizedOutput.key);
    if (!baselineObject) throw new Error('Azure normalized baseline does not exist');
    const baselineText = await baselineObject.text();
    if (await sha256(baselineText) !== manifest.azureBaseline.normalizedOutput.sha256) throw new Error('Azure normalized baseline hash mismatch');
    const azureOutput = JSON.parse(baselineText) as unknown;
    if (!isNormalizedOutput(azureOutput)) throw new Error('Azure baseline does not satisfy normalized output schema');

    const publicationIntentObject = await env.SHADOW_ARTIFACTS.get(manifest.azureBaseline.publicationIntent.key);
    if (!publicationIntentObject) throw new Error('Azure publication-intent baseline does not exist');
    const publicationIntentText = await publicationIntentObject.text();
    if (await sha256(publicationIntentText) !== manifest.azureBaseline.publicationIntent.sha256) throw new Error('Azure publication-intent baseline hash mismatch');
    const azurePublicationIntent = JSON.parse(publicationIntentText) as unknown;
    if (!isPublicationIntent(azurePublicationIntent)) throw new Error('Azure publication-intent baseline does not satisfy schema');
    if (!isPublicationIntent(azureOutput.publicationIntent) || stableJson(azurePublicationIntent) !== stableJson(azureOutput.publicationIntent)) {
      throw new Error('Azure normalized baseline and publication-intent baseline differ');
    }

    const comparison = compareNormalizedOutputs(manifest.fixtureId, manifestSha256, job.runId, azureOutput, cloudflareOutput);
    await env.SHADOW_ARTIFACTS.put(`runs/${job.runId}/cloudflare-normalized-output.json`, JSON.stringify(cloudflareOutput), { httpMetadata: { contentType: 'application/json' } });
    await env.SHADOW_ARTIFACTS.put(`runs/${job.runId}/cloudflare-publication-intent.json`, JSON.stringify(cloudflareOutput.publicationIntent), { httpMetadata: { contentType: 'application/json' } });
    await env.SHADOW_ARTIFACTS.put(`runs/${job.runId}/comparison.json`, JSON.stringify(comparison), { httpMetadata: { contentType: 'application/json' } });
    await env.SHADOW_ARTIFACTS.put(`runs/${job.runId}/comparison.md`, renderComparisonReport(comparison), { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } });
    await env.SHADOW_DB.prepare(
      'UPDATE fixture_runs SET state = ?, adapter_provider = ?, model = ?, deployment = ?, request_sha256 = ?, response_sha256 = ?, comparison_status = ?, blocking_count = ?, material_count = ?, updated_at = ? WHERE run_id = ?',
    ).bind('completed', llm.provider, llm.model, llm.deployment, llm.requestSha256, llm.responseSha256, comparison.status, comparison.counts.blocking, comparison.counts.material, new Date().toISOString(), job.runId).run();
    log('fixture_run_completed', { fixtureId: manifest.fixtureId, runId: job.runId, status: comparison.status, counts: comparison.counts });
  } catch (error) {
    const errorClass = error instanceof Error ? error.message.slice(0, 120) : 'unknown_error';
    await env.SHADOW_DB.prepare('UPDATE fixture_runs SET state = ?, error_class = ?, updated_at = ? WHERE run_id = ?')
      .bind('failed', errorClass, new Date().toISOString(), job.runId).run();
    log('fixture_run_failed', { fixtureId: manifest.fixtureId, runId: job.runId, errorClass });
    throw error;
  }
}

export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, mode: env.SHADOW_MODE });

    const dispositionMatch = url.pathname.match(/^\/v1\/fixture-runs\/([0-9a-f-]{36})\/dispositions$/i);
    if (request.method === 'POST' && dispositionMatch) {
      if (!await hasMatchingReviewerToken(request, env.SHADOW_REVIEWER_TOKEN)) return json({ error: 'Unauthorized' }, 401);
      try {
        const runId = dispositionMatch[1];
        const run = await env.SHADOW_DB.prepare('SELECT state FROM fixture_runs WHERE run_id = ?')
          .bind(runId).first<{ state: string }>();
        if (!run) return json({ error: 'Fixture run does not exist' }, 404);
        if (run.state !== 'completed') return json({ error: 'Reviewer disposition requires a completed fixture run' }, 409);

        const comparisonObject = await env.SHADOW_ARTIFACTS.get(`runs/${runId}/comparison.json`);
        if (!comparisonObject) return json({ error: 'Comparison artifact does not exist' }, 409);
        const comparison = JSON.parse(await comparisonObject.text()) as { differences?: unknown };
        if (!Array.isArray(comparison.differences)) return json({ error: 'Comparison artifact is invalid' }, 409);

        const body = await request.json() as { path?: unknown; disposition?: unknown; reviewerId?: unknown; note?: unknown };
        const disposition = validateReviewerDisposition(body, comparison.differences as Parameters<typeof validateReviewerDisposition>[1]);
        if (!disposition) return json({ error: 'A disposition must target an existing material difference with valid reviewer details' }, 400);

        await env.SHADOW_DB.prepare(
          'INSERT INTO comparison_dispositions (run_id, path, disposition, reviewer_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(runId, disposition.path, disposition.disposition, disposition.reviewerId, disposition.note, new Date().toISOString()).run();
        log('comparison_disposition_recorded', { runId, path: disposition.path, disposition: disposition.disposition });
        return json({ runId, path: disposition.path, disposition: disposition.disposition }, 201);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid reviewer disposition request';
        return json({ error: message }, 400);
      }
    }

    if (request.method !== 'POST' || url.pathname !== '/v1/fixture-runs') return json({ error: 'Not found' }, 404);
    if (!await hasMatchingReviewerToken(request, env.SHADOW_SUBMISSION_TOKEN)) return json({ error: 'Unauthorized' }, 401);
    try {
      const body = await request.json() as { manifestKey?: string };
      if (!body.manifestKey || !isSafeObjectKey(body.manifestKey, 'fixtures/')) return json({ error: 'manifestKey must be a safe key under fixtures/' }, 400);
      const { manifest, manifestSha256 } = await loadFixture(env, body.manifestKey);
      const existing = await env.SHADOW_DB.prepare(
        'SELECT run_id, state FROM fixture_runs WHERE fixture_id = ? AND manifest_sha256 = ? AND runtime_version = ?',
      ).bind(manifest.fixtureId, manifestSha256, RUNTIME_VERSION).first<{ run_id: string; state: string }>();
      const action = fixtureRunRequestAction(existing?.state);
      if (action === 'replay' && existing) return json({ runId: existing.run_id, state: existing.state, replayed: true });

      const now = new Date().toISOString();
      const job: FixtureJob = action === 'recover' && existing
        ? { fixtureId: manifest.fixtureId, manifestKey: body.manifestKey, manifestSha256, runId: existing.run_id }
        : { fixtureId: manifest.fixtureId, manifestKey: body.manifestKey, manifestSha256, runId: crypto.randomUUID() };
      if (action === 'recover') {
        // Do not overwrite a concurrent Queue retry that already claimed this
        // failed reservation. Only the caller that performs this transition
        // owns the recovered queue submission.
        const recovery = await env.SHADOW_DB.prepare(RECOVER_FIXTURE_RUN_SQL)
          .bind(now, job.runId).run();
        if (!didClaimFixtureRunProcessing(recovery.meta.changes)) {
          const replay = await env.SHADOW_DB.prepare(
            'SELECT run_id, state FROM fixture_runs WHERE fixture_id = ? AND manifest_sha256 = ? AND runtime_version = ?',
          ).bind(manifest.fixtureId, manifestSha256, RUNTIME_VERSION).first<{ run_id: string; state: string }>();
          if (replay) return json({ runId: replay.run_id, state: replay.state, replayed: true });
          throw new Error('Unable to recover fixture run');
        }
      } else {
        try {
          await env.SHADOW_DB.prepare(
            'INSERT INTO fixture_runs (run_id, fixture_id, manifest_key, manifest_sha256, state, runtime_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          ).bind(job.runId, manifest.fixtureId, job.manifestKey, manifestSha256, 'queued', RUNTIME_VERSION, now, now).run();
        } catch {
          const replay = await env.SHADOW_DB.prepare(
            'SELECT run_id, state FROM fixture_runs WHERE fixture_id = ? AND manifest_sha256 = ? AND runtime_version = ?',
          ).bind(manifest.fixtureId, manifestSha256, RUNTIME_VERSION).first<{ run_id: string; state: string }>();
          if (replay) return json({ runId: replay.run_id, state: replay.state, replayed: true });
          throw new Error('Unable to reserve fixture run');
        }
      }
      try {
        await env.FIXTURE_JOBS.send(job);
      } catch {
        await env.SHADOW_DB.prepare(MARK_QUEUE_SUBMISSION_FAILED_SQL)
          .bind('queue_submission_failed', new Date().toISOString(), job.runId).run();
        throw new Error('Unable to queue fixture run');
      }
      return json({ runId: job.runId, state: 'queued', replayed: false, recovered: action === 'recover' }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request';
      return json({ error: message }, 400);
    }
  },

  async queue(batch: MessageBatch<FixtureJob>, env: RuntimeEnv): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processJob(message.body, env);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
};
