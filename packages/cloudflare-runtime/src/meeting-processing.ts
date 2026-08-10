import type { Env, MeetingOutput, TranscriptSubmission, TopicRecord, PersonRecord, ActionRecord, DecisionRecord } from './types';
import {
  CONTRACT_VERSION,
  RUNTIME_VERSION,
  CLASSIFICATION_PROMPT_VERSION,
  CLASSIFICATION_ENGINE_VERSION,
  TOPIC_MATCHING_VERSION,
  NORMALISATION_VERSION,
  TAXONOMY_V02,
} from './types';

const OPENAI_API_VERSION = '2024-02-15-preview';

function extractJsonBlock(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  return trimmed;
}

function parseJsonResponse(content: string): unknown {
  const candidate = extractJsonBlock(content);
  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Invalid JSON from LLM response: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function ensureArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value as T];
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value.trim();
}

function validateVocabularyValue(value: unknown, validValues: readonly string[]): string | null {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  return validValues.includes(normalized) ? normalized : null;
}

function buildEvidenceAssertions(
  assertions: unknown,
  prefix: string,
): { id: string; text: string }[] {
  const items = ensureArray<{ id?: string; text?: string }>(assertions);
  return items.map((item, index) => ({
    id: `${prefix}-${index + 1}`,
    text: normalizeString(item?.text) ?? '',
  }));
}

function normalizeTopic(
  raw: unknown,
  meetingId: string,
  index: number,
): TopicRecord {
  const topic = (raw as Partial<TopicRecord>) || {};
  const warnings: string[] = [];

  const domain = validateVocabularyValue(topic.domain, TAXONOMY_V02.domains);
  if (topic.domain && domain === null) warnings.push('Invalid domain');

  const entityType = validateVocabularyValue(topic.entityType, TAXONOMY_V02.entityTypes);
  if (topic.entityType && entityType === null) warnings.push('Invalid entityType');

  const aspect = validateVocabularyValue(topic.aspect, TAXONOMY_V02.aspects);
  if (topic.aspect && aspect === null) warnings.push('Invalid aspect');

  const outcome = validateVocabularyValue(topic.outcome, TAXONOMY_V02.outcomes);
  if (topic.outcome && outcome === null) warnings.push('Invalid outcome');

  const disposition = validateVocabularyValue(topic.disposition, TAXONOMY_V02.dispositions);
  if (topic.disposition && disposition === null) warnings.push('Invalid disposition');

  const executiveScope = validateVocabularyValue(topic.executiveScope, TAXONOMY_V02.executiveScopes);
  if (topic.executiveScope && executiveScope === null) warnings.push('Invalid executiveScope');

  const topicId = normalizeString(topic.topicId) ?? `${meetingId}-topic-${index + 1}`;
  const topicStatement = normalizeString(topic.topicStatement) ?? '';
  if (!topicStatement) warnings.push('topicStatement is empty — required field');

  const keyFacts = buildEvidenceAssertions(topic.keyFacts, `${meetingId}-topic-${index + 1}-keyfact`);
  const decisions = buildEvidenceAssertions(topic.decisions, `${meetingId}-topic-${index + 1}-decision`);
  const actions = buildEvidenceAssertions(topic.actions, `${meetingId}-topic-${index + 1}-action`);
  const risks = buildEvidenceAssertions(topic.risks, `${meetingId}-topic-${index + 1}-risk`);

  return {
    topicId,
    domain,
    entityType,
    entity: normalizeString(topic.entity) ?? null,
    aspect,
    outcome,
    disposition,
    executiveScope,
    topicStatement,
    summary: normalizeString(topic.summary),
    keyFacts,
    decisions,
    actions,
    risks,
    owners: ensureArray<string>(topic.owners).map((owner, ownerIndex) => normalizeString(owner) ?? `owner-${ownerIndex + 1}`),
    confidence: normalizeString(topic.confidence),
    validation: {
      status: warnings.length ? 'warning' : (normalizeString(topic.validation?.status) as 'pass' | 'warning' | 'fail' | null) ?? 'pass',
      reasons: [...(Array.isArray(topic.validation?.reasons) ? (topic.validation?.reasons as string[]) : []), ...warnings],
    },
    memoryId: normalizeString(topic.memoryId) ?? undefined,
  };

}

function normalizePerson(raw: unknown, meetingId: string, index: number): PersonRecord {
  const person = (raw as Partial<PersonRecord>) || {};
  return {
    canonicalName: normalizeString(person.canonicalName),
    sourceName: normalizeString(person.sourceName) ?? '',
    attendance: normalizeString(person.attendance),
    contributions: buildEvidenceAssertions(person.contributions, `${meetingId}-person-${index + 1}-contribution`),
    topicIds: ensureArray<string>(person.topicIds).map((id, idx) => normalizeString(id) ?? `${meetingId}-topic-${idx + 1}`),
    actions: buildEvidenceAssertions(person.actions, `${meetingId}-person-${index + 1}-action`),
    decisionsOwned: buildEvidenceAssertions(person.decisionsOwned, `${meetingId}-person-${index + 1}-decision`),
    risksRaised: buildEvidenceAssertions(person.risksRaised, `${meetingId}-person-${index + 1}-risk`),
    stance: normalizeString(person.stance),
    unresolved: person.unresolved ?? false,
    personId: normalizeString((person as any).personId) ?? `${meetingId}-person-${index + 1}`,
  };
}

function normalizeAction(raw: unknown, meetingId: string, index: number): ActionRecord {
  const action = (raw as Partial<ActionRecord>) || {};
  return {
    actionId: normalizeString(action.actionId) ?? `${meetingId}-action-${index + 1}`,
    meetingId,
    topicId: normalizeString(action.topicId) ?? undefined,
    owner: normalizeString(action.owner),
    text: normalizeString(action.text) ?? '',
    dueDate: normalizeString(action.dueDate),
    status: (normalizeString(action.status) as 'open' | 'completed' | 'cancelled' | null) ?? 'open',
  };
}

function normalizeDecision(raw: unknown, meetingId: string, index: number): DecisionRecord {
  const decision = (raw as Partial<DecisionRecord>) || {};
  return {
    decisionId: normalizeString(decision.decisionId) ?? `${meetingId}-decision-${index + 1}`,
    meetingId,
    topicId: normalizeString(decision.topicId) ?? undefined,
    owner: normalizeString(decision.owner),
    text: normalizeString(decision.text) ?? '',
  };
}

function buildPrompt(submission: TranscriptSubmission, transcriptSha256: string): string {
  return `You are a structured meeting output generator. Use the following taxonomy vocabulary exactly when populating controlled vocabulary fields. If a value is outside the listed vocabulary, set that field to null and add a warning in the topic validation reasons.

Domains:
${TAXONOMY_V02.domains.map((item) => `- ${item}`).join('\n')}
EntityTypes:
${TAXONOMY_V02.entityTypes.map((item) => `- ${item}`).join('\n')}
Aspects:
${TAXONOMY_V02.aspects.map((item) => `- ${item}`).join('\n')}
Outcomes:
${TAXONOMY_V02.outcomes.map((item) => `- ${item}`).join('\n')}
Dispositions:
${TAXONOMY_V02.dispositions.map((item) => `- ${item}`).join('\n')}
ExecutiveScopes:
${TAXONOMY_V02.executiveScopes.map((item) => `- ${item}`).join('\n')}

Return a single JSON object with these top-level fields:
meetingId, sourceSystem, nativeId, subject, organiser, eventDate, transcriptSha256, processing, classification, summaryAssertions, topics, people, actions, decisions, validation.

For every topic, populate entityType from the controlled EntityTypes vocabulary and entity as the free-text, specific named instance being discussed.
REQUIRED: populate entity with the specific named thing being discussed (for example, "Reader 3", "M12 milestone", "Firmware 6.10", or "UK Education market"). Never leave entity null if a specific named entity is mentioned in the transcript.

REQUIRED: topicStatement must be a single complete sentence describing an enduring business condition. It must be specific, not generic. Good: "M12 integration testing is at risk due to Firmware 6.10 approval delays." Bad: "project risk". Never leave topicStatement empty.
REQUIRED: Every action item must have a non-empty text field describing exactly what needs to be done. Owner alone is not sufficient.
REQUIRED: Every decision must have a non-empty text field describing what was decided. Never leave text empty.

Use these topic field examples as a pattern. The classification values must be present in the taxonomy vocabulary above, while entity remains the exact named instance from the transcript:
- entityType: "Project", entity: "M12 milestone", aspect: "Schedule", outcome: "Risk", topicStatement: "M12 integration testing is at risk due to Firmware 6.10 approval delays."
- entityType: "Product", entity: "Reader 3", aspect: "Quality", outcome: "Issue", topicStatement: "Reader 3 quality validation remains blocked by unresolved defects."
- entityType: "Technology Platform", entity: "Firmware 6.10", aspect: "Compliance", outcome: "Delay", topicStatement: "Firmware 6.10 approval is delayed pending compliance sign-off."
- entityType: "Market", entity: "UK Education market", aspect: "Performance", outcome: "Opportunity", topicStatement: "The UK Education market presents a growth opportunity following increased customer demand."

Use these required shapes for top-level actions and decisions:
actions: [{
  id: 'string (e.g. ${submission.meetingId}-action-1)',
  text: 'REQUIRED non-empty string — what specifically needs to be done (e.g. "Confirm with Han Wang whether the cost increase can be reduced by negotiating volume commitments")',
  owner: 'string|null — canonical name of the person responsible',
  topicId: 'string|null',
}],
decisions: [{
  id: 'string (e.g. ${submission.meetingId}-decision-1)',
  text: 'REQUIRED non-empty string — what was decided (e.g. "Reader 3 price will increase by £20 in September to recover Han Wang cost increase")',
  owner: 'string|null — canonical name of the decision owner',
  topicId: 'string|null',
}],

The IDs for topics, people, actions, decisions, and evidence assertions must be deterministic and based on meetingId and the position index. Example: ${submission.meetingId}-topic-1, ${submission.meetingId}-action-1.

Respond with JSON only. Do not include any explanation or markdown outside code fences. If you need to wrap the JSON in markdown, it is acceptable to use \`\`\`json ... \`\`\`.

Input:
meetingId: ${submission.meetingId}
sourceSystem: ${submission.sourceSystem}
nativeId: ${submission.nativeId}
subject: ${submission.subject}
organiser: ${submission.organiser}
eventDate: ${submission.eventDate}
transcriptSha256: ${transcriptSha256}
transcript:
${submission.transcript}
`;
}

function buildMeetingOutput(parsed: unknown, submission: TranscriptSubmission, transcriptSha256: string, env: Pick<Env, 'AZURE_OPENAI_DEPLOYMENT'>): MeetingOutput {
  const raw = (parsed as Partial<MeetingOutput>) || {};
  const meetingId = submission.meetingId;

  const topics = ensureArray<unknown>(raw.topics).map((topic, index) => normalizeTopic(topic, meetingId, index));
  const people = ensureArray<unknown>(raw.people).map((person, index) => normalizePerson(person, meetingId, index));
  const actions = ensureArray<unknown>(raw.actions).map((action, index) => normalizeAction(action, meetingId, index));
  const decisions = ensureArray<unknown>(raw.decisions).map((decision, index) => normalizeDecision(decision, meetingId, index));
  const summaryAssertions = buildEvidenceAssertions(raw.summaryAssertions ?? [], `${meetingId}-summary`);
  const actionWarnings = actions
    .filter((action) => !action.text)
    .map((action) => `action ${action.actionId} has empty text — required field`);
  const decisionWarnings = decisions
    .filter((decision) => !decision.text)
    .map((decision) => `decision ${decision.decisionId} has empty text — required field`);
  const validationReasons = [
    ...ensureArray<string>(raw.validation?.reasons).map((reason) => normalizeString(reason) ?? '').filter(Boolean),
    ...actionWarnings,
    ...decisionWarnings,
  ];
  const validationStatus = validationReasons.length > 0
    ? 'warning'
    : (normalizeString(raw.validation?.status) as 'pass' | 'warning' | 'fail' | null) ?? 'pass';

  return {
    meetingId,
    sourceSystem: submission.sourceSystem,
    nativeId: submission.nativeId,
    subject: submission.subject,
    organiser: submission.organiser,
    eventDate: submission.eventDate,
    transcriptSha256,
    processing: {
      runtime: 'cloudflare',
      runtimeVersion: RUNTIME_VERSION,
      contractVersion: CONTRACT_VERSION,
      classificationPromptVersion: CLASSIFICATION_PROMPT_VERSION,
      classificationEngineVersion: CLASSIFICATION_ENGINE_VERSION,
      topicMatchingVersion: TOPIC_MATCHING_VERSION,
      normalisationVersion: NORMALISATION_VERSION,
      model: env.AZURE_OPENAI_DEPLOYMENT,
      deployment: env.AZURE_OPENAI_DEPLOYMENT,
    },
    classification: {
      mode: normalizeString(raw.classification?.mode),
      confidence: normalizeString(raw.classification?.confidence),
    },
    summaryAssertions,
    topics,
    people,
    actions,
    decisions,
    validation: {
      status: validationStatus,
      reasons: validationReasons,
    },
  };
}

export async function processMeeting(
  submission: TranscriptSubmission,
  transcriptSha256: string,
  env: Pick<Env, 'AZURE_OPENAI_ENDPOINT' | 'AZURE_OPENAI_DEPLOYMENT' | 'AZURE_OPENAI_API_KEY'>,
): Promise<MeetingOutput> {
  const prompt = buildPrompt(submission, transcriptSha256);
  const resourceRoot = env.AZURE_OPENAI_ENDPOINT.replace(/\/openai(?:\/v\d+)?$/i, '');
  const url = `${resourceRoot}/openai/deployments/${encodeURIComponent(env.AZURE_OPENAI_DEPLOYMENT)}/chat/completions?api-version=${OPENAI_API_VERSION}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.AZURE_OPENAI_API_KEY,
      Accept: 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a JSON-only meeting summarization assistant.' },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: 8000,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`LLM request failed with status ${response.status}: ${bodyText}`);
  }

  const responseBody = await response.json().catch((error) => {
    throw new Error(`Unable to parse LLM response as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }) as any;

  const message = (responseBody?.choices?.[0]?.message?.content ?? responseBody?.choices?.[0]?.text) as string | undefined;
  if (!message) {
    throw new Error('LLM response did not contain a message content field');
  }

  const parsed = parseJsonResponse(message);
  return buildMeetingOutput(parsed, submission, transcriptSha256, env);
}
