import { describe, expect, it } from 'vitest';
import {
  azureExportManifestKey,
  buildExistingAzureExportPackage,
  EXISTING_AZURE_ARTIFACT_PREFIXES,
  type ExistingAzureArtifact,
} from './azure-export-handoff';
import { isAzureExportPackageManifest } from './fixture-validation';

const SHA256 = 'c'.repeat(64);

function artifact(kind: ExistingAzureArtifact['kind'], key: string, contentType: string): ExistingAzureArtifact {
  return { kind, key, sha256: SHA256, bytes: 1, contentType };
}

function artifacts(): ExistingAzureArtifact[] {
  return [
    artifact('transcript', 'transcripts/2026-07/payment.txt', 'text/plain'),
    artifact('summary', 'summaries/2026-07/payment-summary.txt', 'text/plain'),
    artifact('people', 'people/2026-07/payment-people.txt', 'text/plain'),
    artifact('topic_record', 'topic-records/2026-07/payment/T15.md', 'text/markdown'),
  ];
}

describe('existing Azure artifact handoff', () => {
  it('references Azure-owned objects without copying operational artifact bodies', async () => {
    const input = {
      source: { system: 'azure_transcript_export', nativeId: 'payment-20260721' },
      processing: { azurePipelineVersion: '1.7.9', configuration: [{ name: 'taxonomy', sha256: SHA256 }] },
      artifacts: artifacts(),
    };
    const first = await buildExistingAzureExportPackage(input);
    const replay = await buildExistingAzureExportPackage({ ...input, artifacts: [...input.artifacts].reverse() });

    expect(isAzureExportPackageManifest(first)).toBe(true);
    expect(replay.packageId).toBe(first.packageId);
    expect(first.artifacts.transcript.key).toBe('transcripts/2026-07/payment.txt');
    expect(first.artifacts.topicRecords.map(({ key }) => key)).toEqual(['topic-records/2026-07/payment/T15.md']);
    expect(azureExportManifestKey(first)).toBe(`azure-export-manifests/${first.packageId}.json`);
    expect(EXISTING_AZURE_ARTIFACT_PREFIXES).toEqual({
      transcript: 'transcripts/', summary: 'summaries/', people: 'people/', topic_record: 'topic-records/',
    });
  });

  it('rejects incomplete or cross-hierarchy references before an ingress can reserve a run', async () => {
    await expect(buildExistingAzureExportPackage({
      source: { system: 'azure_transcript_export', nativeId: 'payment-20260721' },
      processing: { azurePipelineVersion: '1.7.9', configuration: [] },
      artifacts: artifacts().filter(({ kind }) => kind !== 'people'),
    })).rejects.toThrow('exactly one people artifact');

    const invalid = artifacts();
    invalid[0] = { ...invalid[0], key: 'summaries/2026-07/payment.txt' };
    await expect(buildExistingAzureExportPackage({
      source: { system: 'azure_transcript_export', nativeId: 'payment-20260721' },
      processing: { azurePipelineVersion: '1.7.9', configuration: [] },
      artifacts: invalid,
    })).rejects.toThrow('outside its established storage hierarchy');
  });
});
