// ============================================================
// EIP Cloudflare Runtime — Type Contracts
// Contract version: 1
// Taxonomy: v0.2 (frozen production standard)
// See plans/versioning-policy.md for version bump rules.
// ============================================================

export interface Env {
  DB: D1Database;
  OUTPUT_BUCKET: R2Bucket;
  ENVIRONMENT: string;
  AZURE_OPENAI_ENDPOINT: string;
  AZURE_OPENAI_DEPLOYMENT: string;
  AZURE_OPENAI_API_KEY: string;
  SUBMISSION_TOKEN: string;
  TEAMS_WEBHOOK_URL?: string;
}

// ── Version constants ──────────────────────────────────────

export const CONTRACT_VERSION = '1';
export const RUNTIME_VERSION = '1.0.0';
export const CLASSIFICATION_PROMPT_VERSION = '1';
export const CLASSIFICATION_ENGINE_VERSION = '1';
export const TOPIC_MATCHING_VERSION = '1';
export const NORMALISATION_VERSION = '1';

// ── v0.2 taxonomy controlled vocabulary ───────────────────

export const TAXONOMY_V02 = {
  domains: [
    'Product Management', 'Commercial', 'Operations', 'Finance',
    'Human Resources', 'Information Technology', 'Supply Chain', 'Legal', 'Marketing',
  ],
  entityTypes: [
    'Product', 'Project', 'Initiative', 'Process', 'Customer', 'Supplier',
    'Partner', 'Team', 'Technology Platform', 'Revenue Stream', 'Market',
    'Compliance Obligation', 'Policy', 'Asset', 'Service', 'Agreement', 'Metric',
  ],
  aspects: [
    'Schedule', 'Quality', 'Cost', 'Capacity', 'Performance',
    'Compliance', 'Relationship', 'Capability',
  ],
  outcomes: [
    'Progress', 'Delay', 'Risk', 'Issue', 'Opportunity',
    'Dependency', 'Insight', 'Completion',
  ],
  dispositions: [
    'Decision', 'Action', 'Monitoring', 'Escalation', 'Deferral', 'None',
  ],
  executiveScopes: ['Strategic', 'Operational', 'Tactical'],
} as const;

// ── Submission from Azure pipeline ────────────────────────

/**
 * What the Azure pipeline sends to Cloudflare.
 * Raw transcript + meeting metadata only. No Azure-processed artifacts.
 */
export interface TranscriptSubmission {
  meetingId: string;      // stable pipeline ID e.g. "2026-08-07_0900_sales_call"
  sourceSystem: string;   // 'azure'
  nativeId: string;       // Teams meeting ID
  subject: string;
  organiser: string;
  eventDate: string;      // ISO-8601
  transcript: string;     // raw plain text (converted from VTT by pipeline)
}

// ── Evidence ──────────────────────────────────────────────

export interface EvidenceAssertion {
  id: string;
  text: string;
}

// ── Topic (per-meeting) ───────────────────────────────────

export interface TopicRecord {
  topicId: string;
  // v0.2 taxonomy fields
  domain: string | null;
  entityType: string | null;
  entity: string | null;       // free text — the specific instance
  aspect: string | null;
  outcome: string | null;
  disposition: string | null;
  executiveScope: string | null;
  // Topic statement (enduring business condition)
  topicStatement: string;
  summary: string | null;
  // Evidence
  keyFacts: EvidenceAssertion[];
  decisions: EvidenceAssertion[];
  actions: EvidenceAssertion[];
  risks: EvidenceAssertion[];
  // Ownership
  owners: string[];
  confidence: string | null;
  // Validation
  validation: { status: 'pass' | 'warning' | 'fail'; reasons: string[] };
  // Topic Memory link (populated after matching)
  memoryId?: string;
}

// ── People (per-meeting) ──────────────────────────────────

export interface PersonRecord {
  personId: string;
  canonicalName: string | null;
  sourceName: string;
  attendance: string | null;    // 'present' | 'absent' | 'unknown'
  contributions: EvidenceAssertion[];
  actions: EvidenceAssertion[];
  decisionsOwned: EvidenceAssertion[];
  risksRaised: EvidenceAssertion[];
  topicIds: string[];
  stance: string | null;
  unresolved: boolean;
}

// ── Actions and Decisions (first-class) ───────────────────

export interface ActionRecord {
  actionId: string;
  meetingId: string;
  topicId?: string;
  owner: string | null;
  text: string;
  dueDate: string | null;       // ISO-8601 date if mentioned
  status: 'open' | 'completed' | 'cancelled';
}

export interface DecisionRecord {
  decisionId: string;
  meetingId: string;
  topicId?: string;
  owner: string | null;
  text: string;
}

// ── Meeting output (stored in R2) ─────────────────────────

export interface MeetingOutput {
  meetingId: string;
  sourceSystem: string;
  nativeId: string;
  subject: string;
  organiser: string;
  eventDate: string;
  transcriptSha256: string;
  processing: {
    runtime: 'cloudflare';
    runtimeVersion: string;
    contractVersion: string;
    classificationPromptVersion: string;
    classificationEngineVersion: string;
    topicMatchingVersion: string;
    normalisationVersion: string;
    model: string;
    deployment: string;
  };
  classification: { mode: string | null; confidence: string | null };
  summaryAssertions: EvidenceAssertion[];
  topics: TopicRecord[];
  people: PersonRecord[];
  actions: ActionRecord[];
  decisions: DecisionRecord[];
  validation: { status: 'pass' | 'warning' | 'fail'; reasons: string[] };
}

// ── Topic Memory (cross-meeting) ──────────────────────────

export interface TopicMemoryRecord {
  memoryId: string;
  // Identity (v0.2)
  domain: string | null;
  entityType: string;
  entity: string;
  aspect: string | null;
  // Canonical topic statement (updated as topic evolves)
  canonicalStatement: string;
  // Trajectory
  firstSeenMeetingId: string;
  lastSeenMeetingId: string;
  firstSeenDate: string;
  lastSeenDate: string;
  meetingCount: number;
  // Latest classification
  latestOutcome: string | null;
  latestDisposition: string | null;
  latestExecutiveScope: string | null;
  // Match review
  matchStatus: 'confirmed' | 'pending_review' | 'rejected';
  proposedMatchMemoryId?: string;
  proposedMatchReason?: string;
  // Status
  status: 'open' | 'resolved' | 'closed' | 'watching';
  createdAt: string;
  updatedAt: string;
}

// ── Topic Memory match review ─────────────────────────────

export interface TopicMemoryMatchDecision {
  decision: 'accept' | 'reject';
  reviewerNote?: string;
}
