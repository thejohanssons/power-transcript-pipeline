export const FIXTURE_MANIFEST_SCHEMA_VERSION = '1.0.0';
export const NORMALIZED_OUTPUT_SCHEMA_VERSION = '1.0.0';

export type AcquisitionMode = 'calendar' | 'vtt_inbox' | 'direct_vtt';
export type ComparisonSeverity = 'blocking' | 'material' | 'permitted';
export type ComparisonDisposition =
  | 'accepted_equivalent'
  | 'accepted_intentional_improvement'
  | 'baseline_defect'
  | 'cloudflare_defect'
  | 'unresolved';

export interface ObjectReference {
  key: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

export interface VersionReference {
  name: string;
  version?: string;
  sha256: string;
}

export interface FixtureManifest {
  schemaVersion: typeof FIXTURE_MANIFEST_SCHEMA_VERSION;
  fixtureId: string;
  revision: string;
  acquisitionMode: AcquisitionMode;
  source: {
    system: string;
    nativeId: string;
    meetingId?: string;
    subject?: string;
    eventStart?: string;
    eventEnd?: string;
    organiser?: string;
  };
  transcript: ObjectReference;
  azureBaseline: {
    normalizedOutput: ObjectReference;
    publicationIntent: ObjectReference;
  };
  configuration: VersionReference[];
  processing: {
    azurePipelineVersion: string;
    promptVersion: string;
    model: string;
    deployment: string;
  };
  classification: 'internal' | 'confidential';
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
}

export interface EvidenceAssertion {
  id: string;
  text: string;
  sourceOffsets?: { start: number; end: number };
}

export interface NormalizedTopic {
  topicId: string | null;
  topic: string | null;
  domain: string | null;
  category: string | null;
  contextType: string | null;
  summary: string | null;
  keyFacts: EvidenceAssertion[];
  decisions: EvidenceAssertion[];
  actions: EvidenceAssertion[];
  risks: EvidenceAssertion[];
  owners: string[];
  confidence: string | null;
  validation: { status: 'pass' | 'warning' | 'fail'; reasons: string[] };
}

export interface NormalizedPerson {
  canonicalName: string | null;
  sourceName: string;
  attendance: string | null;
  contributions: EvidenceAssertion[];
  actions: EvidenceAssertion[];
  decisionsOwned: EvidenceAssertion[];
  risksRaised: EvidenceAssertion[];
  topicIds: string[];
  stance: string | null;
  unresolved: boolean;
}

export interface PublicationIntent {
  transcript: boolean;
  summary: boolean;
  peopleFile: boolean;
  topicRecords: boolean;
  masterLog: boolean;
  confluence: boolean;
  teamsNotification: boolean;
  canonicalTopicMemory: boolean;
  legacyCloudflareSync: boolean;
}

export interface NormalizedOutput {
  schemaVersion: typeof NORMALIZED_OUTPUT_SCHEMA_VERSION;
  source: {
    system: string;
    nativeId: string;
    transcriptSha256: string;
    acquisitionMode: AcquisitionMode;
  };
  processing: {
    runtime: 'azure' | 'cloudflare';
    pipelineVersion: string;
    promptVersion: string;
    model: string;
    deployment: string;
    configurationHashes: Record<string, string>;
  };
  classification: { mode: string | null; confidence: string | null };
  summaryAssertions: EvidenceAssertion[];
  topics: NormalizedTopic[];
  people: NormalizedPerson[];
  validation: { status: 'pass' | 'warning' | 'fail'; reasons: string[] };
  publicationIntent: PublicationIntent;
}

export interface ComparisonDifference {
  path: string;
  severity: ComparisonSeverity;
  reason: string;
  azure: unknown;
  cloudflare: unknown;
  disposition?: ComparisonDisposition;
}

export interface ComparisonResult {
  schemaVersion: '1.0.0';
  fixtureId: string;
  manifestSha256: string;
  runId: string;
  generatedAt: string;
  status: 'pass' | 'review_required' | 'blocked';
  differences: ComparisonDifference[];
  counts: Record<ComparisonSeverity, number>;
}

export interface LlmRequest {
  correlationId: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  responseFormat: 'json_object';
  promptVersion: string;
}

export interface LlmResponse {
  provider: 'azure_openai' | 'workers_ai';
  model: string;
  deployment: string;
  responseText: string;
  requestSha256: string;
  responseSha256: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LlmAdapter {
  invoke(request: LlmRequest): Promise<LlmResponse>;
}

export interface FixtureJob {
  fixtureId: string;
  manifestKey: string;
  manifestSha256: string;
  runId: string;
}
