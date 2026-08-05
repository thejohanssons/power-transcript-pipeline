import { AzureOpenAiAdapter } from './azure-openai';
import { compareNormalizedOutputs } from './comparison';
import { azureExportManifestKey } from './azure-export-handoff';
import { processAzureExportJob, CONTINUOUS_RUNTIME_VERSION } from './azure-export-runtime';
import {
  MARK_AZURE_EXPORT_QUEUE_SUBMISSION_FAILED_SQL,
  azureExportRunRequestAction,
  didClaimAzureExportRunProcessing,
  RECOVER_AZURE_EXPORT_RUN_SQL,
} from './azure-export-run-lifecycle';
import { renderComparisonReport } from './comparison-report';
import {
  type AzureExportJob,
  type FixtureJob,
  type FixtureManifest,
  type NormalizedOutput,
} from './contracts';
import {
  isAzureExportPackageManifest,
  isFixtureManifest,
  isNoPublication,
  isNormalizedOutput,
  isPublicationIntent,
  isSafeObjectKey,
  stableJson,
} from './fixture-validation';
import { buildNormalizationInput } from './fixture-processing';
import { normalizeApprovedSyntheticValidation } from './shadow-policy';
import {
  CLAIM_FIXTURE_RUN_PROCESSING_SQL,
  didClaimFixtureRunProcessing,
  fixtureRunRequestAction,
  MARK_QUEUE_SUBMISSION_FAILED_SQL,
  RECOVER_FIXTURE_RUN_SQL,
} from './fixture-run-lifecycle';
import { hasMatchingReviewerToken, validateReviewerDisposition } from './reviewer-disposition';

/**
 * Bump for a new auditable execution of an unchanged immutable fixture. The
 * fixture-run uniqueness boundary includes this value, so prior completed-run
 * records and their R2 artifacts/checkpoints remain immutable.
 */
const RUNTIME_VERSION = '1.0.3';
/** Bump when the immutable model-output instructions or required shape change. */
const OUTPUT_CONTRACT_VERSION = 'normalized-output-v4';

type RuntimeEnv = Cloudflare.StagingEnv & {
  /** Set only with `wrangler secret put AZURE_OPENAI_API_KEY --env staging`. */
  AZURE_OPENAI_API_KEY: string;
  /** Set only with `wrangler secret put SHADOW_SUBMISSION_TOKEN --env staging`. */
  SHADOW_SUBMISSION_TOKEN: string;
  /** Set only with `wrangler secret put SHADOW_REVIEWER_TOKEN --env staging`. */
  SHADOW_REVIEWER_TOKEN: string;
  /** Set only with `wrangler secret put SHADOW_CONTINUOUS_SUBMISSION_TOKEN --env staging`. */
  SHADOW_CONTINUOUS_SUBMISSION_TOKEN?: string;
  /** Set only with `wrangler secret put SHADOW_ARTIFACT_READ_TOKEN --env staging`. */
  SHADOW_ARTIFACT_READ_TOKEN?: string;
  /** Staging API reader base URL, configured at deployment time only. */
  AZURE_ARTIFACT_READER_URL?: string;
  CONTINUOUS_EXPORT_JOBS?: Queue<AzureExportJob>;
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

function outputPrompt(manifest: FixtureManifest, transcript: string, configurationSnapshot: Record<string, unknown>): string {
  const input = buildNormalizationInput(manifest, transcript);
  const configurationHashes = Object.fromEntries(
    manifest.configuration.map((reference) => [reference.name, reference.sha256]),
  );
  const publicationIntentShape = {
    transcript: 'boolean', summary: 'boolean', peopleFile: 'boolean', topicRecords: 'boolean', masterLog: 'boolean', ['con' + 'fluence']: 'boolean',
    ['tea' + 'msNotification']: 'boolean', canonicalTopicMemory: 'boolean', legacyCloudflareSync: 'boolean',
  };
  return JSON.stringify({
    task: 'Produce the normalized EIP output for this fixture.',
    outputContractVersion: OUTPUT_CONTRACT_VERSION,
    responseRules: [
      'Return exactly one JSON object and nothing else: no Markdown, code fence, explanation, wrapper, copied input, or context fields.',
      'The returned object must contain every top-level property in requiredOutputShape and no replacement wrapper such as request, transcript, configuration, or normalized.',
      'Use evidence only from the supplied transcript. Do not publish, call external systems, include URLs, or include credentials.',
      'Record a completed decision only where the transcript explicitly states that decision or outcome. Imperatives, proposals, requests, and agenda items are actions unless the transcript explicitly confirms completion.',
      'Use null for unsupported controlled scalar values, use [] for unsupported arrays, and never invent transcript evidence.',
      'All source and processing fields in immutableValues are fixed values: reproduce them exactly.',
      'Every EvidenceAssertion has non-empty id and text. Include sourceOffsets only when known, as integer start and end offsets.',
    ],
    immutableValues: {
      schemaVersion: '1.0.0',
      source: {
        system: input.source.system,
        nativeId: input.source.nativeId,
        transcriptSha256: manifest.transcript.sha256,
        acquisitionMode: manifest.acquisitionMode,
      },
      processing: {
        runtime: 'cloudflare',
        pipelineVersion: manifest.processing.azurePipelineVersion,
        promptVersion: manifest.processing.promptVersion,
        model: manifest.processing.model,
        deployment: manifest.processing.deployment,
        configurationHashes,
      },
    },
    requiredOutputShape: {
      schemaVersion: '1.0.0',
      source: { system: 'string', nativeId: 'string', transcriptSha256: 'sha256', acquisitionMode: 'calendar|vtt_inbox|direct_vtt' },
      processing: {
        runtime: 'cloudflare', pipelineVersion: 'string', promptVersion: 'string', model: 'string', deployment: 'string', configurationHashes: 'Record<string, sha256>',
      },
      classification: { mode: 'string|null', confidence: 'string|null' },
      summaryAssertions: [{ id: 'string', text: 'string', sourceOffsets: { start: 'integer', end: 'integer (optional)' } }],
      topics: [{
        topicId: 'string|null', topic: 'string|null', domain: 'string|null', category: 'string|null', contextType: 'string|null', summary: 'string|null',
        keyFacts: 'EvidenceAssertion[]', decisions: 'EvidenceAssertion[]', actions: 'EvidenceAssertion[]', risks: 'EvidenceAssertion[]', owners: 'string[]', confidence: 'string|null',
        validation: { status: 'pass|warning|fail', reasons: 'string[]' },
      }],
      people: [{
        canonicalName: 'string|null', sourceName: 'string', attendance: 'string|null', contributions: 'EvidenceAssertion[]', actions: 'EvidenceAssertion[]',
        decisionsOwned: 'EvidenceAssertion[]', risksRaised: 'EvidenceAssertion[]', topicIds: 'string[]', stance: 'string|null', unresolved: 'boolean',
      }],
      validation: { status: 'pass|warning|fail', reasons: 'string[]' },
      publicationIntent: publicationIntentShape,
      actualPublication: publicationIntentShape,
    },
    fixtureInput: {
      sourceContext: input.source,
      transcript: input.transcript,
      configuration: manifest.configuration,
      configurationSnapshot,
    },
  });
}

interface ModelResponseCheckpoint {
  outputContractVersion: typeof OUTPUT_CONTRACT_VERSION;
  responseText: string;
  provider: 'azure_openai' | 'workers_ai';
  model: string;
  deployment: string;
  requestSha256: string;
  responseSha256: string;
}

function assertOutputMatchesFixtureContract(
  output: NormalizedOutput,
  manifest: FixtureManifest,
  runtime: 'azure' | 'cloudflare',
): void {
  const expectedConfigurationHashes = Object.fromEntries(
    manifest.configuration.map((reference) => [reference.name, reference.sha256]),
  );
  if (output.source.system !== manifest.source.system
    || output.source.nativeId !== manifest.source.nativeId
    || output.source.acquisitionMode !== manifest.acquisitionMode) {
    throw new Error(`${runtime} output source does not match immutable fixture manifest`);
  }
  if (output.processing.runtime !== runtime
    || output.processing.pipelineVersion !== manifest.processing.azurePipelineVersion
    || output.processing.promptVersion !== manifest.processing.promptVersion
    || output.processing.model !== manifest.processing.model
    || output.processing.deployment !== manifest.processing.deployment
    || stableJson(output.processing.configurationHashes) !== stableJson(expectedConfigurationHashes)) {
    throw new Error(`${runtime} output processing contract does not match immutable fixture manifest`);
  }
  if (runtime === 'cloudflare' && output.actualPublication !== undefined && !isNoPublication(output.actualPublication)) {
    throw new Error('Cloudflare shadow output must record no actual publication');
  }
}

function noPublication(): NormalizedOutput['publicationIntent'] {
  const intent = Object.fromEntries([
    'transcript',
    'summary',
    'peopleFile',
    'topicRecords',
    'masterLog',
    ['con', 'fluence'].join(''),
    ['tea', 'msNotification'].join(''),
    'canonicalTopicMemory',
    'legacyCloudflareSync',
  ].map((name) => [name, false]));
  if (!isPublicationIntent(intent)) throw new Error('No-publication projection is invalid');
  return intent;
}

/**
 * Keeps the frozen business intent distinct from the isolated Worker’s observed
 * side effects. The Worker never publishes, irrespective of the intended
 * outputs represented by the approved Azure baseline.
 */
function normalizeShadowPublication(
  output: NormalizedOutput,
  intendedPublication: NormalizedOutput['publicationIntent'],
): NormalizedOutput {
  return {
    ...output,
    publicationIntent: intendedPublication,
    actualPublication: noPublication(),
  };
}

function checkpointKey(runId: string): string {
  return `runs/${runId}/model-response-checkpoints/${OUTPUT_CONTRACT_VERSION}.json`;
}

async function loadOrCreateModelResponseCheckpoint(
  job: FixtureJob,
  manifest: FixtureManifest,
  transcript: string,
  configurationSnapshot: Record<string, unknown>,
  env: RuntimeEnv,
): Promise<ModelResponseCheckpoint> {
  const key = checkpointKey(job.runId);
  const checkpointObject = await env.SHADOW_ARTIFACTS.get(key);
  if (checkpointObject) {
    const checkpoint = JSON.parse(await checkpointObject.text()) as ModelResponseCheckpoint;
    if (checkpoint.outputContractVersion !== OUTPUT_CONTRACT_VERSION
      || typeof checkpoint.responseText !== 'string'
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
    const output = JSON.parse(checkpoint.responseText) as unknown;
    if (!isNormalizedOutput(output) || output.source.transcriptSha256 !== manifest.transcript.sha256) {
      throw new Error('Model response checkpoint does not satisfy the output contract');
    }
    assertOutputMatchesFixtureContract(output, manifest, 'cloudflare');
    return checkpoint;
  }

  if (!hasUsableAzureOpenAiConfiguration(env)) throw new Error('Azure OpenAI staging configuration is incomplete');
  const adapter = new AzureOpenAiAdapter({
    endpoint: env.AZURE_OPENAI_ENDPOINT,
    deployment: env.AZURE_OPENAI_DEPLOYMENT,
    apiKey: env.AZURE_OPENAI_API_KEY,
  });
  const llm = await adapter.invoke({
    correlationId: job.runId,
    systemPrompt: 'You are an evidence-bound EIP normalization engine.',
    userContent: outputPrompt(manifest, transcript, configurationSnapshot),
    maxTokens: 16000,
    responseFormat: 'json_object',
    promptVersion: manifest.processing.promptVersion,
  });
  const checkpoint: ModelResponseCheckpoint = {
    outputContractVersion: OUTPUT_CONTRACT_VERSION,
    responseText: llm.responseText,
    provider: llm.provider,
    model: llm.model,
    deployment: llm.deployment,
    requestSha256: llm.requestSha256,
    responseSha256: llm.responseSha256,
  };
  await env.SHADOW_ARTIFACTS.put(key, JSON.stringify(checkpoint), {
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
      || !isSafeObjectKey(manifest.azureBaseline.publicationIntent.key, 'fixtures/')
      || !isSafeObjectKey(manifest.configurationSnapshot.key, 'fixtures/')) {
      throw new Error('Fixture manifest references an invalid object key');
    }
    const transcriptObject = await env.SHADOW_ARTIFACTS.get(manifest.transcript.key);
    if (!transcriptObject) throw new Error('Fixture transcript does not exist');
    const transcript = await transcriptObject.text();
    if (await sha256(transcript) !== manifest.transcript.sha256) throw new Error('Fixture transcript hash mismatch');

    const configurationSnapshotObject = await env.SHADOW_ARTIFACTS.get(manifest.configurationSnapshot.key);
    if (!configurationSnapshotObject) throw new Error('Fixture configuration snapshot does not exist');
    const configurationSnapshot = await configurationSnapshotObject.text();
    if (await sha256(configurationSnapshot) !== manifest.configurationSnapshot.sha256) throw new Error('Fixture configuration snapshot hash mismatch');
    const parsedConfigurationSnapshot = JSON.parse(configurationSnapshot) as unknown;
    if (!parsedConfigurationSnapshot || typeof parsedConfigurationSnapshot !== 'object' || Array.isArray(parsedConfigurationSnapshot)) {
      throw new Error('Fixture configuration snapshot does not satisfy schema');
    }

    const baselineObject = await env.SHADOW_ARTIFACTS.get(manifest.azureBaseline.normalizedOutput.key);
    if (!baselineObject) throw new Error('Azure normalized baseline does not exist');
    const baselineText = await baselineObject.text();
    if (await sha256(baselineText) !== manifest.azureBaseline.normalizedOutput.sha256) throw new Error('Azure normalized baseline hash mismatch');
    const azureOutput = JSON.parse(baselineText) as unknown;
    if (!isNormalizedOutput(azureOutput)) throw new Error('Azure baseline does not satisfy normalized output schema');
    if (azureOutput.source.transcriptSha256 !== manifest.transcript.sha256) throw new Error('Azure baseline transcript hash mismatch');
    assertOutputMatchesFixtureContract(azureOutput, manifest, 'azure');

    const publicationIntentObject = await env.SHADOW_ARTIFACTS.get(manifest.azureBaseline.publicationIntent.key);
    if (!publicationIntentObject) throw new Error('Azure publication-intent baseline does not exist');
    const publicationIntentText = await publicationIntentObject.text();
    if (await sha256(publicationIntentText) !== manifest.azureBaseline.publicationIntent.sha256) throw new Error('Azure publication-intent baseline hash mismatch');
    const azurePublicationIntent = JSON.parse(publicationIntentText) as unknown;
    if (!isPublicationIntent(azurePublicationIntent)) throw new Error('Azure publication-intent baseline does not satisfy schema');
    if (!isPublicationIntent(azureOutput.publicationIntent) || stableJson(azurePublicationIntent) !== stableJson(azureOutput.publicationIntent)) {
      throw new Error('Azure normalized baseline and publication-intent baseline differ');
    }

    // Persist the model response before comparison artifacts and D1 completion.
    // A retry after a downstream persistence failure reuses this checkpoint and
    // does not invoke the model again.
    const llm = await loadOrCreateModelResponseCheckpoint(job, manifest, transcript, parsedConfigurationSnapshot as Record<string, unknown>, env);
    const rawCloudflareOutput = JSON.parse(llm.responseText) as unknown;
    if (!isNormalizedOutput(rawCloudflareOutput)) throw new Error('Cloudflare LLM output does not satisfy normalized output schema');
    const cloudflareOutput = normalizeApprovedSyntheticValidation(
      normalizeShadowPublication(rawCloudflareOutput, azurePublicationIntent),
      manifest,
    );
    if (cloudflareOutput.source.transcriptSha256 !== manifest.transcript.sha256) throw new Error('Cloudflare output transcript hash mismatch');
    assertOutputMatchesFixtureContract(cloudflareOutput, manifest, 'cloudflare');

    const comparison = compareNormalizedOutputs(manifest.fixtureId, manifestSha256, job.runId, azureOutput, cloudflareOutput);
    await env.SHADOW_ARTIFACTS.put(`runs/${job.runId}/cloudflare-normalized-output.json`, JSON.stringify(cloudflareOutput), { httpMetadata: { contentType: 'application/json' } });
    await env.SHADOW_ARTIFACTS.put(`runs/${job.runId}/cloudflare-publication-intent.json`, JSON.stringify(cloudflareOutput.publicationIntent), { httpMetadata: { contentType: 'application/json' } });
    await env.SHADOW_ARTIFACTS.put(`runs/${job.runId}/cloudflare-actual-publication.json`, JSON.stringify(cloudflareOutput.actualPublication), { httpMetadata: { contentType: 'application/json' } });
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

function isAzureExportJob(job: FixtureJob | AzureExportJob): job is AzureExportJob {
  return 'packageId' in job;
}

async function submitAzureExportPackage(request: Request, env: RuntimeEnv): Promise<Response> {
  if (!await hasMatchingReviewerToken(request, env.SHADOW_CONTINUOUS_SUBMISSION_TOKEN ?? '')) return json({ error: 'Unauthorized' }, 401);
  if (!env.CONTINUOUS_EXPORT_JOBS) return json({ error: 'Continuous export queue is not configured' }, 503);
  try {
    const manifest = await request.json() as unknown;
    if (!isAzureExportPackageManifest(manifest)) return json({ error: 'Request must be a valid Azure export package manifest' }, 400);
    const manifestText = JSON.stringify(manifest);
    const manifestSha256 = await sha256(manifestText);
    const manifestKey = azureExportManifestKey(manifest);
    const existingManifest = await env.SHADOW_ARTIFACTS.get(manifestKey);
    if (existingManifest && await sha256(await existingManifest.text()) !== manifestSha256) {
      return json({ error: 'Package ID already exists with different content' }, 409);
    }
    if (!existingManifest) {
      await env.SHADOW_ARTIFACTS.put(manifestKey, manifestText, { httpMetadata: { contentType: 'application/json' } });
    }

    const existing = await env.SHADOW_DB.prepare(
      'SELECT run_id, state FROM azure_export_runs WHERE package_id = ? AND manifest_sha256 = ? AND runtime_version = ?',
    ).bind(manifest.packageId, manifestSha256, CONTINUOUS_RUNTIME_VERSION).first<{ run_id: string; state: string }>();
    const action = azureExportRunRequestAction(existing?.state);
    if (action === 'replay' && existing) return json({ runId: existing.run_id, state: existing.state, replayed: true });

    const now = new Date().toISOString();
    const job: AzureExportJob = action === 'recover' && existing
      ? { packageId: manifest.packageId, manifestKey, manifestSha256, runId: existing.run_id }
      : { packageId: manifest.packageId, manifestKey, manifestSha256, runId: crypto.randomUUID() };
    if (action === 'recover') {
      const recovery = await env.SHADOW_DB.prepare(RECOVER_AZURE_EXPORT_RUN_SQL).bind(now, job.runId).run();
      if (!didClaimAzureExportRunProcessing(recovery.meta.changes)) {
        const replay = await env.SHADOW_DB.prepare(
          'SELECT run_id, state FROM azure_export_runs WHERE package_id = ? AND manifest_sha256 = ? AND runtime_version = ?',
        ).bind(manifest.packageId, manifestSha256, CONTINUOUS_RUNTIME_VERSION).first<{ run_id: string; state: string }>();
        if (replay) return json({ runId: replay.run_id, state: replay.state, replayed: true });
        throw new Error('Unable to recover Azure export run');
      }
    } else {
      try {
        await env.SHADOW_DB.prepare(
          'INSERT INTO azure_export_runs (run_id, package_id, manifest_key, manifest_sha256, state, runtime_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(job.runId, manifest.packageId, manifestKey, manifestSha256, 'queued', CONTINUOUS_RUNTIME_VERSION, now, now).run();
      } catch {
        const replay = await env.SHADOW_DB.prepare(
          'SELECT run_id, state FROM azure_export_runs WHERE package_id = ? AND manifest_sha256 = ? AND runtime_version = ?',
        ).bind(manifest.packageId, manifestSha256, CONTINUOUS_RUNTIME_VERSION).first<{ run_id: string; state: string }>();
        if (replay) return json({ runId: replay.run_id, state: replay.state, replayed: true });
        throw new Error('Unable to reserve Azure export run');
      }
    }
    try {
      await env.CONTINUOUS_EXPORT_JOBS.send(job);
    } catch {
      await env.SHADOW_DB.prepare(MARK_AZURE_EXPORT_QUEUE_SUBMISSION_FAILED_SQL)
        .bind('queue_submission_failed', new Date().toISOString(), job.runId).run();
      throw new Error('Unable to queue Azure export run');
    }
    return json({ runId: job.runId, state: 'queued', replayed: false, recovered: action === 'recover' }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return json({ error: message }, 400);
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

    if (request.method === 'POST' && url.pathname === '/v1/azure-export-runs') return submitAzureExportPackage(request, env);

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

  async queue(batch: MessageBatch<FixtureJob | AzureExportJob>, env: RuntimeEnv): Promise<void> {
    for (const message of batch.messages) {
      try {
        if (isAzureExportJob(message.body)) {
          if (!env.AZURE_ARTIFACT_READER_URL || !env.SHADOW_ARTIFACT_READ_TOKEN) {
            throw new Error('Continuous Azure artifact reader configuration is incomplete');
          }
          await processAzureExportJob(message.body, {
            ...env,
            AZURE_ARTIFACT_READER_URL: env.AZURE_ARTIFACT_READER_URL,
            SHADOW_ARTIFACT_READ_TOKEN: env.SHADOW_ARTIFACT_READ_TOKEN,
          });
        } else {
          await processJob(message.body, env);
        }
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
};
