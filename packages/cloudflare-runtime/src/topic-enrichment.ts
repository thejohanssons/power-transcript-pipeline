import type { TopicRecord } from './types';

export type FixedTopicContext = Pick<TopicRecord,
  'topicId' | 'domain' | 'entityType' | 'entity' | 'aspect' | 'outcome' | 'disposition' |
  'executiveScope' | 'topicStatement' | 'summary' | 'owners' | 'confidence' | 'memoryId'>;

export function fixedTopicEvidenceInput(topics: FixedTopicContext[]): string {
  return JSON.stringify(topics.map((topic) => ({
    topicId: topic.topicId,
    domain: topic.domain,
    entityType: topic.entityType,
    entity: topic.entity,
    aspect: topic.aspect,
    outcome: topic.outcome,
    disposition: topic.disposition,
    executiveScope: topic.executiveScope,
    topicStatement: topic.topicStatement,
  })), null, 2);
}

export function mergeFixedTopicEvidence(
  generated: Record<string, unknown> | undefined,
  fixed: FixedTopicContext,
): Record<string, unknown> {
  return {
    ...fixed,
    ...(generated ?? {}),
    topicId: fixed.topicId,
    domain: fixed.domain,
    entityType: fixed.entityType,
    entity: fixed.entity,
    aspect: fixed.aspect,
    outcome: fixed.outcome,
    disposition: fixed.disposition,
    executiveScope: fixed.executiveScope,
    topicStatement: fixed.topicStatement,
    owners: fixed.owners,
    memoryId: fixed.memoryId,
  };
}
