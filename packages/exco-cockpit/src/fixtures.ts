// ============================================================
// EIP ExCo Cockpit — Synthetic Fixture Data
// All IDs are fixture-scoped (fx-*). No real meeting, personal,
// commercial, customer, or transcript data.
// ============================================================

import type {
  MeetingSummary, CockpitTopic, CockpitDecision, CockpitAction,
  CockpitTopicMemory, EvidenceItem, CockpitOverview,
} from './types';
import { NOT_EXTRACTED } from './types';

// ── Meetings (requirement 1: at least two) ────────────────

export const FIXTURE_MEETINGS: MeetingSummary[] = [
  {
    meetingId: 'fx-meeting-001',
    subject: 'Synthetic ExCo Review — Product & Delivery',
    organiser: 'fx-organiser-alpha',
    eventDate: '2026-07-15T10:00:00Z',
    topicCount: 4,
    actionCount: 3,
    decisionCount: 2,
    validationStatus: 'warning',
  },
  {
    meetingId: 'fx-meeting-002',
    subject: 'Synthetic ExCo Review — Commercial & Finance',
    organiser: 'fx-organiser-beta',
    eventDate: '2026-07-22T10:00:00Z',
    topicCount: 3,
    actionCount: 2,
    decisionCount: 1,
    validationStatus: 'pass',
  },
];

// ── Topics ────────────────────────────────────────────────

export const FIXTURE_TOPICS: CockpitTopic[] = [
  // Requirement 2: cross-functional topic with outcome=Risk
  {
    topicId: 'fx-topic-001',
    meetingId: 'fx-meeting-001',
    domain: 'Product Management',
    entityType: 'Product',
    entity: 'fx-product-alpha',
    aspect: 'Schedule',
    outcome: 'Risk',
    disposition: 'Action',
    executiveScope: 'Operational',
    topicStatement: 'fx-product-alpha September delivery is at risk due to unresolved component approval delays affecting both hardware and software readiness.',
    summary: 'Component approval delays have pushed the hardware sign-off past the originally planned date. Software integration cannot begin until hardware approval is complete, creating a cascading risk to the September delivery milestone.',
    keyFacts: [
      { id: 'fx-fact-001', text: 'Component approval has not been received as of the review date.' },
      { id: 'fx-fact-002', text: 'Software integration is blocked pending hardware sign-off.' },
      { id: 'fx-fact-003', text: 'The September milestone requires both approvals to be completed by end of July.' },
    ],
    risks: [
      { id: 'fx-risk-001', text: 'If component approval is not received by 31 July, September delivery cannot be achieved.' },
    ],
    owners: ['fx-role-cpo', 'fx-role-coo'],
    // Requirement 10: absent governance attribute
    accountableExecutive: NOT_EXTRACTED,
    confidence: 'high',
    // Requirement 7: validation warning
    validation: {
      status: 'warning',
      reasons: [
        'Accountable executive not explicitly evidenced in transcript.',
        'No explicit resolution or approval timeline was stated.',
      ],
    },
  },
  {
    topicId: 'fx-topic-002',
    meetingId: 'fx-meeting-001',
    domain: 'Operations',
    entityType: 'Process',
    entity: 'fx-process-npi',
    aspect: 'Schedule',
    outcome: 'Progress',
    disposition: 'Monitoring',
    executiveScope: 'Operational',
    topicStatement: 'NPI gate review for fx-product-alpha is on track with minor open items pending closure.',
    summary: 'Gate review documentation is substantially complete. Two open items remain: final bill of materials sign-off and regulatory submission acknowledgement.',
    keyFacts: [
      { id: 'fx-fact-004', text: 'Gate review documentation is 90% complete.' },
      { id: 'fx-fact-005', text: 'Bill of materials sign-off is pending final component confirmation.' },
    ],
    risks: [],
    owners: ['fx-role-coo'],
    accountableExecutive: 'fx-role-coo',
    confidence: 'medium',
    validation: { status: 'pass', reasons: [] },
  },
  {
    topicId: 'fx-topic-003',
    meetingId: 'fx-meeting-001',
    domain: 'Finance',
    entityType: 'Metric',
    entity: 'fx-metric-gross-margin',
    aspect: 'Cost',
    outcome: 'Issue',
    disposition: 'Escalation',
    executiveScope: 'Strategic',
    topicStatement: 'Gross margin for fx-product-alpha is below target due to an unplanned increase in component costs that has not yet been passed to customers.',
    summary: 'A supplier cost increase of approximately 12% was absorbed in the last quarter without a corresponding price adjustment. The CFO has escalated this for board visibility.',
    keyFacts: [
      { id: 'fx-fact-006', text: 'Component cost increased by approximately 12% in the prior quarter.' },
      { id: 'fx-fact-007', text: 'No customer price adjustment has been made to date.' },
      { id: 'fx-fact-008', text: 'Current gross margin is below the annual target by approximately 4 percentage points.' },
    ],
    risks: [
      { id: 'fx-risk-002', text: 'Continued absorption of cost increase without price adjustment will erode margin further in Q3.' },
    ],
    owners: ['fx-role-cfo'],
    accountableExecutive: 'fx-role-cfo',
    confidence: 'high',
    validation: { status: 'pass', reasons: [] },
  },
  {
    topicId: 'fx-topic-004',
    meetingId: 'fx-meeting-002',
    domain: 'Commercial',
    entityType: 'Market',
    entity: 'fx-market-edu-uk',
    aspect: 'Performance',
    outcome: 'Opportunity',
    disposition: 'Decision',
    executiveScope: 'Strategic',
    topicStatement: 'UK education market pilot results indicate strong conversion intent, creating an opportunity to accelerate the September commercial launch.',
    summary: 'Pilot feedback from three UK education institutions was positive. Conversion intent is high. The commercial team has proposed moving the launch announcement to late August to capture pre-term procurement budgets.',
    keyFacts: [
      { id: 'fx-fact-009', text: 'Three UK education institutions completed the pilot programme.' },
      { id: 'fx-fact-010', text: 'All three expressed strong intent to procure ahead of the autumn term.' },
      { id: 'fx-fact-011', text: 'Pre-term procurement budgets close at the end of August.' },
    ],
    risks: [],
    owners: ['fx-role-cmo'],
    accountableExecutive: NOT_EXTRACTED,
    confidence: 'medium',
    // Requirement 9: intentionally weak — incomplete extraction
    validation: {
      status: 'warning',
      reasons: [
        'Pilot sample size is small (3 institutions); generalisation risk not assessed.',
      ],
    },
  },
  {
    topicId: 'fx-topic-005',
    meetingId: 'fx-meeting-002',
    domain: 'Finance',
    entityType: 'Metric',
    entity: 'fx-metric-cash-flow',
    aspect: 'Cost',
    outcome: 'Risk',
    disposition: 'Monitoring',
    executiveScope: 'Strategic',
    // Requirement 9: intentionally incomplete — entity and topic_statement are weak
    topicStatement: 'Cash flow position is under review.',
    summary: NOT_EXTRACTED,
    keyFacts: [],
    risks: [
      { id: 'fx-risk-003', text: 'Insufficient detail extracted to assess severity of cash flow risk.' },
    ],
    owners: NOT_EXTRACTED,
    accountableExecutive: NOT_EXTRACTED,
    confidence: NOT_EXTRACTED,
    // Requirement 9: intentionally weak example for reviewer to mark 'incomplete'
    validation: {
      status: 'warning',
      reasons: [
        'Topic statement is too vague to support action or decision.',
        'No owner was explicitly identified.',
        'Key facts and summary could not be extracted.',
      ],
    },
  },
  // Regression fixture: Risk classification must produce a primary Risk card
  // even when the source record has no separately extracted risk assertions.
  {
    topicId: 'fx-topic-007',
    meetingId: 'fx-meeting-002',
    domain: 'Product Management',
    entityType: 'Product',
    entity: 'fx-product-beta',
    aspect: 'Schedule',
    outcome: 'Risk',
    disposition: 'Monitoring',
    executiveScope: 'Operational',
    topicStatement: 'fx-product-beta delivery is at risk because verification work was temporarily deprioritised to investigate intermittent input latency.',
    summary: 'The product team temporarily moved verification capacity to a customer-impacting investigation, creating a delivery risk.',
    keyFacts: [],
    risks: [],
    owners: ['fx-role-cpo'],
    accountableExecutive: 'fx-role-cpo',
    confidence: 'medium',
    validation: { status: 'pass', reasons: [] },
  },
  {
    topicId: 'fx-topic-006',
    meetingId: 'fx-meeting-002',
    domain: 'Human Resources',
    entityType: 'Team',
    entity: 'fx-team-engineering',
    aspect: 'Capability',
    outcome: 'Dependency',
    disposition: 'Action',
    executiveScope: 'Operational',
    // Requirement 9: intentionally incorrect — entity type mis-classification for reviewer
    topicStatement: 'Engineering team capacity is insufficient to deliver the Q3 roadmap without additional contractor support.',
    summary: 'The current engineering team headcount cannot support both the fx-product-alpha delivery and the Q3 platform work simultaneously. A contractor resourcing decision is required within two weeks.',
    keyFacts: [
      { id: 'fx-fact-012', text: 'Current engineering headcount is 8 FTEs.' },
      { id: 'fx-fact-013', text: 'Q3 roadmap requires an estimated 12 FTE-equivalent capacity.' },
      { id: 'fx-fact-014', text: 'Contractor lead time is approximately 3 weeks from approval.' },
    ],
    risks: [],
    owners: ['fx-role-cpo', 'fx-role-coo'],
    accountableExecutive: NOT_EXTRACTED,
    confidence: 'medium',
    validation: { status: 'pass', reasons: [] },
  },
];

// ── Decisions (requirement 3: at least one with linked topic, owner, meeting, evidence) ───

export const FIXTURE_DECISIONS: CockpitDecision[] = [
  {
    decisionId: 'fx-decision-001',
    meetingId: 'fx-meeting-001',
    topicId: 'fx-topic-003',
    owner: 'fx-role-cfo',
    text: 'Gross margin recovery plan to be presented at the next board meeting. No price increase to customers until the board has reviewed the plan.',
    evidenceContext: 'The CFO confirmed the escalation and stated that the board presentation would be prepared within two weeks.',
  },
  {
    decisionId: 'fx-decision-002',
    meetingId: 'fx-meeting-001',
    topicId: 'fx-topic-001',
    owner: 'fx-role-cpo',
    text: 'If component approval is not received by 31 July, an emergency risk review will be convened with the CEO.',
    evidenceContext: 'The CPO stated this as a firm commitment with a named date and escalation path.',
  },
  {
    decisionId: 'fx-decision-003',
    meetingId: 'fx-meeting-002',
    topicId: 'fx-topic-004',
    owner: NOT_EXTRACTED,
    text: 'UK education launch announcement moved to late August to capture pre-term procurement budgets.',
    evidenceContext: 'Decision was proposed by the commercial team. No explicit named decision owner was recorded.',
  },
];

// ── Actions (requirement 4: at least one open with linked topic, owner, meeting, due date) ──

export const FIXTURE_ACTIONS: CockpitAction[] = [
  {
    actionId: 'fx-action-001',
    meetingId: 'fx-meeting-001',
    topicId: 'fx-topic-001',
    owner: 'fx-role-cpo',
    text: 'Chase component approval authority and provide written status update to ExCo by 25 July.',
    dueDate: '2026-07-25',
    status: 'open',
  },
  {
    actionId: 'fx-action-002',
    meetingId: 'fx-meeting-001',
    topicId: 'fx-topic-003',
    owner: 'fx-role-cfo',
    text: 'Prepare gross margin recovery plan for board presentation. Include three pricing scenarios and timeline.',
    dueDate: '2026-07-29',
    status: 'open',
  },
  {
    actionId: 'fx-action-003',
    meetingId: 'fx-meeting-001',
    topicId: 'fx-topic-006',
    owner: 'fx-role-coo',
    text: 'Obtain contractor resourcing quotes and present options to CPO within two weeks.',
    dueDate: NOT_EXTRACTED,
    status: 'open',
  },
  {
    actionId: 'fx-action-004',
    meetingId: 'fx-meeting-002',
    topicId: 'fx-topic-004',
    owner: 'fx-role-cmo',
    text: 'Brief UK education sales team on revised launch timeline and prepare pre-order materials.',
    dueDate: '2026-08-10',
    status: 'open',
  },
  {
    actionId: 'fx-action-005',
    meetingId: 'fx-meeting-002',
    topicId: 'fx-topic-002',
    owner: 'fx-role-coo',
    text: 'Close remaining two NPI gate items (BOM sign-off and regulatory acknowledgement) before next review.',
    dueDate: '2026-07-31',
    status: 'completed',
  },
];

// ── Topic Memory (requirement 5+6: at least one spanning two meetings, one pending_review) ──

export const FIXTURE_TOPIC_MEMORY: CockpitTopicMemory[] = [
  // Requirement 5: spans two meetings, meeting_count > 1
  {
    memoryId: 'fx-memory-001',
    domain: 'Product Management',
    entityType: 'Product',
    entity: 'fx-product-alpha',
    aspect: 'Schedule',
    canonicalStatement: 'fx-product-alpha September delivery is at risk due to component approval delays.',
    firstSeenMeetingId: 'fx-meeting-001',
    lastSeenMeetingId: 'fx-meeting-002',
    firstSeenDate: '2026-07-15',
    lastSeenDate: '2026-07-22',
    meetingCount: 2,
    latestOutcome: 'Risk',
    latestDisposition: 'Action',
    latestExecutiveScope: 'Operational',
    matchStatus: 'confirmed',
    proposedMatchStatement: NOT_EXTRACTED,
    status: 'open',
  },
  // Synthetic provenance-only source observation for opt-in browser coverage.
  {
    memoryId: 'fx-memory-001-source-merged',
    domain: 'Product Management',
    entityType: 'Product',
    entity: 'fx-product-alpha',
    aspect: 'Schedule',
    canonicalStatement: 'Historical source observation for fx-product-alpha September delivery trajectory.',
    firstSeenMeetingId: 'fx-meeting-001',
    lastSeenMeetingId: 'fx-meeting-001',
    firstSeenDate: '2026-07-15',
    lastSeenDate: '2026-07-15',
    meetingCount: 1,
    latestOutcome: 'Risk',
    latestDisposition: 'Action',
    latestExecutiveScope: 'Operational',
    matchStatus: 'merged',
    mergedIntoMemoryId: 'fx-memory-001',
    reviewResolvedAt: '2026-07-23T10:15:00.000Z',
    reviewEventId: 'fx-audit-merge-001',
    proposedMatchStatement: NOT_EXTRACTED,
    status: 'open',
  },
  // Requirement 6: pending_review match state
  {
    memoryId: 'fx-memory-002',
    domain: 'Finance',
    entityType: 'Metric',
    entity: 'fx-metric-gross-margin',
    aspect: 'Cost',
    canonicalStatement: 'Gross margin is below target due to unabsorbed supplier cost increase.',
    firstSeenMeetingId: 'fx-meeting-001',
    lastSeenMeetingId: 'fx-meeting-001',
    firstSeenDate: '2026-07-15',
    lastSeenDate: '2026-07-15',
    meetingCount: 1,
    latestOutcome: 'Issue',
    latestDisposition: 'Escalation',
    latestExecutiveScope: 'Strategic',
    matchStatus: 'pending_review',
    // Proposed match is an older memory with slightly different phrasing
    proposedMatchStatement: 'Margin compression is being tracked following the Q2 supplier cost review.',
    proposedMatchMemoryId: 'fx-memory-001',
    updatedAt: '2026-07-15T12:00:00.000Z',
    status: 'open',
  },
  {
    memoryId: 'fx-memory-003',
    domain: 'Commercial',
    entityType: 'Market',
    entity: 'fx-market-edu-uk',
    aspect: 'Performance',
    canonicalStatement: 'UK education market shows strong conversion intent following pilot programme.',
    firstSeenMeetingId: 'fx-meeting-002',
    lastSeenMeetingId: 'fx-meeting-002',
    firstSeenDate: '2026-07-22',
    lastSeenDate: '2026-07-22',
    meetingCount: 1,
    latestOutcome: 'Opportunity',
    latestDisposition: 'Decision',
    latestExecutiveScope: 'Strategic',
    matchStatus: 'confirmed',
    proposedMatchStatement: NOT_EXTRACTED,
    status: 'open',
  },
  {
    memoryId: 'fx-memory-004',
    domain: 'Operations',
    entityType: 'Team',
    entity: 'fx-team-engineering',
    aspect: 'Capability',
    canonicalStatement: 'Engineering capacity is insufficient for simultaneous Q3 delivery and platform work without contractor support.',
    firstSeenMeetingId: 'fx-meeting-001',
    lastSeenMeetingId: 'fx-meeting-001',
    firstSeenDate: '2026-07-15',
    lastSeenDate: '2026-07-15',
    meetingCount: 1,
    latestOutcome: 'Dependency',
    latestDisposition: 'Action',
    latestExecutiveScope: 'Operational',
    matchStatus: 'confirmed',
    proposedMatchStatement: NOT_EXTRACTED,
    status: 'open',
  },
];

// ── Risks and Actions (requirement: separate collections, evidence proxy notice) ──

export const FIXTURE_RISKS_ACTIONS: import('./types').RisksActionsResponse = {
  evidenceProxyNotice: 'Risks shown here are evidence-based proxies derived from Risk-outcome topics and extracted risk assertions. This is not a complete governed risk register.',
  risks: [
    {
      riskId: 'fx-risk-proxy-001',
      meetingId: 'fx-meeting-001',
      topicId: 'fx-topic-001',
      topicStatement: 'fx-product-alpha September delivery is at risk due to unresolved component approval delays affecting both hardware and software readiness.',
      riskText: 'If component approval is not received by 31 July, September delivery cannot be achieved.',
      owner: 'fx-role-cpo',
      evidenceDetailUrl: '/api/v1/evidence/topic/fx-topic-001',
      evidenceLabel: 'Evidence proxy — not a complete governed risk register',
    },
    {
      riskId: 'fx-risk-proxy-002',
      meetingId: 'fx-meeting-001',
      topicId: 'fx-topic-003',
      topicStatement: 'Gross margin for fx-product-alpha is below target due to an unplanned increase in component costs.',
      riskText: 'Continued absorption of cost increase without price adjustment will erode margin further in Q3.',
      owner: 'fx-role-cfo',
      evidenceDetailUrl: '/api/v1/evidence/topic/fx-topic-003',
      evidenceLabel: 'Evidence proxy — not a complete governed risk register',
    },
    {
      riskId: 'fx-risk-proxy-003',
      meetingId: 'fx-meeting-002',
      topicId: 'fx-topic-005',
      topicStatement: 'Cash flow position is under review.',
      riskText: 'Insufficient detail extracted to assess severity of cash flow risk.',
      owner: NOT_EXTRACTED,
      evidenceDetailUrl: '/api/v1/evidence/topic/fx-topic-005',
      evidenceLabel: 'Evidence proxy — not a complete governed risk register',
    },
  ],
  actions: FIXTURE_ACTIONS,
};

// ── Evidence items (for drill-down endpoint) ──────────────

export const FIXTURE_EVIDENCE: EvidenceItem[] = [
  {
    itemId: 'fx-topic-001',
    itemType: 'topic',
    meetingSubject: 'Synthetic ExCo Review — Product & Delivery',
    eventDate: '2026-07-15T10:00:00Z',
    keyFacts: [
      { id: 'fx-fact-001', text: 'Component approval has not been received as of the review date.' },
      { id: 'fx-fact-002', text: 'Software integration is blocked pending hardware sign-off.' },
      { id: 'fx-fact-003', text: 'The September milestone requires both approvals to be completed by end of July.' },
    ],
    decisions: [
      { id: 'fx-decision-002', text: 'If component approval is not received by 31 July, an emergency risk review will be convened with the CEO.' },
    ],
    actions: [
      { id: 'fx-action-001', text: 'Chase component approval authority and provide written status update to ExCo by 25 July.' },
    ],
    risks: [
      { id: 'fx-risk-001', text: 'If component approval is not received by 31 July, September delivery cannot be achieved.' },
    ],
    validationWarnings: [
      'Accountable executive not explicitly evidenced in transcript.',
      'No explicit resolution or approval timeline was stated.',
    ],
    dataGaps: ['accountableExecutive'],
  },
  {
    itemId: 'fx-topic-005',
    itemType: 'topic',
    meetingSubject: 'Synthetic ExCo Review — Commercial & Finance',
    eventDate: '2026-07-22T10:00:00Z',
    keyFacts: [],
    decisions: [],
    actions: [],
    risks: [
      { id: 'fx-risk-003', text: 'Insufficient detail extracted to assess severity of cash flow risk.' },
    ],
    validationWarnings: [
      'Topic statement is too vague to support action or decision.',
      'No owner was explicitly identified.',
      'Key facts and summary could not be extracted.',
    ],
    dataGaps: ['owners', 'accountableExecutive', 'confidence', 'summary'],
  },
  // Evidence for a decision item
  {
    itemId: 'fx-decision-001',
    itemType: 'decision',
    meetingSubject: 'Synthetic ExCo Review — Product & Delivery',
    eventDate: '2026-07-15T10:00:00Z',
    keyFacts: [
      { id: 'fx-fact-006', text: 'Component cost increased by approximately 12% in the prior quarter.' },
      { id: 'fx-fact-008', text: 'Current gross margin is below the annual target by approximately 4 percentage points.' },
    ],
    decisions: [
      { id: 'fx-decision-001', text: 'Gross margin recovery plan to be presented at the next board meeting. No price increase to customers until the board has reviewed the plan.' },
    ],
    actions: [
      { id: 'fx-action-002', text: 'Prepare gross margin recovery plan for board presentation. Include three pricing scenarios and timeline.' },
    ],
    risks: [
      { id: 'fx-risk-002', text: 'Continued absorption of cost increase without price adjustment will erode margin further in Q3.' },
    ],
    validationWarnings: [],
    dataGaps: [],
  },
  // Evidence for an action item
  {
    itemId: 'fx-action-001',
    itemType: 'action',
    meetingSubject: 'Synthetic ExCo Review — Product & Delivery',
    eventDate: '2026-07-15T10:00:00Z',
    keyFacts: [
      { id: 'fx-fact-001', text: 'Component approval has not been received as of the review date.' },
      { id: 'fx-fact-003', text: 'The September milestone requires both approvals to be completed by end of July.' },
    ],
    decisions: [
      { id: 'fx-decision-002', text: 'If component approval is not received by 31 July, an emergency risk review will be convened with the CEO.' },
    ],
    actions: [
      { id: 'fx-action-001', text: 'Chase component approval authority and provide written status update to ExCo by 25 July.' },
    ],
    risks: [
      { id: 'fx-risk-001', text: 'If component approval is not received by 31 July, September delivery cannot be achieved.' },
    ],
    validationWarnings: [
      'Accountable executive not explicitly evidenced in transcript.',
    ],
    dataGaps: ['accountableExecutive'],
  },
  // Evidence for a topic-memory item
  {
    itemId: 'fx-memory-002',
    itemType: 'memory',
    meetingSubject: 'Synthetic ExCo Review — Product & Delivery',
    eventDate: '2026-07-15T10:00:00Z',
    keyFacts: [
      { id: 'fx-fact-006', text: 'Component cost increased by approximately 12% in the prior quarter.' },
      { id: 'fx-fact-007', text: 'No customer price adjustment has been made to date.' },
    ],
    decisions: [
      { id: 'fx-decision-001', text: 'Gross margin recovery plan to be presented at the next board meeting.' },
    ],
    actions: [
      { id: 'fx-action-002', text: 'Prepare gross margin recovery plan for board presentation.' },
    ],
    risks: [
      { id: 'fx-risk-002', text: 'Continued absorption of cost increase without price adjustment will erode margin further in Q3.' },
    ],
    validationWarnings: [],
    dataGaps: [],
  },
];

// ── Overview (computed from fixtures) ────────────────────

export const FIXTURE_OVERVIEW: CockpitOverview = {
  generatedAt: '2026-08-11T00:00:00Z',
  meetingCount: FIXTURE_MEETINGS.length,
  topicCount: FIXTURE_TOPICS.length,
  decisionCount: FIXTURE_DECISIONS.length,
  openActionCount: FIXTURE_ACTIONS.filter(a => a.status === 'open').length,
  topicMemoryCount: FIXTURE_TOPIC_MEMORY.filter(m => !m.mergedIntoMemoryId && m.matchStatus !== 'merged').length,
  pendingReviewCount: FIXTURE_TOPIC_MEMORY.filter(m => !m.mergedIntoMemoryId && m.matchStatus === 'pending_review').length,
  validationWarningCount: FIXTURE_TOPICS.filter(t => t.validation.status !== 'pass').length,
  meetings: FIXTURE_MEETINGS,
};
