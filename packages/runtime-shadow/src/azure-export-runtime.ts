import { AzureOpenAiAdapter } from './azure-openai';
import { projectAzureExportPackage } from './azure-export-processing';
import { compareContinuousNormalizedOutputs } from './comparison';
import type {
  AzureExportJob,
  AzureExportPackageManifest,
  ContinuousNormalizedOutput,
  ComparisonResult,
  NormalizedPerson,
  NormalizedTopic,
} from './contracts';
import { isAzureExportPackageManifest, isContinuousNormalizedOutput, stableJson } from './fixture-validation';
import {
  CLAIM_AZURE_EXPORT_RUN_PROCESSING_SQL,
  didClaimAzureExportRunProcessing,
} from './azure-export-run-lifecycle';

export const CONTINUOUS_RUNTIME_VERSION = '1.0.0';
const CONTINUOUS_OUTPUT_CONTRACT_VERSION = 'continuous-normalized-output-v1';

export interface AzureExportRuntimeEnv {
  SHADOW_DB: D1Database;
  SHADOW_ARTIFACTS: R2Bucket;
  AZURE_ARTIFACT_READER_URL: string;
  SHADOW_ARTIFACT_READ_TOKEN: string;
  AZURE_OPENAI_ENDPOINT: string;
  AZURE_OPENAI_DEPLOYMENT: string;
  AZURE_OPENAI_API_KEY: string;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

function runKey(runId: string, name: string): string {
  return `runs/${runId}/continuous/${name}`;
}

interface ModelResponseCheckpoint {
  outputContractVersion: typeof CONTINUOUS_OUTPUT_CONTRACT_VERSION;
  responseText: string;
  provider: 'azure_openai' | 'workers_ai';
  model: string;
  deployment: string;
  requestSha256: string;
  responseSha256: string;
}

function checkpointKey(runId: string): string {
  return runKey(runId, `model-response-checkpoints/${CONTINUOUS_OUTPUT_CONTRACT_VERSION}.json`);
}

function continuousPrompt(manifest: AzureExportPackageManifest, transcript: string): string {
  const hashes = Object.fromEntries(manifest.processing.configuration.map((reference) => [reference.name, reference.sha256]));
  return JSON.stringify({
    task: 'Produce one continuous normalized EIP output from the supplied Azure transcript.',
    outputContractVersion: CONTINUOUS_OUTPUT_CONTRACT_VERSION,
    responseRules: [
      'Return exactly one JSON object and nothing else.',
      'Use evidence only from the supplied transcript; do not publish or call external systems.',
      'A completed decision requires explicit transcript evidence.',
      'Use null or [] where evidence is unavailable; never invent evidence.',
    ],
    immutableValues: {
      schemaVersion: '1.0.0',
      source: { system: manifest.source.system, nativeId: manifest.source.nativeId, transcriptSha256: manifest.artifacts.transcript.sha256 },
      processing: {
        runtime: 'cloudflare', pipelineVersion: manifest.processing.azurePipelineVersion,
        promptVersion: manifest.processing.promptVersion ?? '', model: manifest.processing.model ?? '',
        deployment: manifest.processing.deployment ?? '', configurationHashes: hashes,
      },
    },
    requiredOutputShape: {
      schemaVersion: '1.0.0',
      source: { system: 'string', nativeId: 'string', transcriptSha256: 'sha256' },
      processing: { runtime: 'cloudflare', pipelineVersion: 'string', promptVersion: 'string', model: 'string', deployment: 'string', configurationHashes: 'Record<string, sha256>' },
      classification: { mode: 'string|null', confidence: 'string|null' },
      summaryAssertions: [{ id: 'string', text: 'string' }],
      topics: [{
        topicId: 'string|null', topic: 'string|null', domain: 'string|null', category: 'string|null', contextType: 'string|null', summary: 'string|null',
        keyFacts: [{ id: 'string', text: 'string' }], decisions: [{ id: 'string', text: 'string' }], actions: [{ id: 'string', text: 'string' }], risks: [{ id: 'string', text: 'string' }],
        owners: ['string'], confidence: 'string|null', validation: { status: 'pass|warning|fail', reasons: ['string'] },
      }],
      people: [{
        canonicalName: 'string|null', sourceName: 'string', attendance: 'string|null', contributions: [{ id: 'string', text: 'string' }], actions: [{ id: 'string', text: 'string' }],
        decisionsOwned: [{ id: 'string', text: 'string' }], risksRaised: [{ id: 'string', text: 'string' }], topicIds: ['string'], stance: 'string|null', unresolved: 'boolean',
      }],
      validation: { status: 'pass|warning|fail', reasons: ['string'] },
    },
    transcript,
  });
}

async function loadManifest(env: AzureExportRuntimeEnv, job: AzureExportJob): Promise<AzureExportPackageManifest> {
  if (!job.manifestKey.startsWith('azure-export-manifests/') || job.manifestKey.includes('..') || job.manifestKey.includes('\\')) {
    throw new Error('Queue job references an invalid Azure export manifest key');
  }
  const object = await env.SHADOW_ARTIFACTS.get(job.manifestKey);
  if (!object) throw new Error('Azure export manifest does not exist');
  const text = await object.text();
  if (await sha256(text) !== job.manifestSha256) throw new Error('Azure export manifest hash mismatch');
  const manifest = JSON.parse(text) as unknown;
  if (!isAzureExportPackageManifest(manifest) || manifest.packageId !== job.packageId) throw new Error('Azure export manifest is invalid');
  return manifest;
}

async function loadAzureArtifact(env: AzureExportRuntimeEnv, reference: AzureExportPackageManifest['artifacts']['transcript']): Promise<string> {
  const base = new URL(env.AZURE_ARTIFACT_READER_URL);
  const url = new URL(encodeURIComponent(reference.key).replace(/%2F/g, '/'), base.pathname.endsWith('/') ? base : `${base.toString()}/`);
  const response = await fetch(url, { headers: { authorization: `Bearer ${env.SHADOW_ARTIFACT_READ_TOKEN}` } });
  if (!response.ok) throw new Error(`Azure artifact reader returned ${response.status}`);
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength !== reference.bytes) throw new Error('Azure artifact byte count mismatch');
  if (await sha256(text) !== reference.sha256) throw new Error('Azure artifact hash mismatch');
  return text;
}

function azureProjection(manifest: AzureExportPackageManifest, contents: { transcript: string; summary: string; people: string; topicRecords: string[] }): ContinuousNormalizedOutput {
  const projection = projectAzureExportPackage(manifest, contents);
  return {
    schemaVersion: '1.0.0',
    source: { system: manifest.source.system, nativeId: manifest.source.nativeId, transcriptSha256: manifest.artifacts.transcript.sha256 },
    processing: {
      runtime: 'azure', pipelineVersion: manifest.processing.azurePipelineVersion,
      promptVersion: manifest.processing.promptVersion ?? '', model: manifest.processing.model ?? '', deployment: manifest.processing.deployment ?? '',
      configurationHashes: Object.fromEntries(manifest.processing.configuration.map((reference) => [reference.name, reference.sha256])),
    },
    classification: { mode: null, confidence: null }, summaryAssertions: projection.summaryAssertions,
    topics: projection.topics, people: projection.people, validation: { status: 'pass', reasons: [] },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function assertion(value: unknown, id: string): { id: string; text: string } | null {
  const item = record(value);
  const assertionText = text(item?.text);
  return assertionText ? { id: text(item?.id) ?? id, text: assertionText } : null;
}

function assertions(value: unknown, prefix: string): { id: string; text: string }[] {
  return Array.isArray(value) ? value.flatMap((item, index) => {
    const normalized = assertion(item, `${prefix}-${index + 1}`);
    return normalized ? [normalized] : [];
  }) : [];
}

function validationStatus(value: unknown): 'pass' | 'warning' | 'fail' {
  return value === 'fail' ? 'fail' : value === 'warning' ? 'warning' : 'pass';
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => text(item) ? [text(item)!] : []) : [];
}

function normalizeContinuousModelOutput(
  value: unknown,
  source: ContinuousNormalizedOutput['source'],
  processing: ContinuousNormalizedOutput['processing'],
): ContinuousNormalizedOutput | null {
  const output = record(value);
  if (!output || output.schemaVersion !== '1.0.0') return null;
  const topics: NormalizedTopic[] = Array.isArray(output.topics) ? output.topics.flatMap((value, index): NormalizedTopic[] => {
    const topic = record(value);
    if (!topic) return [];
    const decisions = assertions(topic.decisions ?? topic.assertions, `topic-${index + 1}-decision`);
    return [{
      topicId: text(topic.topicId), topic: text(topic.topic) ?? text(topic.name), domain: text(topic.domain), category: text(topic.category),
      contextType: text(topic.contextType), summary: text(topic.summary), keyFacts: assertions(topic.keyFacts, `topic-${index + 1}-fact`),
      decisions, actions: assertions(topic.actions, `topic-${index + 1}-action`), risks: assertions(topic.risks, `topic-${index + 1}-risk`),
      owners: Array.isArray(topic.owners) ? topic.owners.flatMap((owner) => text(owner) ? [text(owner)!] : []) : [], confidence: text(topic.confidence),
      validation: { status: validationStatus(record(topic.validation)?.status), reasons: strings(record(topic.validation)?.reasons) },
    }];
  }) : [];
  const people: NormalizedPerson[] = Array.isArray(output.people) ? output.people.flatMap((value): NormalizedPerson[] => {
    const person = record(value);
    const sourceName = text(person?.sourceName) ?? text(person?.canonicalName);
    if (!person || !sourceName) return [];
    return [{ canonicalName: text(person.canonicalName), sourceName, attendance: text(person.attendance), contributions: assertions(person.contributions, 'person-contribution'), actions: assertions(person.actions, 'person-action'), decisionsOwned: assertions(person.decisionsOwned, 'person-decision'), risksRaised: assertions(person.risksRaised, 'person-risk'), topicIds: Array.isArray(person.topicIds) ? person.topicIds.flatMap((topicId) => text(topicId) ? [text(topicId)!] : []) : [], stance: text(person.stance), unresolved: person.unresolved === true }];
  }) : [];
  const validation = record(output.validation);
  return {
    schemaVersion: '1.0.0', source, processing,
    classification: { mode: text(record(output.classification)?.mode), confidence: text(record(output.classification)?.confidence) },
    summaryAssertions: assertions(output.summaryAssertions, 'summary'), topics, people,
    validation: { status: validationStatus(validation?.status), reasons: strings(validation?.reasons) },
  };
}

async function loadOrCreateModelResponseCheckpoint(
  job: AzureExportJob,
  manifest: AzureExportPackageManifest,
  transcript: string,
  env: AzureExportRuntimeEnv,
): Promise<ModelResponseCheckpoint> {
  const key = checkpointKey(job.runId);
  const existing = await env.SHADOW_ARTIFACTS.get(key);
  if (existing) {
    const checkpoint = JSON.parse(await existing.text()) as ModelResponseCheckpoint;
    if (checkpoint.outputContractVersion !== CONTINUOUS_OUTPUT_CONTRACT_VERSION
      || typeof checkpoint.responseText !== 'string'
      || typeof checkpoint.provider !== 'string'
      || typeof checkpoint.model !== 'string'
      || typeof checkpoint.deployment !== 'string'
      || typeof checkpoint.requestSha256 !== 'string'
      || typeof checkpoint.responseSha256 !== 'string'
      || await sha256(checkpoint.responseText) !== checkpoint.responseSha256) {
      throw new Error('Continuous model response checkpoint is invalid');
    }
    return checkpoint;
  }

  const adapter = new AzureOpenAiAdapter({ endpoint: env.AZURE_OPENAI_ENDPOINT, deployment: env.AZURE_OPENAI_DEPLOYMENT, apiKey: env.AZURE_OPENAI_API_KEY });
  const response = await adapter.invoke({
    correlationId: job.runId,
    systemPrompt: 'You are an evidence-bound EIP normalization engine.',
    userContent: continuousPrompt(manifest, transcript),
    maxTokens: 16000,
    responseFormat: 'json_object',
    promptVersion: manifest.processing.promptVersion ?? '',
  });
  const checkpoint: ModelResponseCheckpoint = {
    outputContractVersion: CONTINUOUS_OUTPUT_CONTRACT_VERSION,
    responseText: response.responseText,
    provider: response.provider,
    model: response.model,
    deployment: response.deployment,
    requestSha256: response.requestSha256,
    responseSha256: response.responseSha256,
  };
  await env.SHADOW_ARTIFACTS.put(key, JSON.stringify(checkpoint), { httpMetadata: { contentType: 'application/json' } });
  return checkpoint;
}

export async function processAzureExportJob(job: AzureExportJob, env: AzureExportRuntimeEnv): Promise<void> {
  const manifest = await loadManifest(env, job);
  const claim = await env.SHADOW_DB.prepare(CLAIM_AZURE_EXPORT_RUN_PROCESSING_SQL)
    .bind(new Date().toISOString(), job.runId, manifest.packageId, job.manifestSha256, CONTINUOUS_RUNTIME_VERSION).run();
  if (!didClaimAzureExportRunProcessing(claim.meta.changes)) {
    log('azure_export_run_unclaimed', { packageId: manifest.packageId, runId: job.runId });
    return;
  }

  try {
    const [transcript, summary, people, ...topicRecords] = await Promise.all([
      loadAzureArtifact(env, manifest.artifacts.transcript), loadAzureArtifact(env, manifest.artifacts.summary),
      loadAzureArtifact(env, manifest.artifacts.people), ...manifest.artifacts.topicRecords.map((reference) => loadAzureArtifact(env, reference)),
    ]);
    const azure = azureProjection(manifest, { transcript, summary, people, topicRecords });
    // Persist the model response before comparison artifacts and D1 completion.
    // A retry after later persistence failures reuses this checkpoint and cannot
    // invoke the model a second time for the same immutable package/run.
    const response = await loadOrCreateModelResponseCheckpoint(job, manifest, transcript, env);
    const modelOutput = JSON.parse(response.responseText) as unknown;
    const expectedCloudflareProcessing = { ...azure.processing, runtime: 'cloudflare' as const };
    const cloudflare = normalizeContinuousModelOutput(modelOutput, azure.source, expectedCloudflareProcessing);
    if (!cloudflare || !isContinuousNormalizedOutput(cloudflare)
      || stableJson(cloudflare.source) !== stableJson(azure.source)
      || stableJson(cloudflare.processing) !== stableJson(expectedCloudflareProcessing)) {
      throw new Error('Cloudflare continuous output does not satisfy the immutable package contract');
    }
    const comparison: ComparisonResult = compareContinuousNormalizedOutputs(manifest.packageId, job.manifestSha256, job.runId, azure, cloudflare);
    await env.SHADOW_ARTIFACTS.put(runKey(job.runId, 'azure-normalized-output.json'), JSON.stringify(azure), { httpMetadata: { contentType: 'application/json' } });
    await env.SHADOW_ARTIFACTS.put(runKey(job.runId, 'cloudflare-normalized-output.json'), JSON.stringify(cloudflare), { httpMetadata: { contentType: 'application/json' } });
    await env.SHADOW_ARTIFACTS.put(runKey(job.runId, 'comparison.json'), JSON.stringify(comparison), { httpMetadata: { contentType: 'application/json' } });
    await env.SHADOW_DB.prepare('UPDATE azure_export_runs SET state = ?, adapter_provider = ?, model = ?, deployment = ?, request_sha256 = ?, response_sha256 = ?, comparison_status = ?, blocking_count = ?, material_count = ?, updated_at = ? WHERE run_id = ?')
      .bind('completed', response.provider, response.model, response.deployment, response.requestSha256, response.responseSha256, comparison.status, comparison.counts.blocking, comparison.counts.material, new Date().toISOString(), job.runId).run();
    log('azure_export_run_completed', { packageId: manifest.packageId, runId: job.runId, status: comparison.status });
  } catch (error) {
    const errorClass = error instanceof Error ? error.message.slice(0, 120) : 'unknown_error';
    await env.SHADOW_DB.prepare('UPDATE azure_export_runs SET state = ?, error_class = ?, updated_at = ? WHERE run_id = ?')
      .bind('failed', errorClass, new Date().toISOString(), job.runId).run();
    log('azure_export_run_failed', { packageId: manifest.packageId, runId: job.runId, errorClass });
    throw error;
  }
}
