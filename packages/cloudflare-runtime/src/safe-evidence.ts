import { processMeeting } from './meeting-processing';
import type { FixedTopicContext } from './topic-enrichment';
import type { Env, EvidenceAssertion, MeetingOutput, TranscriptSubmission } from './types';

const CHUNK_SIZE = 12000;
const CHUNK_OVERLAP = 500;
const CHUNK_CONCURRENCY = 3;

export interface SafeEvidenceResult {
  output: MeetingOutput;
  filteredChunks: number;
  chunksProcessed: number;
}

export function splitTranscriptForSafeEvidence(transcript: string): string[] {
  if (transcript.length <= CHUNK_SIZE) return [transcript];
  const chunks: string[] = [];
  let start = 0;
  while (start < transcript.length) {
    const end = Math.min(transcript.length, start + CHUNK_SIZE);
    chunks.push(transcript.slice(start, end));
    if (end === transcript.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function mergeAssertions(existing: EvidenceAssertion[], additions: EvidenceAssertion[]): EvidenceAssertion[] {
  const seen = new Set(existing.map((item) => item.text.trim().toLowerCase()));
  const merged = [...existing];
  for (const item of additions) {
    const key = item.text.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export async function processSafeEvidenceMeeting(
  submission: TranscriptSubmission,
  transcriptSha256: string,
  env: Pick<Env, 'AZURE_OPENAI_ENDPOINT' | 'AZURE_OPENAI_DEPLOYMENT' | 'AZURE_OPENAI_API_KEY'>,
  fixedTopics: FixedTopicContext[],
): Promise<SafeEvidenceResult> {
  const chunks = splitTranscriptForSafeEvidence(submission.transcript);
  const evidence = new Map<string, { keyFacts: EvidenceAssertion[]; decisions: EvidenceAssertion[]; actions: EvidenceAssertion[]; risks: EvidenceAssertion[] }>();
  for (const topic of fixedTopics) {
    evidence.set(topic.topicId, { keyFacts: [], decisions: [], actions: [], risks: [] });
  }

  let baseOutput: MeetingOutput | null = null;
  let filteredChunks = 0;
  let chunksProcessed = 0;
  for (let offset = 0; offset < chunks.length; offset += CHUNK_CONCURRENCY) {
    const chunkResults = await Promise.all(chunks.slice(offset, offset + CHUNK_CONCURRENCY).map(async (chunk) => {
      try {
        return {
          output: await processMeeting(
            { ...submission, transcript: chunk },
            transcriptSha256,
            env,
            { fixedTopics, evidenceOnly: true },
          ),
          filtered: false,
        };
      } catch {
        return { output: null, filtered: true };
      }
    }));

    for (const chunkResult of chunkResults) {
      if (chunkResult.filtered || !chunkResult.output) {
        filteredChunks += 1;
        continue;
      }
      baseOutput ??= chunkResult.output;
      chunksProcessed += 1;
      for (const topic of chunkResult.output.topics) {
        const target = evidence.get(topic.topicId);
        if (!target) continue;
        target.keyFacts = mergeAssertions(target.keyFacts, topic.keyFacts);
        target.decisions = mergeAssertions(target.decisions, topic.decisions);
        target.actions = mergeAssertions(target.actions, topic.actions);
        target.risks = mergeAssertions(target.risks, topic.risks);
      }
    }
  }

  if (!baseOutput) {
    throw new Error(`safe evidence extraction failed for all ${chunks.length} transcript chunks`);
  }

  const topics = baseOutput.topics.map((topic) => {
    const merged = evidence.get(topic.topicId);
    if (!merged) return topic;
    const reasons = merged.keyFacts.length > 0
      ? topic.validation.reasons.filter((reason) => !reason.includes('keyFacts is empty'))
      : [...topic.validation.reasons.filter((reason) => !reason.includes('keyFacts is empty')), 'safe evidence extraction produced no grounded key fact'];
    return {
      ...topic,
      keyFacts: merged.keyFacts,
      decisions: merged.decisions,
      actions: merged.actions,
      risks: merged.risks,
      validation: {
        status: (reasons.length > 0 ? 'warning' : 'pass') as 'pass' | 'warning',
        reasons,
      },
    };
  });

  return {
    output: {
      ...baseOutput,
      topics,
      validation: {
        status: topics.every((topic) => topic.keyFacts.length > 0) && baseOutput.validation.status === 'pass' ? 'pass' : 'warning',
        reasons: topics.flatMap((topic) => topic.validation.reasons.map((reason) => `${topic.topicId}: ${reason}`)),
      },
    },
    filteredChunks,
    chunksProcessed,
  };
}
