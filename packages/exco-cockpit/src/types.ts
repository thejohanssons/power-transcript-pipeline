// ============================================================
// EIP ExCo Cockpit — Type Contracts
// Synthetic-fixture POC only. No production data.
// ============================================================

// ── API envelope ──────────────────────────────────────────

export interface ApiEnvelope<T> {
  apiVersion: 'v1';
  data: T;
}

export function envelope<T>(data: T): ApiEnvelope<T> {
  return { apiVersion: 'v1', data };
}

// ── Data gap sentinel ─────────────────────────────────────

export const NOT_EXTRACTED = 'Not extracted' as const;
export type MaybeExtracted<T> = T | typeof NOT_EXTRACTED;

// ── Evidence assertion ────────────────────────────────────

export interface EvidenceAssertion {
  id: string;
  text: string;
}

// ── Validation ────────────────────────────────────────────

export interface ValidationResult {
  status: 'pass' | 'warning' | 'fail';
  reasons: string[];
}

// ── Meeting summary (safe — no transcript) ────────────────

export interface MeetingSummary {
  meetingId: string;
  subject: string;
  organiser: string;
  eventDate: string;        // ISO-8601
  topicCount: number;
  actionCount: number;
  decisionCount: number;
  validationStatus: 'pass' | 'warning' | 'fail';
}

// ── Topic ─────────────────────────────────────────────────

export interface CockpitTopic {
  topicId: string;
  meetingId: string;
  // v0.2 taxonomy
  domain: MaybeExtracted<string>;
  entityType: MaybeExtracted<string>;
  entity: MaybeExtracted<string>;
  aspect: MaybeExtracted<string>;
  outcome: MaybeExtracted<string>;
  disposition: MaybeExtracted<string>;
  executiveScope: MaybeExtracted<string>;
  topicStatement: string;
  summary: MaybeExtracted<string>;
  // Evidence
  keyFacts: EvidenceAssertion[];
  risks: EvidenceAssertion[];
  // Ownership governance
  owners: MaybeExtracted<string[]>;
  accountableExecutive: MaybeExtracted<string>;
  confidence: MaybeExtracted<string>;
  validation: ValidationResult;
}

// ── Decision ──────────────────────────────────────────────

export interface CockpitDecision {
  decisionId: string;
  meetingId: string;
  topicId: MaybeExtracted<string>;
  owner: MaybeExtracted<string>;
  text: string;
  evidenceContext: MaybeExtracted<string>;
  // Enriched server-side from meetings and topics
  meetingSubject?: string;
  meetingEventDate?: string;
  evidenceDetailUrl?: string;
  topicStatement?: MaybeExtracted<string>;
  topicDomain?: MaybeExtracted<string>;
  topicEntityType?: MaybeExtracted<string>;
  topicEntity?: MaybeExtracted<string>;
}

// ── Action ────────────────────────────────────────────────

export interface CockpitAction {
  actionId: string;
  meetingId: string;
  topicId: MaybeExtracted<string>;
  owner: MaybeExtracted<string>;
  text: string;
  dueDate: MaybeExtracted<string>;
  status: 'open' | 'completed' | 'cancelled';
  // Enriched server-side from meetings and topics
  meetingSubject?: string;
  meetingEventDate?: string;
  evidenceDetailUrl?: string;
  topicStatement?: MaybeExtracted<string>;
  topicDomain?: MaybeExtracted<string>;
  topicEntityType?: MaybeExtracted<string>;
  topicEntity?: MaybeExtracted<string>;
}

// ── Topic Memory ──────────────────────────────────────────

export interface CockpitTopicMemory {
  memoryId: string;
  domain?: MaybeExtracted<string>;
  entityType: string;
  entity: string;
  aspect: MaybeExtracted<string>;
  canonicalStatement: string;
  firstSeenMeetingId: string;
  lastSeenMeetingId: string;
  firstSeenDate: string;
  lastSeenDate: string;
  meetingCount: number;
  latestOutcome: MaybeExtracted<string>;
  latestDisposition: MaybeExtracted<string>;
  latestExecutiveScope: MaybeExtracted<string>;
  matchStatus: 'confirmed' | 'pending_review' | 'merged';
  proposedMatchStatement: MaybeExtracted<string>;
  proposedMatchMemoryId?: string;
  proposedMatchReason?: string;
  mergedIntoMemoryId?: string | null;
  reviewResolvedAt?: string | null;
  reviewEventId?: string | null;
  updatedAt?: string;
  status: 'open' | 'resolved' | 'closed' | 'watching';
}

// ── Risks and Actions combined response ───────────────────
// Risks are evidence-based proxies from Risk-outcome topics and extracted
// risk assertions — not a complete governed risk register.

export interface CockpitRisk {
  riskId: string;
  meetingId: string;
  topicId: string;
  topicStatement: string;
  riskText: string;
  owner: MaybeExtracted<string>;
  evidenceDetailUrl: string;
  evidenceLabel: string;  // "Evidence proxy — not a complete governed risk register"
  topicDomain?: MaybeExtracted<string>;
  topicEntityType?: MaybeExtracted<string>;
  topicEntity?: MaybeExtracted<string>;
}

export interface RisksActionsResponse {
  evidenceProxyNotice: string;
  risks: CockpitRisk[];
  actions: CockpitAction[];
}

// ── Evidence item (for drill-down) ────────────────────────

export interface EvidenceItem {
  itemId: string;
  itemType: 'topic' | 'decision' | 'action' | 'memory';
  meetingSubject: string;
  eventDate: string;
  keyFacts: EvidenceAssertion[];
  decisions: EvidenceAssertion[];
  actions: EvidenceAssertion[];
  risks: EvidenceAssertion[];
  validationWarnings: string[];
  dataGaps: string[];
}

// ── Overview ──────────────────────────────────────────────

export interface CockpitOverview {
  generatedAt: string;
  meetingCount: number;
  topicCount: number;
  decisionCount: number;
  openActionCount: number;
  topicMemoryCount: number;
  pendingReviewCount: number;
  validationWarningCount: number;
  meetings: MeetingSummary[];
}

// ── Feedback (browser-session only, never sent to server) ─

export type FeedbackVerdict = 'accurate' | 'incomplete' | 'incorrect' | 'irrelevant';

export interface SessionFeedback {
  itemType: string;
  itemId: string;
  verdict: FeedbackVerdict;
  affectedField: string;
  notes: string;
  createdAt: string;
}
