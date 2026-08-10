import { afterEach, describe, expect, test, vi } from 'vitest';
import { CONTRACT_VERSION, CLASSIFICATION_PROMPT_VERSION, CLASSIFICATION_ENGINE_VERSION, NORMALISATION_VERSION, TOPIC_MATCHING_VERSION, RUNTIME_VERSION } from './types';
import { processMeeting } from './meeting-processing';

const submission = {
  meetingId: '2026-08-07_0900_sales_call',
  sourceSystem: 'azure',
  nativeId: 'meeting-12345',
  subject: 'Sales review',
  organiser: 'peter@example.com',
  eventDate: '2026-08-07T09:00:00Z',
  transcript: 'This is a valid transcript text with enough length to pass validation and generate output.',
} as const;

const env = {
  AZURE_OPENAI_ENDPOINT: 'https://example.com',
  AZURE_OPENAI_DEPLOYMENT: 'test-deployment',
  AZURE_OPENAI_API_KEY: 'test-key',
};

function makeOpenAIResponse(message: string) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ choices: [{ message: { content: message } }] }),
    text: vi.fn().mockResolvedValue(message),
  };
}

function stubFetch(response: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('processMeeting', () => {
  test('AC1 valid response produces meeting output with processing metadata', async () => {
    const message = JSON.stringify({
      meetingId: submission.meetingId,
      sourceSystem: submission.sourceSystem,
      nativeId: submission.nativeId,
      subject: submission.subject,
      organiser: submission.organiser,
      eventDate: submission.eventDate,
      transcriptSha256: 'abc123',
      processing: {},
      classification: { mode: 'test', confidence: '0.9' },
      summaryAssertions: [],
      topics: [
        { topicId: `${submission.meetingId}-topic-1`, domain: 'Finance', entityType: 'Project', entity: 'Reader 3', aspect: 'Schedule', topicStatement: 'Reader 3 schedule is delayed', keyFacts: [], decisions: [], actions: [], risks: [], owners: [], confidence: null, validation: { status: 'pass', reasons: [] } },
      ],
      people: [],
      actions: [
        { actionId: `${submission.meetingId}-action-1`, meetingId: submission.meetingId, owner: 'Alice', text: 'Follow up with product team', dueDate: null, status: 'open' },
      ],
      decisions: [],
      validation: { status: 'pass', reasons: [] },
    });

    stubFetch(makeOpenAIResponse(message));

    const output = await processMeeting(submission, 'abc123', env);

    expect(output.processing.runtime).toBe('cloudflare');
    expect(output.processing.runtimeVersion).toBe(RUNTIME_VERSION);
    expect(output.processing.contractVersion).toBe(CONTRACT_VERSION);
    expect(output.processing.classificationPromptVersion).toBe(CLASSIFICATION_PROMPT_VERSION);
    expect(output.processing.classificationEngineVersion).toBe(CLASSIFICATION_ENGINE_VERSION);
    expect(output.processing.topicMatchingVersion).toBe(TOPIC_MATCHING_VERSION);
    expect(output.processing.normalisationVersion).toBe(NORMALISATION_VERSION);
    expect(output.processing.model).toBe(env.AZURE_OPENAI_DEPLOYMENT);
    expect(output.processing.deployment).toBe(env.AZURE_OPENAI_DEPLOYMENT);

    const request = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const prompt = JSON.parse(request.body as string).messages[1].content as string;
    expect(prompt).toContain('Never leave entity null if a specific named entity is mentioned in the transcript.');
    expect(prompt).toContain('Never leave topicStatement empty.');
    expect(prompt).toContain('REQUIRED: Every action item must have a non-empty text field describing exactly what needs to be done. Owner alone is not sufficient.');
    expect(prompt).toContain('REQUIRED: Every decision must have a non-empty text field describing what was decided. Never leave text empty.');
    expect(prompt).toContain('REQUIRED non-empty string — what specifically needs to be done');
    expect(prompt).toContain('REQUIRED non-empty string — what was decided');
    expect(prompt).toContain('entity: "Reader 3"');
    expect(prompt).toContain('M12 integration testing is at risk due to Firmware 6.10 approval delays.');
  });

  test('AC2 invalid vocabulary values are null and warning is added', async () => {
    const message = JSON.stringify({
      meetingId: submission.meetingId,
      sourceSystem: submission.sourceSystem,
      nativeId: submission.nativeId,
      subject: submission.subject,
      organiser: submission.organiser,
      eventDate: submission.eventDate,
      transcriptSha256: 'abc123',
      processing: {},
      classification: { mode: 'test', confidence: '0.9' },
      summaryAssertions: [],
      topics: [
        { topicId: `${submission.meetingId}-topic-1`, domain: 'Finance', entityType: 'InvalidType', entity: 'Reader 3', aspect: 'Schedule', topicStatement: 'Reader 3 schedule is delayed', keyFacts: [], decisions: [], actions: [], risks: [], owners: [], confidence: null, validation: { status: 'pass', reasons: [] } },
      ],
      people: [],
      actions: [],
      decisions: [],
      validation: { status: 'pass', reasons: [] },
    });

    stubFetch(makeOpenAIResponse(message));

    const output = await processMeeting(submission, 'abc123', env);
    expect(output.topics[0].entityType).toBeNull();
    expect(output.topics[0].validation.status).toBe('warning');
    expect(output.topics[0].validation.reasons.some((reason) => reason.includes('Invalid entityType'))).toBe(true);
  });

  test('empty topicStatement produces a validation warning', async () => {
    const message = JSON.stringify({
      topics: [{ entityType: 'Project', entity: 'M12 milestone', topicStatement: '', keyFacts: [], decisions: [], actions: [], risks: [], owners: [], validation: { status: 'pass', reasons: [] } }],
      people: [], actions: [], decisions: [], summaryAssertions: [], validation: { status: 'pass', reasons: [] },
    });
    stubFetch(makeOpenAIResponse(message));

    const output = await processMeeting(submission, 'abc123', env);
    expect(output.topics[0].topicStatement).toBe('');
    expect(output.topics[0].validation.status).toBe('warning');
    expect(output.topics[0].validation.reasons).toContain('topicStatement is empty — required field');
  });

  test('empty action and decision text produce meeting validation warnings', async () => {
    const message = JSON.stringify({
      topics: [],
      people: [],
      actions: [{ actionId: `${submission.meetingId}-action-1`, owner: 'Alice', text: '' }],
      decisions: [{ decisionId: `${submission.meetingId}-decision-1`, owner: 'Bob', text: '  ' }],
      summaryAssertions: [],
      validation: { status: 'pass', reasons: [] },
    });
    stubFetch(makeOpenAIResponse(message));

    const output = await processMeeting(submission, 'abc123', env);

    expect(output.actions[0].text).toBe('');
    expect(output.decisions[0].text).toBe('');
    expect(output.validation.status).toBe('warning');
    expect(output.validation.reasons).toEqual([
      `action ${submission.meetingId}-action-1 has empty text — required field`,
      `decision ${submission.meetingId}-decision-1 has empty text — required field`,
    ]);
  });

  test('AC3 fenced JSON response is extracted correctly', async () => {
    const payload = {
      meetingId: submission.meetingId,
      sourceSystem: submission.sourceSystem,
      nativeId: submission.nativeId,
      subject: submission.subject,
      organiser: submission.organiser,
      eventDate: submission.eventDate,
      transcriptSha256: 'abc123',
      processing: {},
      classification: { mode: 'test', confidence: '0.9' },
      summaryAssertions: [],
      topics: [],
      people: [],
      actions: [],
      decisions: [],
      validation: { status: 'pass', reasons: [] },
    };
    const message = '```json\n' + JSON.stringify(payload) + '\n```';
    stubFetch(makeOpenAIResponse(message));

    const output = await processMeeting(submission, 'abc123', env);
    expect(output.meetingId).toBe(submission.meetingId);
  });

  test('AC4 invalid JSON causes a thrown error containing Invalid JSON', async () => {
    stubFetch(makeOpenAIResponse('not json at all'));
    await expect(processMeeting(submission, 'abc123', env)).rejects.toThrow(/Invalid JSON/);
  });

  test('AC5 topic IDs are deterministic when three topics are returned', async () => {
    const message = JSON.stringify({
      meetingId: submission.meetingId,
      sourceSystem: submission.sourceSystem,
      nativeId: submission.nativeId,
      subject: submission.subject,
      organiser: submission.organiser,
      eventDate: submission.eventDate,
      transcriptSha256: 'abc123',
      processing: {},
      classification: { mode: 'test', confidence: '0.9' },
      summaryAssertions: [],
      topics: [
        { topicId: `${submission.meetingId}-topic-1`, domain: 'Finance', entityType: 'Project', entity: 'Reader 3', aspect: 'Schedule', topicStatement: 'First', keyFacts: [], decisions: [], actions: [], risks: [], owners: [], confidence: null, validation: { status: 'pass', reasons: [] } },
        { topicId: `${submission.meetingId}-topic-2`, domain: 'Finance', entityType: 'Project', entity: 'Reader 3', aspect: 'Schedule', topicStatement: 'Second', keyFacts: [], decisions: [], actions: [], risks: [], owners: [], confidence: null, validation: { status: 'pass', reasons: [] } },
        { topicId: `${submission.meetingId}-topic-3`, domain: 'Finance', entityType: 'Project', entity: 'Reader 3', aspect: 'Schedule', topicStatement: 'Third', keyFacts: [], decisions: [], actions: [], risks: [], owners: [], confidence: null, validation: { status: 'pass', reasons: [] } },
      ],
      people: [],
      actions: [],
      decisions: [],
      validation: { status: 'pass', reasons: [] },
    });
    stubFetch(makeOpenAIResponse(message));

    const output = await processMeeting(submission, 'abc123', env);
    expect(output.topics.map((topic) => topic.topicId)).toEqual([
      `${submission.meetingId}-topic-1`,
      `${submission.meetingId}-topic-2`,
      `${submission.meetingId}-topic-3`,
    ]);
  });

  test('AC6 action IDs are deterministic when two actions are returned', async () => {
    const message = JSON.stringify({
      meetingId: submission.meetingId,
      sourceSystem: submission.sourceSystem,
      nativeId: submission.nativeId,
      subject: submission.subject,
      organiser: submission.organiser,
      eventDate: submission.eventDate,
      transcriptSha256: 'abc123',
      processing: {},
      classification: { mode: 'test', confidence: '0.9' },
      summaryAssertions: [],
      topics: [],
      people: [],
      actions: [
        { actionId: `${submission.meetingId}-action-1`, meetingId: submission.meetingId, owner: 'Alice', text: 'Do first thing', dueDate: null, status: 'open' },
        { actionId: `${submission.meetingId}-action-2`, meetingId: submission.meetingId, owner: 'Bob', text: 'Do second thing', dueDate: null, status: 'open' },
      ],
      decisions: [],
      validation: { status: 'pass', reasons: [] },
    });
    stubFetch(makeOpenAIResponse(message));

    const output = await processMeeting(submission, 'abc123', env);
    expect(output.actions.map((action) => action.actionId)).toEqual([
      `${submission.meetingId}-action-1`,
      `${submission.meetingId}-action-2`,
    ]);
  });
});
