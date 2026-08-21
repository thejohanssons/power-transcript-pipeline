import type { Env, EvidenceAssertion, MeetingOutput, TranscriptSubmission, TopicRecord, PersonRecord, ActionRecord, DecisionRecord } from './types';
import { fixedTopicEvidenceInput, mergeFixedTopicEvidence, type FixedTopicContext } from './topic-enrichment';
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

export function correctTechnicalDeliveryRiskClassification(topic: {
  entityType: string | null;
  entity: string | null;
  topicStatement: string;
  summary: string | null;
  keyFacts: EvidenceAssertion[];
  outcome: string | null;
  disposition: string | null;
  domain: string | null;
  aspect: string | null;
}): Pick<typeof topic, 'domain' | 'aspect' | 'outcome' | 'disposition'> & { entityType: string | null } {
  const evidenceText = [
    topic.entity,
    topic.topicStatement,
    topic.summary,
    ...topic.keyFacts.map((fact) => fact.text),
  ].filter(Boolean).join(' ');
  const technicalEntity = topic.entityType === 'Technology Platform' || topic.entityType === 'Service';
  const deliverySignal = /at risk|blocked|blocker|freeze|frozen|workaround|defer|deferred|mvp|release|launch|delivery|remediation|dependency/i.test(evidenceText);

  const productTechnicalCapability = /camera|firmware|software|sdk|web application|web app|flutter|browser|integration|technical platform|product feature/i.test(evidenceText);
  const correctedEntityType = topic.entityType === 'Service' && productTechnicalCapability
    ? 'Technology Platform'
    : topic.entityType;

  if (!technicalEntity || !deliverySignal) {
    return {
      entityType: correctedEntityType,
      domain: topic.domain,
      aspect: topic.aspect,
      outcome: topic.outcome,
      disposition: topic.disposition,
    };
  }

  return {
    entityType: correctedEntityType,
    domain: 'Product Management',
    aspect: topic.aspect === 'Quality' ? 'Performance' : topic.aspect,
    outcome: 'Risk',
    disposition: /workaround|defer|deferred|mvp/i.test(evidenceText) ? 'Deferral' : topic.disposition,
  };
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
  if (keyFacts.length === 0) {
    warnings.push('keyFacts is empty — at least one grounded fact is required for every topic');
  }
  const entity = normalizeString(topic.entity) ?? null;
  const normalizedTopicStatement = topicStatement;
  const correctedClassification = correctTechnicalDeliveryRiskClassification({
    domain,
    entityType,
    entity,
    aspect,
    outcome,
    disposition,
    topicStatement: normalizedTopicStatement,
    summary: normalizeString(topic.summary),
    keyFacts,
  });

  return {
    topicId,
    domain: correctedClassification.domain,
    entityType,
    entity,
    aspect: correctedClassification.aspect,
    outcome: correctedClassification.outcome,
    disposition: correctedClassification.disposition,
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

function buildPrompt(submission: TranscriptSubmission, transcriptSha256: string, fixedTopics?: FixedTopicContext[], evidenceOnly = false): string {
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
ENTITY TYPE GUIDANCE: Use "Technology Platform" for software, firmware, SDKs, web applications, camera subsystems, integrations, and technical product capabilities. Use "Service" only for an explicitly named business, operational, or externally delivered service. Do not classify a product feature or technical capability as "Service" merely because it provides functionality.
CLASSIFICATION GUIDANCE: Engineering, software, platform, camera, SDK, integration, release-blocker, workaround, freeze, and other implementation constraints affecting a product are Product Management concerns. When they threaten delivery, require a workaround, block an MVP/release, or are deferred for later remediation, classify them as outcome "Risk" rather than "Issue", use aspect "Performance" rather than "Quality" where appropriate, and use disposition "Deferral" when the workaround or remediation is explicitly deferred.
REQUIRED: populate entity with the specific named thing being discussed (for example, "Reader 3", "M12 milestone", "Firmware 6.10", or "UK Education market"). Never leave entity null if a specific named entity is mentioned in the transcript.

REQUIRED: topicStatement must be a single complete sentence describing an enduring business condition. It must be specific, not generic. Good: "M12 integration testing is at risk due to Firmware 6.10 approval delays." Bad: "project risk". Never leave topicStatement empty.
EVIDENCE REQUIREMENT: Every topic must contain at least one grounded key fact in keyFacts. The key fact must be directly supported by the transcript and must explain the concrete condition being classified. Do not return an empty keyFacts array when the topic has been created.
EVIDENCE SHAPES: keyFacts, decisions, actions, and risks are arrays of objects with deterministic id and non-empty text fields. Include decisions, actions, and risks when the transcript supports them; use an empty array only when that evidence type is genuinely absent. Never invent evidence, and never use the topic title as a substitute for evidence text.
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

${fixedTopics && fixedTopics.length > 0 ? `EVIDENCE-ONLY ENRICHMENT MODE: The following topics already exist in D1. Return exactly this topic set, with exactly these topicId values. Do not create, delete, merge, split, rename, or reclassify topics. Generate only grounded evidence and summary enrichment for each supplied topic. Preserve the supplied topic statement and topic identity; apply only the controlled classification corrections defined above. Fixed topics:\n${fixedTopicEvidenceInput(fixedTopics)}\n` : ''}
${evidenceOnly ? 'SAFE EVIDENCE MODE: This is a transcript segment, not the full meeting. Return evidence only for supplied topics supported by this segment. It is valid for a topic to have empty evidence in this segment. Do not reproduce sensitive wording; paraphrase neutral factual project context and return no raw transcript text.\n' : ''}
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

export interface ProcessMeetingOptions {
  fixedTopics?: FixedTopicContext[];
  evidenceOnly?: boolean;
}

function buildMeetingOutput(
  parsed: unknown,
  submission: TranscriptSubmission,
  transcriptSha256: string,
  env: Pick<Env, 'AZURE_OPENAI_DEPLOYMENT'>,
  options?: ProcessMeetingOptions,
): MeetingOutput {
  const raw = (parsed as Partial<MeetingOutput>) || {};
  const meetingId = submission.meetingId;
  const rawTopics = ensureArray<Record<string, unknown>>(raw.topics);
  const topicInputs = options?.fixedTopics
    ? options.fixedTopics.map((fixed) => {
      const generated = rawTopics.find((topic) => topic.topicId === fixed.topicId);
      return mergeFixedTopicEvidence(generated, fixed);
    })
    : rawTopics;
  const topics = topicInputs.map((topic, index) => {
    const normalized = normalizeTopic(topic, meetingId, index);
    if (options?.evidenceOnly && normalized.keyFacts.length === 0) {
      normalized.validation = {
        ...normalized.validation,
        reasons: normalized.validation.reasons.filter((reason) => !reason.includes('keyFacts is empty')),
        status: normalized.validation.reasons.some((reason) => !reason.includes('keyFacts is empty')) ? 'warning' : 'pass',
      };
    }
    const fixed = options?.fixedTopics?.[index];
    return fixed ? {
      ...normalized,
      topicId: fixed.topicId,
      domain: fixed.domain,
      entityType: normalized.entityType,
      entity: fixed.entity,
      aspect: normalized.aspect,
      outcome: normalized.outcome,
      disposition: normalized.disposition,
      executiveScope: fixed.executiveScope,
      topicStatement: fixed.topicStatement,
      owners: fixed.owners,
      confidence: fixed.confidence,
      memoryId: fixed.memoryId,
    } : normalized;
  });
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
  const topicWarnings = topics.flatMap((topic) =>
    topic.validation.reasons.map((reason) => `${topic.topicId}: ${reason}`));
  const validationReasons = [
    ...ensureArray<string>(raw.validation?.reasons).map((reason) => normalizeString(reason) ?? '').filter(Boolean),
    ...topicWarnings,
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
  options?: ProcessMeetingOptions,
): Promise<MeetingOutput> {
  const prompt = buildPrompt(submission, transcriptSha256, options?.fixedTopics, options?.evidenceOnly);
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
    const choice = responseBody?.choices?.[0];
    const responseShape = choice && typeof choice === 'object' ? Object.keys(choice).join(',') : 'no-choice';
    throw new Error(`LLM response did not contain a message content field (status=${response.status}, choiceKeys=${responseShape})`);
  }

  const parsed = parseJsonResponse(message);
  return buildMeetingOutput(parsed, submission, transcriptSha256, env);
}
