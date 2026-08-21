import type { Env, MeetingOutput, TopicRecord } from './types';

const STOPWORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should','may','might',
  'to','of','in','for','on','with','at','by','from','as','into','through','about',
  'and','or','but','not','this','that','these','those','it','its','we','our','they',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => Boolean(token) && !STOPWORDS.has(token));
}

function keywordOverlap(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

async function maybeSendTeamsNotification(
  webhookUrl: string,
  topic: TopicRecord,
  matchMemoryId: string,
  existingStatement: string,
): Promise<void> {
  const card = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: 'Topic Memory Review', weight: 'Bolder', size: 'Medium' },
            { type: 'TextBlock', text: `Meeting: ${topic.topicId.split('-topic-')[0]}`, wrap: true },
            { type: 'TextBlock', text: `New topic: ${topic.topicStatement}`, wrap: true },
            { type: 'TextBlock', text: `Existing memory: ${existingStatement}`, wrap: true },
            { type: 'TextBlock', text: `Proposed Match Memory ID: ${matchMemoryId}`, wrap: true },
            { type: 'TextBlock', text: `Entity: ${topic.entity ?? 'unknown'}`, wrap: true },
          ],
          actions: [],
        },
      },
    ],
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });
  } catch (error) {
    console.error('Teams notification failed:', error instanceof Error ? error.message : String(error));
  }
}

function buildMemoryId(meetingId: string, topicIndex: number): string {
  return `${meetingId}-memory-${topicIndex + 1}`;
}

export async function matchTopicsToMemory(
  meetingOutput: MeetingOutput,
  env: Pick<Env, 'DB' | 'TEAMS_WEBHOOK_URL'>,
): Promise<void> {
  for (let index = 0; index < meetingOutput.topics.length; index += 1) {
    const topic = meetingOutput.topics[index];
    const entityType = topic.entityType;
    const entity = topic.entity;
    const topicStatement = topic.topicStatement;
    const memoryId = buildMemoryId(meetingOutput.meetingId, index);

    if (!entityType || !entity) {
      await env.DB.prepare(`INSERT INTO topic_memory (
        memory_id, root_topic_id, domain, entity_type, entity, aspect, canonical_statement,
        first_seen_meeting_id, first_seen_date, last_seen_meeting_id, last_seen_date,
        meeting_count, latest_outcome, latest_disposition, latest_executive_scope,
        match_status, proposed_match_reason, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          memoryId,
          topic.topicId,
          topic.domain,
          entityType ?? '',
          entity ?? '',
          topic.aspect,
          topic.topicStatement,
          meetingOutput.meetingId,
          meetingOutput.eventDate,
          meetingOutput.meetingId,
          meetingOutput.eventDate,
          1,
          topic.outcome,
          topic.disposition,
          topic.executiveScope,
          'confirmed',
          null,
          'open',
        )
        .run();
      continue;
    }

    const existing = await env.DB.prepare(
      "SELECT memory_id, canonical_statement FROM topic_memory WHERE entity_type = ? AND lower(trim(entity)) = lower(trim(?)) AND status <> 'invalidated' ORDER BY updated_at DESC LIMIT 1",
    )
      .bind(entityType, entity)
      .first<{ memory_id: string; canonical_statement: string }>();

    if (!existing) {
      await env.DB.prepare(`INSERT INTO topic_memory (
        memory_id, root_topic_id, domain, entity_type, entity, aspect, canonical_statement,
        first_seen_meeting_id, first_seen_date, last_seen_meeting_id, last_seen_date,
        meeting_count, latest_outcome, latest_disposition, latest_executive_scope,
        match_status, proposed_match_reason, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          memoryId,
          topic.topicId,
          topic.domain,
          entityType,
          entity,
          topic.aspect,
          topic.topicStatement,
          meetingOutput.meetingId,
          meetingOutput.eventDate,
          meetingOutput.meetingId,
          meetingOutput.eventDate,
          1,
          topic.outcome,
          topic.disposition,
          topic.executiveScope,
          'confirmed',
          null,
          'open',
        )
        .run();
      continue;
    }

    const overlap = keywordOverlap(existing.canonical_statement, topicStatement);
    const isStrongMatch = overlap >= 2;

    if (!isStrongMatch) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE topic_memory SET
          last_seen_meeting_id = ?, last_seen_date = ?, meeting_count = meeting_count + 1,
          latest_outcome = ?, latest_disposition = ?, latest_executive_scope = ?,
          updated_at = datetime('now') WHERE memory_id = ?`).bind(
            meetingOutput.meetingId,
            meetingOutput.eventDate,
            topic.outcome,
            topic.disposition,
            topic.executiveScope,
            existing.memory_id,
          ),
        env.DB.prepare("UPDATE topics SET memory_id = ?, updated_at = datetime('now') WHERE topic_id = ?")
          .bind(existing.memory_id, topic.topicId),
      ]);
      continue;
    }

    await env.DB.prepare(`INSERT INTO topic_memory (
      memory_id, root_topic_id, domain, entity_type, entity, aspect, canonical_statement,
      first_seen_meeting_id, first_seen_date, last_seen_meeting_id, last_seen_date,
      meeting_count, latest_outcome, latest_disposition, latest_executive_scope,
      match_status, proposed_match_memory_id, proposed_match_reason, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        memoryId,
        null,
        topic.domain,
        entityType,
        entity,
        topic.aspect,
        topic.topicStatement,
        meetingOutput.meetingId,
        meetingOutput.eventDate,
        meetingOutput.meetingId,
        meetingOutput.eventDate,
        1,
        topic.outcome,
        topic.disposition,
        topic.executiveScope,
        'pending_review',
        existing.memory_id,
        `Keyword overlap ${overlap}`,
        'open',
      )
      .run();

    if (isStrongMatch && env.TEAMS_WEBHOOK_URL) {
      await maybeSendTeamsNotification(
        env.TEAMS_WEBHOOK_URL,
        topic,
        existing.memory_id,
        existing.canonical_statement,
      );
    }
  }
}
