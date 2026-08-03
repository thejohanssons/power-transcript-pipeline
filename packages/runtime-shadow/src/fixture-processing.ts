import type { AcquisitionMode, FixtureManifest } from './contracts';

export interface ParsedTranscript {
  format: 'webvtt' | 'plain_text';
  text: string;
  cueCount: number;
}

export interface NormalizedFixtureSource {
  system: string;
  nativeId: string;
  acquisitionMode: AcquisitionMode;
  meetingId: string | null;
  organiser: string | null;
  eventStart: string | null;
  eventEnd: string | null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Parses only the fixture payload already supplied to the shadow runtime. It
 * performs no acquisition and deliberately has no Graph or publisher behavior.
 */
export function parseFixtureTranscript(transcript: string): ParsedTranscript {
  const lines = transcript.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const isWebVtt = lines[0]?.trim().toUpperCase() === 'WEBVTT';
  if (!isWebVtt) {
    const text = normalizeWhitespace(transcript);
    if (!text) throw new Error('Fixture transcript is empty');
    return { format: 'plain_text', text, cueCount: 0 };
  }

  const cueText: string[] = [];
  let cueCount = 0;
  let inMetadataBlock = false;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      inMetadataBlock = false;
      continue;
    }
    if (inMetadataBlock) continue;
    if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/i.test(line)) {
      inMetadataBlock = true;
      continue;
    }
    if (line.includes('-->')) {
      cueCount += 1;
      continue;
    }
    if (/^\d+$/.test(line) && lines[index + 1]?.includes('-->')) continue;
    cueText.push(line.replace(/<[^>]*>/g, ''));
  }

  const text = normalizeWhitespace(cueText.join(' '));
  if (!text) throw new Error('Fixture VTT transcript has no cue text');
  return { format: 'webvtt', text, cueCount };
}

/** Normalizes declared fixture metadata without discovering or mutating sources. */
export function normalizeFixtureSource(manifest: FixtureManifest): NormalizedFixtureSource {
  const source = manifest.source;
  return {
    system: source.system.trim(),
    nativeId: source.nativeId.trim(),
    acquisitionMode: manifest.acquisitionMode,
    meetingId: source.meetingId?.trim() || null,
    organiser: source.organiser?.trim().toLowerCase() || null,
    eventStart: source.eventStart ?? null,
    eventEnd: source.eventEnd ?? null,
  };
}

/**
 * Produces the stable, evidence-only input to the model adapter. Configuration
 * and source metadata are immutable fixture data; no external lookup occurs.
 */
export function buildNormalizationInput(
  manifest: FixtureManifest,
  transcript: string,
): { source: NormalizedFixtureSource; transcript: ParsedTranscript } {
  return {
    source: normalizeFixtureSource(manifest),
    transcript: parseFixtureTranscript(transcript),
  };
}
