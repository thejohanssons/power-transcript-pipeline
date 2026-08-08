import { describe, expect, it } from 'vitest';
import { isTranscriptSubmission } from './validation';

describe('TranscriptSubmission validation', () => {
  it('accepts a valid submission', () => {
    const valid = {
      meetingId: '2026-08-07_0900_sales_call',
      sourceSystem: 'azure',
      nativeId: 'meeting-12345',
      subject: 'Sales review',
      organiser: 'peter@example.com',
      eventDate: '2026-08-07T09:00:00Z',
      transcript: 'Speaker: Hello world. This transcript is intentionally long enough to meet the 50-character minimum requirement.',
    };

    expect(isTranscriptSubmission(valid)).toBe(true);
  });

  it('rejects an invalid submission missing fields', () => {
    const invalid = {
      meetingId: '2026-08-07_0900_sales_call',
      sourceSystem: 'azure',
      nativeId: 'meeting-12345',
      subject: 'Sales review',
      organiser: '',
      eventDate: '2026-08-07T09:00:00Z',
    };

    expect(isTranscriptSubmission(invalid)).toBe(false);
  });

  it('rejects invalid event date format', () => {
    const invalidDate = {
      meetingId: '2026-08-07_0900_sales_call',
      sourceSystem: 'azure',
      nativeId: 'meeting-12345',
      subject: 'Sales review',
      organiser: 'peter@example.com',
      eventDate: 'not-a-date',
      transcript: 'Speaker: Hello world. This transcript is intentionally long enough to meet the 50-character minimum requirement.',
    };

    expect(isTranscriptSubmission(invalidDate)).toBe(false);
  });

  it('rejects unsafe meetingId values', () => {
    const invalidMeetingId = {
      meetingId: '../unsafe/path',
      sourceSystem: 'azure',
      nativeId: 'meeting-12345',
      subject: 'Sales review',
      organiser: 'peter@example.com',
      eventDate: '2026-08-07T09:00:00Z',
      transcript: 'Speaker: Hello world. This transcript is intentionally long enough to meet the 50-character minimum requirement.',
    };

    expect(isTranscriptSubmission(invalidMeetingId)).toBe(false);
  });

  it('rejects a too-short transcript', () => {
    const invalidTranscript = {
      meetingId: '2026-08-07_0900_sales_call',
      sourceSystem: 'azure',
      nativeId: 'meeting-12345',
      subject: 'Sales review',
      organiser: 'peter@example.com',
      eventDate: '2026-08-07T09:00:00Z',
      transcript: 'Too short',
    };

    expect(isTranscriptSubmission(invalidTranscript)).toBe(false);
  });
});
