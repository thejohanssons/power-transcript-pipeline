import type { TranscriptSubmission } from './types';

export function buildMeetingRow(
  submission: TranscriptSubmission,
  transcriptSha256: string,
  outputKey: string | null,
): [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string | null,
] {
  return [
    submission.meetingId,
    submission.sourceSystem,
    submission.nativeId,
    submission.subject,
    submission.organiser,
    submission.eventDate,
    transcriptSha256,
    'pending',
    '',
    outputKey,
  ];
}

export function insertMeetingSql(): string {
  return `INSERT INTO meetings (
    meeting_id,
    source_system,
    native_id,
    subject,
    organiser,
    event_date,
    transcript_sha256,
    state,
    error_message,
    r2_output_key
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
}
