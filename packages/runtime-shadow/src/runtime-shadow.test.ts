import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareNormalizedOutputs } from './comparison';
import type { FixtureManifest, NormalizedOutput } from './contracts';
import { isFixtureManifest, isNormalizedOutput, isSafeObjectKey } from './fixture-validation';
import {
  CLAIM_FIXTURE_RUN_PROCESSING_SQL,
  didClaimFixtureRunProcessing,
  fixtureRunRequestAction,
  MARK_QUEUE_SUBMISSION_FAILED_SQL,
  RECOVER_FIXTURE_RUN_SQL,
} from './fixture-run-lifecycle';
import { hasMatchingReviewerToken, validateReviewerDisposition } from './reviewer-disposition';
import { buildNormalizationInput, normalizeFixtureSource, parseFixtureTranscript } from './fixture-processing';
import { normalizeApprovedSyntheticValidation } from './shadow-policy';

const SHA256 = 'a'.repeat(64);
const publicationIntent = {
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

function output(overrides: Partial<NormalizedOutput> = {}): NormalizedOutput {
  return {
    schemaVersion: '1.0.0',
    source: { system: 'azure_fixture_export', nativeId: 'fixture-1', transcriptSha256: SHA256, acquisitionMode: 'calendar' },
    processing: { runtime: 'azure', pipelineVersion: '1', promptVersion: '1', model: 'model', deployment: 'deployment', configurationHashes: {} },
    classification: { mode: 'executive', confidence: 'high' },
    summaryAssertions: [{ id: 'summary-1', text: 'The VAT rate was approved.' }],
    topics: [{
      topicId: 'T01', topic: 'VAT', domain: 'finance', category: 'decision', contextType: 'strategic', summary: 'Approved',
      keyFacts: [], decisions: [{ id: 'decision-1', text: 'The VAT rate was approved.' }], actions: [], risks: [], owners: ['Owner'], confidence: 'high', validation: { status: 'pass', reasons: [] },
    }],
    people: [],
    validation: { status: 'pass', reasons: [] },
    publicationIntent,
    ...overrides,
  };
}

function manifest(overrides: Partial<FixtureManifest> = {}): FixtureManifest {
  return {
    schemaVersion: '1.0.0', fixtureId: 'fixture-1', revision: '1', acquisitionMode: 'calendar',
    source: { system: 'azure_fixture_export', nativeId: 'fixture-1' },
    transcript: { key: 'fixtures/fixture-1/hash/input/transcript.vtt', sha256: SHA256, bytes: 10, contentType: 'text/vtt' },
    azureBaseline: {
      normalizedOutput: { key: 'fixtures/fixture-1/hash/baseline/azure-normalized-output.json', sha256: SHA256, bytes: 10, contentType: 'application/json' },
      publicationIntent: { key: 'fixtures/fixture-1/hash/baseline/azure-publication-intent.json', sha256: SHA256, bytes: 10, contentType: 'application/json' },
    },
    configurationSnapshot: { key: 'fixtures/fixture-1/hash/baseline/config-snapshot.json', sha256: SHA256, bytes: 10, contentType: 'application/json' },
    configuration: [{ name: 'taxonomy', sha256: SHA256 }],
    processing: { azurePipelineVersion: '1', promptVersion: '1', model: 'model', deployment: 'deployment' },
    classification: 'internal', approvedBy: 'reviewer@example.test', approvedAt: '2026-08-01T00:00:00.000Z', expiresAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('fixture contract and integrity guards', () => {
  it('accepts a complete future-dated immutable fixture manifest', () => {
    expect(isFixtureManifest(manifest())).toBe(true);
  });

  it('rejects invalid retention windows and unsafe object keys', () => {
    expect(isFixtureManifest(manifest({ expiresAt: '2026-07-31T00:00:00.000Z' }))).toBe(false);
    expect(isFixtureManifest(manifest({ expiresAt: '2026-09-01T00:00:00.000Z' }))).toBe(false);
    expect(isSafeObjectKey('fixtures/../secret.json', 'fixtures/')).toBe(false);
    expect(isSafeObjectKey('/fixtures/fixture.json', 'fixtures/')).toBe(false);
    expect(isSafeObjectKey('fixtures/fixture-1/manifest.json', 'fixtures/')).toBe(true);
    expect(isSafeObjectKey('fixtures\\fixture-1\\manifest.json', 'fixtures/')).toBe(false);
  });

  it('requires a hashed configuration snapshot alongside frozen Azure baselines', () => {
    const incomplete = manifest() as unknown as Record<string, unknown>;
    delete incomplete.configurationSnapshot;
    expect(isFixtureManifest(incomplete)).toBe(false);
  });

  it('rejects an incomplete normalized output projection', () => {
    const incomplete = { ...output(), publicationIntent: { ...publicationIntent } } as Record<string, unknown>;
    delete incomplete.people;
    expect(isNormalizedOutput(incomplete)).toBe(false);
  });

  it('accepts a separate actual-publication projection without treating it as business intent', () => {
    const shadowOutput = {
      ...output(),
      processing: { ...output().processing, runtime: 'cloudflare' as const },
      actualPublication: {
        transcript: false, summary: false, peopleFile: false, topicRecords: false, masterLog: false,
        confluence: false, teamsNotification: false, canonicalTopicMemory: false, legacyCloudflareSync: false,
      },
    };
    expect(isNormalizedOutput(shadowOutput)).toBe(true);
  });
});

describe('local fixture processing primitives', () => {
  it('parses WebVTT cue text without performing source acquisition', () => {
    expect(parseFixtureTranscript('WEBVTT\n\n1\n00:00.000 --> 00:02.000\nApprove <b>the budget</b>.\n'))
      .toEqual({ format: 'webvtt', text: 'Approve the budget.', cueCount: 1 });
  });

  it('excludes multi-line WebVTT metadata blocks and rejects an empty transcript', () => {
    expect(parseFixtureTranscript('WEBVTT\n\nNOTE internal metadata\nDo not send to the model.\n\n00:00.000 --> 00:02.000\nApproved.\n'))
      .toEqual({ format: 'webvtt', text: 'Approved.', cueCount: 1 });
    expect(() => parseFixtureTranscript('  \n\t')).toThrow('Fixture transcript is empty');
  });

  it('normalizes declared metadata for every supported acquisition mode', () => {
    for (const acquisitionMode of ['calendar', 'vtt_inbox', 'direct_vtt'] as const) {
      const fixture = manifest({ acquisitionMode, source: { system: ' Azure Fixture ', nativeId: ' fixture-1 ', organiser: ' OWNER@EXAMPLE.TEST ' } });
      expect(normalizeFixtureSource(fixture)).toMatchObject({
        system: 'Azure Fixture', nativeId: 'fixture-1', acquisitionMode, organiser: 'owner@example.test',
      });
    }
  });

  it('builds evidence-only model input from a local immutable fixture', () => {
    const input = buildNormalizationInput(manifest(), 'A locally supplied transcript.');
    expect(input).toMatchObject({
      source: { system: 'azure_fixture_export', acquisitionMode: 'calendar' },
      transcript: { format: 'plain_text', text: 'A locally supplied transcript.', cueCount: 0 },
    });
  });
});

describe('approved synthetic-fixture policy', () => {
  it('passes validation when an approved synthetic fixture only lacks people or owners', () => {
    const fixture = manifest({ source: { system: 'synthetic_local_exercise', nativeId: 'fixture-1' } });
    const normalized = normalizeApprovedSyntheticValidation(output({
      validation: { status: 'warning', reasons: ['The transcript contains no identified participants or action owners.'] },
      topics: [{
        ...output().topics[0],
        validation: { status: 'warning', reasons: ['No owner is identified in the transcript.'] },
      }],
    }), fixture);

    expect(normalized.validation).toEqual({ status: 'pass', reasons: [] });
    expect(normalized.topics[0].validation).toEqual({ status: 'pass', reasons: [] });
  });

  it('retains substantive validation findings and never exempts non-synthetic fixtures', () => {
    const warning = { status: 'warning' as const, reasons: ['No participants or owners are identified in the transcript.', 'The requested budget approval is not explicitly confirmed as completed.', 'Transcript content is incomplete.'] };
    expect(normalizeApprovedSyntheticValidation(output({ validation: warning }), manifest({ source: { system: 'synthetic_local_exercise', nativeId: 'fixture-1' } })).validation)
      .toEqual({
        status: 'warning',
        reasons: [
          'The requested budget approval is not explicitly confirmed as completed.',
          'Transcript content is incomplete.',
        ],
      });
    expect(normalizeApprovedSyntheticValidation(output({ validation: warning }), manifest()).validation).toEqual(warning);
  });
});

describe('synthetic revision 2 evidence-safe fixture package', () => {
  const revision2Root = new URL('../fixtures/synthetic-fixture-0001/synthetic-revision-2/', import.meta.url);

  function readRevision2(relativePath: string): Buffer {
    return readFileSync(new URL(relativePath, revision2Root));
  }

  function sha256(value: Buffer): string {
    return createHash('sha256').update(value).digest('hex');
  }

  it('has a valid manifest whose local object references preserve their recorded bytes and hashes', () => {
    const fixture = JSON.parse(readRevision2('manifest.json').toString('utf8')) as FixtureManifest;
    expect(isFixtureManifest(fixture)).toBe(true);

    const references = [
      fixture.transcript,
      fixture.azureBaseline.normalizedOutput,
      fixture.azureBaseline.publicationIntent,
      fixture.configurationSnapshot,
    ];
    for (const reference of references) {
      const relativePath = reference.key.replace('fixtures/synthetic-fixture-0001/synthetic-revision-2/', '');
      const content = readRevision2(relativePath);
      expect(content.byteLength).toBe(reference.bytes);
      expect(sha256(content)).toBe(reference.sha256);
    }
  });

  it('freezes an evidence-safe baseline rather than representing the requested approval as completed', () => {
    const fixture = JSON.parse(readRevision2('manifest.json').toString('utf8')) as FixtureManifest;
    const transcript = readRevision2('input/transcript.vtt').toString('utf8');
    const baseline = JSON.parse(readRevision2('baseline/azure-normalized-output.json').toString('utf8')) as NormalizedOutput;
    const intent = JSON.parse(readRevision2('baseline/azure-publication-intent.json').toString('utf8'));

    expect(parseFixtureTranscript(transcript)).toEqual({
      format: 'webvtt',
      text: 'Action: approve the local validation budget. Decision: the fixture is retained for the approved exercise only.',
      cueCount: 2,
    });
    expect(isNormalizedOutput(baseline)).toBe(true);
    expect(baseline.source.transcriptSha256).toBe(fixture.transcript.sha256);
    expect(baseline.summaryAssertions.map((assertion) => assertion.text)).toEqual([
      'Action: approve the local validation budget.',
      'The fixture is retained for the approved exercise only.',
    ]);
    expect(baseline.summaryAssertions.map((assertion) => assertion.text).join(' ')).not.toMatch(/budget was approved/i);
    expect(baseline).toMatchObject({
      classification: { mode: 'internal', confidence: 'high' },
      topics: [],
      people: [],
      validation: { status: 'pass', reasons: [] },
      publicationIntent: intent,
    });
  });
});

describe('fixture run idempotency and recovery', () => {
  it('creates new reservations, replays active/completed runs, and recovers only failed runs', () => {
    expect(fixtureRunRequestAction(undefined)).toBe('create');
    expect(fixtureRunRequestAction('queued')).toBe('replay');
    expect(fixtureRunRequestAction('processing')).toBe('replay');
    expect(fixtureRunRequestAction('completed')).toBe('replay');
    expect(fixtureRunRequestAction('failed')).toBe('recover');
  });

  it('allows only one atomic retry or recovered delivery to claim processing', () => {
    // A Queue retry may reclaim a failed run, while a recovery request first
    // re-queues it. In either case, only one conditional update can change it.
    expect(CLAIM_FIXTURE_RUN_PROCESSING_SQL).toContain("state IN ('queued', 'failed')");
    expect(RECOVER_FIXTURE_RUN_SQL).toContain("state = 'failed'");
    expect(MARK_QUEUE_SUBMISSION_FAILED_SQL).toContain("state = 'queued'");
    expect(didClaimFixtureRunProcessing(1)).toBe(true);
    expect(didClaimFixtureRunProcessing(0)).toBe(false);
    expect(didClaimFixtureRunProcessing(2)).toBe(false);
  });
});

describe('normalized comparison and review workflow', () => {
  it('treats a frozen processing-contract change as blocking', () => {
    const cloudflare = output({
      processing: { ...output().processing, runtime: 'cloudflare', promptVersion: 'unexpected-prompt' },
    });
    const result = compareNormalizedOutputs('fixture-1', SHA256, 'run-1', output(), cloudflare);
    expect(result.status).toBe('blocked');
    expect(result.differences).toContainEqual(expect.objectContaining({ path: 'processing', severity: 'blocking' }));
  });

  it('treats a publication-intent change as blocking', () => {
    const cloudflare = output({ processing: { ...output().processing, runtime: 'cloudflare' }, publicationIntent: { ...publicationIntent, confluence: true } });
    const result = compareNormalizedOutputs('fixture-1', SHA256, 'run-1', output(), cloudflare);
    expect(result.status).toBe('blocked');
    expect(result.differences).toContainEqual(expect.objectContaining({ path: 'publicationIntent.confluence', severity: 'blocking' }));
  });

  it('compares distinct evidence assertions rather than summary/topic presentation repeats', () => {
    const azure = output();
    const cloudflare = output({
      processing: { ...output().processing, runtime: 'cloudflare' },
      summaryAssertions: [],
    });
    const result = compareNormalizedOutputs('fixture-1', SHA256, 'run-1', azure, cloudflare);

    expect(result.differences).not.toContainEqual(expect.objectContaining({ path: 'assertions' }));
    expect(result.status).toBe('pass');
  });

  it('requires a material difference and non-empty reviewer details', () => {
    const cloudflare = output({ processing: { ...output().processing, runtime: 'cloudflare' }, classification: { mode: 'operational', confidence: 'high' } });
    const result = compareNormalizedOutputs('fixture-1', SHA256, 'run-1', output(), cloudflare);
    const accepted = validateReviewerDisposition({ path: 'classification', disposition: 'accepted_equivalent', reviewerId: 'reviewer-1', note: 'Equivalent after normalization.' }, result.differences);
    expect(accepted).toMatchObject({ path: 'classification', disposition: 'accepted_equivalent' });
    expect(validateReviewerDisposition({ path: 'missing', disposition: 'accepted_equivalent', reviewerId: 'reviewer-1', note: 'No target.' }, result.differences)).toBeNull();
  });

  it('uses a timing-safe reviewer token comparison', async () => {
    const authorized = new Request('https://local.test/v1/fixture-runs/run/dispositions', { headers: { authorization: 'Bearer review-token' } });
    const rejected = new Request('https://local.test/v1/fixture-runs/run/dispositions', { headers: { authorization: 'Bearer wrong-token' } });
    await expect(hasMatchingReviewerToken(authorized, 'review-token')).resolves.toBe(true);
    await expect(hasMatchingReviewerToken(rejected, 'review-token')).resolves.toBe(false);
  });
});

describe('no-publisher foundation', () => {
  it('contains no Graph or publisher client implementation', () => {
    const implementation = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(implementation).not.toMatch(/graph\.microsoft\.com|sharepoint|confluence|teams|publisher/i);
  });

  it('declares only isolated staging shadow bindings with no remote binding', () => {
    const configuration = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    expect(configuration).toContain('eip-runtime-shadow-staging');
    expect(configuration).not.toMatch(/"remote"\s*:\s*true|sharepoint|confluence|teams|publisher/i);
  });
});
