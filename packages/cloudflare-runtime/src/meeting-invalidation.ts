import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

const CONFIRMATION = 'INVALIDATE_MEETING';

export interface MeetingInvalidationRequest {
  meetingIds: string[];
  reason: string;
  dryRun: boolean;
  confirm: string | null;
  quarantineR2: boolean;
}

export interface MeetingInvalidationPreview {
  meetingId: string;
  state: string;
  subject: string | null;
  r2OutputKey: string | null;
  topicCount: number;
  actionCount: number;
  decisionCount: number;
  personCount: number;
  r2Keys: string[];
}

function safeText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function parseMeetingInvalidationRequest(body: unknown): MeetingInvalidationRequest {
  const value = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const meetingIds = Array.isArray(value.meetingIds)
    ? value.meetingIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).slice(0, 20)
    : [];
  return {
    meetingIds,
    reason: safeText(value.reason, 'Invalidated by operator'),
    dryRun: value.dryRun !== false,
    confirm: typeof value.confirm === 'string' ? value.confirm : null,
    quarantineR2: value.quarantineR2 !== false,
  };
}

async function listMeetingR2Keys(bucket: R2Bucket, meetingId: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `meetings/${meetingId}/`, cursor });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function previewMeeting(db: D1Database, bucket: R2Bucket, meetingId: string): Promise<MeetingInvalidationPreview | null> {
  const meeting = await db.prepare('SELECT meeting_id,state,subject,r2_output_key FROM meetings WHERE meeting_id = ?')
    .bind(meetingId)
    .first<{ meeting_id: string; state: string; subject: string | null; r2_output_key: string | null }>();
  if (!meeting) return null;

  const counts = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM topics WHERE meeting_id = ?) AS topics,
      (SELECT COUNT(*) FROM actions WHERE meeting_id = ?) AS actions,
      (SELECT COUNT(*) FROM decisions WHERE meeting_id = ?) AS decisions,
      (SELECT COUNT(*) FROM people WHERE meeting_id = ?) AS people`)
    .bind(meetingId, meetingId, meetingId, meetingId)
    .first<{ topics: number; actions: number; decisions: number; people: number }>();

  return {
    meetingId,
    state: meeting.state,
    subject: meeting.subject,
    r2OutputKey: meeting.r2_output_key,
    topicCount: counts?.topics ?? 0,
    actionCount: counts?.actions ?? 0,
    decisionCount: counts?.decisions ?? 0,
    personCount: counts?.people ?? 0,
    r2Keys: await listMeetingR2Keys(bucket, meetingId),
  };
}

export async function invalidateMeetings(
  db: D1Database,
  bucket: R2Bucket,
  request: MeetingInvalidationRequest,
): Promise<{ dryRun: boolean; confirmationRequired?: string; previews: MeetingInvalidationPreview[]; invalidated: string[] }> {
  const previews = (await Promise.all(request.meetingIds.map((id) => previewMeeting(db, bucket, id))))
    .filter((preview): preview is MeetingInvalidationPreview => preview !== null);

  if (request.dryRun) {
    return { dryRun: true, previews, invalidated: [] };
  }
  if (request.confirm !== CONFIRMATION) {
    return { dryRun: false, confirmationRequired: CONFIRMATION, previews, invalidated: [] };
  }

  const invalidated: string[] = [];
  for (const preview of previews) {
    const invalidationId = crypto.randomUUID();
    const r2Keys = [...new Set([
      ...preview.r2Keys,
      ...(preview.r2OutputKey ? [preview.r2OutputKey] : []),
    ])];

    if (request.quarantineR2) {
      for (const key of r2Keys) {
        const object = await bucket.get(key);
        if (object) {
          await bucket.put(`quarantine/${invalidationId}/${key}`, object.body, {
            httpMetadata: object.httpMetadata,
            customMetadata: { invalidationId, meetingId: preview.meetingId, reason: request.reason },
          });
        }
      }
    }
    await bucket.delete(r2Keys);

    await db.batch([
      db.prepare('DELETE FROM actions WHERE meeting_id = ?').bind(preview.meetingId),
      db.prepare('DELETE FROM decisions WHERE meeting_id = ?').bind(preview.meetingId),
      db.prepare('DELETE FROM people WHERE meeting_id = ?').bind(preview.meetingId),
      db.prepare('DELETE FROM topics WHERE meeting_id = ?').bind(preview.meetingId),
      db.prepare(`INSERT INTO meeting_invalidations
        (invalidation_id,meeting_id,reason,deleted_topic_count,deleted_action_count,deleted_decision_count,deleted_person_count,deleted_r2_keys_json)
        VALUES (?,?,?,?,?,?,?,?)`).bind(
          invalidationId,
          preview.meetingId,
          request.reason,
          preview.topicCount,
          preview.actionCount,
          preview.decisionCount,
          preview.personCount,
          JSON.stringify(r2Keys),
        ),
      db.prepare("UPDATE meetings SET state='invalidated', error_message=?, r2_output_key=NULL, updated_at=datetime('now') WHERE meeting_id=?")
        .bind(request.reason, preview.meetingId),
    ]);
    invalidated.push(preview.meetingId);
  }

  return { dryRun: false, previews, invalidated };
}
