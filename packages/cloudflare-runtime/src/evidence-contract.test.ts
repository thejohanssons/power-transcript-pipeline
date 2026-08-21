import { afterEach, describe, expect, test, vi } from 'vitest';
import { processMeeting } from './meeting-processing';

const submission = {
  meetingId: 'evidence-contract-meeting',
  sourceSystem: 'azure',
  nativeId: 'evidence-contract-native',
  subject: 'Evidence contract test',
  organiser: 'test@example.com',
  eventDate: '2026-08-20T08:00:00Z',
  transcript: 'This transcript contains enough grounded detail to test the evidence contract for a topic.',
};

const env = {
  AZURE_OPENAI_ENDPOINT: 'https://example.com',
  AZURE_OPENAI_DEPLOYMENT: 'test-deployment',
  AZURE_OPENAI_API_KEY: 'test-key',
};

function mockLlm(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    text: vi.fn().mockResolvedValue(''),
  }));
}

function basePayload(topic: Record<string, unknown>) {
  return {
    ...submission,
    transcriptSha256: 'sha',
    processing: {},
    classification: { mode: 'test', confidence: 'high' },
    summaryAssertions: [],
    topics: [topic],
    people: [],
    actions: [],
    decisions: [],
    validation: { status: 'pass', reasons: [] },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('evidence-complete meeting output', () => {
  test('flags a topic with no grounded key fact', async () => {
    mockLlm(basePayload({
      topicId: 'evidence-contract-meeting-topic-1',
      domain: 'Product Management',
      entityType: 'Technology Platform',
      entity: 'Inspire QR-login camera',
      aspect: 'Quality',
      outcome: 'Issue',
      disposition: 'Deferral',
      topicStatement: 'The Inspire camera can freeze when reopened.',
      keyFacts: [],
      decisions: [],
      actions: [],
      risks: [],
      validation: { status: 'pass', reasons: [] },
    }));

    const output = await processMeeting(submission, 'sha', env);

    expect(output.topics[0].validation.status).toBe('warning');
    expect(output.topics[0].validation.reasons).toContain(
      'keyFacts is empty — at least one grounded fact is required for every topic',
    );
    expect(output.validation.status).toBe('warning');
    expect(output.validation.reasons.some((reason) => reason.includes('keyFacts is empty'))).toBe(true);
  });

  test('preserves grounded facts and supported evidence types', async () => {
    mockLlm(basePayload({
      topicId: 'evidence-contract-meeting-topic-1',
      domain: 'Product Management',
      entityType: 'Technology Platform',
      entity: 'Inspire QR-login camera',
      aspect: 'Performance',
      outcome: 'Risk',
      disposition: 'Deferral',
      topicStatement: 'The Inspire camera workaround is deferred until post-MVP remediation.',
      keyFacts: [{ id: 'fact-1', text: 'The camera feed freezes when reopened in the same browser.' }],
      decisions: [{ id: 'decision-1', text: 'Use a browser refresh as the interim workaround.' }],
      actions: [{ id: 'action-1', text: 'Document the browser-refresh flow.' }],
      risks: [{ id: 'risk-1', text: 'The workaround may interrupt web QR login.' }],
      validation: { status: 'pass', reasons: [] },
    }));

    const output = await processMeeting(submission, 'sha', env);
    const topic = output.topics[0];

    expect(topic.validation.status).toBe('pass');
    expect(topic.keyFacts).toHaveLength(1);
    expect(topic.decisions).toHaveLength(1);
    expect(topic.actions).toHaveLength(1);
    expect(topic.risks).toHaveLength(1);
    expect(output.validation.status).toBe('pass');
  });
});
