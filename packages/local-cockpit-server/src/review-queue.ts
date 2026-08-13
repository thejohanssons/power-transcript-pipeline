import type { FeedbackRow, TopicMemoryRow } from './types/db-rows.js';

export type ReviewQueueItemType = 'memory';
export type ReviewVerdict = 'accurate' | 'incomplete' | 'incorrect' | 'irrelevant';

export interface ReviewDisposition {
  feedbackId: string;
  verdict: ReviewVerdict;
  affectedField: string;
  reviewerName: string;
  createdAt: string;
  correctsFeedbackId: string | null;
}

export interface ReviewQueueItem {
  itemType: ReviewQueueItemType;
  itemId: string;
  sourceKind: 'd1';
  sourceVersion: string;
  candidateStatus: 'pending_review';
  title: string;
  summary: string | null;
  entityType: string | null;
  entity: string | null;
  aspect: string | null;
  proposedMatchMemoryId: string | null;
  proposedMatchReason: string | null;
  updatedAt: string;
  disposition: ReviewDisposition | null;
}

export interface ReviewQueueResponse {
  generatedAt: string;
  awaitingReview: ReviewQueueItem[];
  recordedDecisions: ReviewQueueItem[];
}

export interface ReviewQueueFeedbackRow {
  feedback_id: string;
  item_type: string;
  item_id: string;
  source_kind: string;
  source_version: string | null;
  reviewer_name: string;
  verdict: ReviewVerdict;
  affected_field: string;
  corrects_feedback_id: string | null;
  created_at: string;
}

export interface CandidateRegistryEntry<TRow> {
  itemType: ReviewQueueItemType;
  isCandidate(row: TRow): boolean;
  getItemId(row: TRow): string;
  getSourceVersion(row: TRow): string;
  toQueueItem(row: TRow, disposition: ReviewDisposition | null): ReviewQueueItem;
}

export const CANDIDATE_REGISTRY: readonly CandidateRegistryEntry<TopicMemoryRow>[] = [
  {
    itemType: 'memory',
    isCandidate: row => row.match_status === 'pending_review',
    getItemId: row => row.memory_id,
    getSourceVersion: row => row.updated_at,
    toQueueItem: (row, disposition) => ({
      itemType: 'memory',
      itemId: row.memory_id,
      sourceKind: 'd1',
      sourceVersion: row.updated_at,
      candidateStatus: 'pending_review',
      title: row.canonical_statement,
      summary: null,
      entityType: row.entity_type ?? null,
      entity: row.entity ?? null,
      aspect: row.aspect ?? null,
      proposedMatchMemoryId: row.proposed_match_memory_id ?? null,
      proposedMatchReason: row.proposed_match_reason ?? null,
      updatedAt: row.updated_at,
      disposition,
    }),
  },
];

const VERDICTS = new Set<ReviewVerdict>(['accurate', 'incomplete', 'incorrect', 'irrelevant']);

function toDisposition(row: ReviewQueueFeedbackRow): ReviewDisposition | null {
  if (!VERDICTS.has(row.verdict)) return null;
  return {
    feedbackId: row.feedback_id,
    verdict: row.verdict,
    affectedField: row.affected_field,
    reviewerName: row.reviewer_name,
    createdAt: row.created_at,
    correctsFeedbackId: row.corrects_feedback_id,
  };
}

function compareFeedbackNewest(a: ReviewQueueFeedbackRow, b: ReviewQueueFeedbackRow): number {
  return b.created_at.localeCompare(a.created_at) || b.feedback_id.localeCompare(a.feedback_id);
}

function compareQueueItems(a: ReviewQueueItem, b: ReviewQueueItem): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.itemType.localeCompare(b.itemType) || a.itemId.localeCompare(b.itemId);
}

export function composeReviewQueue(
  runtimeRows: readonly TopicMemoryRow[],
  feedbackRows: readonly ReviewQueueFeedbackRow[] | readonly FeedbackRow[],
  generatedAt = new Date().toISOString(),
): ReviewQueueResponse {
  const feedbackByIdentity = new Map<string, ReviewQueueFeedbackRow[]>();
  for (const row of feedbackRows) {
    if (row.item_type !== 'memory' || row.source_kind !== 'd1' || row.source_version === null) continue;
    const queueRow = row as ReviewQueueFeedbackRow;
    const key = `${row.item_type}\u0000${row.item_id}\u0000${row.source_kind}\u0000${row.source_version}`;
    const bucket = feedbackByIdentity.get(key) ?? [];
    bucket.push(queueRow);
    feedbackByIdentity.set(key, bucket);
  }

  const awaitingReview: ReviewQueueItem[] = [];
  const recordedDecisions: ReviewQueueItem[] = [];

  for (const registryEntry of CANDIDATE_REGISTRY) {
    for (const row of runtimeRows) {
      if (!registryEntry.isCandidate(row)) continue;
      const itemId = registryEntry.getItemId(row);
      const sourceVersion = registryEntry.getSourceVersion(row);
      const key = `${registryEntry.itemType}\u0000${itemId}\u0000d1\u0000${sourceVersion}`;
      const matching = (feedbackByIdentity.get(key) ?? []).sort(compareFeedbackNewest);
      const disposition = matching.length ? toDisposition(matching[0]) : null;
      const item = registryEntry.toQueueItem(row, disposition);
      (disposition ? recordedDecisions : awaitingReview).push(item);
    }
  }

  awaitingReview.sort(compareQueueItems);
  recordedDecisions.sort(compareQueueItems);
  return { generatedAt, awaitingReview, recordedDecisions };
}

export function toReviewQueueFeedbackRow(row: FeedbackRow): ReviewQueueFeedbackRow {
  return {
    feedback_id: row.feedback_id,
    item_type: row.item_type,
    item_id: row.item_id,
    source_kind: row.source_kind,
    source_version: row.source_version,
    reviewer_name: row.reviewer_name,
    verdict: row.verdict as ReviewVerdict,
    affected_field: row.affected_field,
    corrects_feedback_id: row.corrects_feedback_id,
    created_at: row.created_at,
  };
}
