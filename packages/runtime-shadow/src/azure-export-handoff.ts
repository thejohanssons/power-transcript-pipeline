import type { AzureExportArtifactReference, AzureExportPackageManifest } from './contracts';
import { stableJson } from './fixture-validation';

export interface ExistingAzureArtifact {
  kind: AzureExportArtifactReference['kind'];
  key: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

/**
 * Azure's current artifact hierarchy remains the sole operational artifact
 * store during parity. This module produces only a manifest reference; it never
 * uploads, mirrors, deletes, or rewrites those artifact bodies.
 */
export const EXISTING_AZURE_ARTIFACT_PREFIXES = {
  transcript: 'transcripts/',
  summary: 'summaries/',
  people: 'people/',
  topic_record: 'topic-records/',
} as const;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireArtifact(artifacts: ExistingAzureArtifact[], kind: ExistingAzureArtifact['kind']): ExistingAzureArtifact {
  const matches = artifacts.filter((artifact) => artifact.kind === kind);
  if (matches.length !== 1) throw new Error(`Azure handoff requires exactly one ${kind} artifact`);
  return matches[0];
}

function toReference(artifact: ExistingAzureArtifact): AzureExportArtifactReference {
  const prefix = EXISTING_AZURE_ARTIFACT_PREFIXES[artifact.kind];
  if (!artifact.key.startsWith(prefix) || artifact.key.includes('..') || artifact.key.includes('\\')) {
    throw new Error(`Azure ${artifact.kind} artifact key is outside its established storage hierarchy`);
  }
  return { ...artifact };
}

/**
 * Builds a package that points to Azure's existing Cloudflare objects. Its ID
 * is stable for an unchanged source identity plus artifact digests, allowing a
 * later ingress reservation to replay rather than duplicate a shadow run.
 */
export async function buildExistingAzureExportPackage(input: {
  source: AzureExportPackageManifest['source'];
  processing: AzureExportPackageManifest['processing'];
  artifacts: ExistingAzureArtifact[];
}): Promise<AzureExportPackageManifest> {
  const transcript = toReference(requireArtifact(input.artifacts, 'transcript'));
  const summary = toReference(requireArtifact(input.artifacts, 'summary'));
  const people = toReference(requireArtifact(input.artifacts, 'people'));
  const topicRecords = input.artifacts.filter((artifact) => artifact.kind === 'topic_record').map(toReference)
    .sort((left, right) => left.key.localeCompare(right.key));
  const identity = stableJson({
    source: input.source,
    artifacts: [transcript, summary, people, ...topicRecords].map(({ kind, key, sha256 }) => ({ kind, key, sha256 })),
  });

  return {
    schemaVersion: '1.0.0',
    packageId: `azure-export-${await sha256Hex(identity)}`,
    source: input.source,
    processing: input.processing,
    artifacts: { transcript, summary, people, topicRecords },
  };
}

/** The only object the future ingress may write; it is distinct from Azure operational artifacts. */
export function azureExportManifestKey(manifest: AzureExportPackageManifest): string {
  return `azure-export-manifests/${manifest.packageId}.json`;
}
