import type { TranscriptSubmission } from './types';

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

export function isTranscriptSubmission(value: unknown): value is TranscriptSubmission {
  if (!value || typeof value !== 'object') return false;
  const submission = value as Record<string, unknown>;

  return isNonEmptyString(submission.meetingId)
    && /^[a-zA-Z0-9_\-.]+$/.test(submission.meetingId)
    && isNonEmptyString(submission.sourceSystem)
    && isNonEmptyString(submission.nativeId)
    && isNonEmptyString(submission.subject)
    && isNonEmptyString(submission.organiser)
    && isIsoDate(submission.eventDate)
    && typeof submission.transcript === 'string'
    && submission.transcript.trim().length >= 50;
}
