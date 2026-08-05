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

/** Azure-produced artifacts supplied for continuous shadow verification. */
export type AzureExportArtifactKind = 'transcript' | 'summary' | 'people' | 'topic_record';

export interface AzureExportArtifactReference extends ObjectReference {
  kind: AzureExportArtifactKind;
}

export const AZURE_EXPORT_PACKAGE_SCHEMA_VERSION = '1.0.0';

/**
 * The package boundary between Azure processing and the Cloudflare shadow.
 * It deliberately excludes source acquisition details and publication intent.
 */
export interface AzureExportPackageManifest {
  schemaVersion: typeof AZURE_EXPORT_PACKAGE_SCHEMA_VERSION;
  packageId: string;
  source: {
    system: string;
    nativeId: string;
    meetingId?: string;
    subject?: string;
    eventStart?: string;
    eventEnd?: string;
  };
  processing: {
    azurePipelineVersion: string;
    promptVersion?: string;
    model?: string;
    deployment?: string;
    configuration: VersionReference[];
    /**
     * The actual governed configuration content Azure used during processing,
     * keyed by config name (e.g. "taxonomy", "mapping_rules"). Optional for
     * backwards-compatibility with v1 submissions that only sent hashes, but
     * required for a valid continuous parity measurement. When present, the
     * shadow Worker validates controlled vocabulary values against this content
     * and injects it into the model prompt.
     */
    configurationContent?: Record<string, unknown>;
  };
  artifacts: {
    transcript: AzureExportArtifactReference;
    summary: AzureExportArtifactReference;
    people: AzureExportArtifactReference;
    topicRecords: AzureExportArtifactReference[];
  };
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
  /** Immutable configuration snapshot used to construct the Azure baseline. */
  configurationSnapshot: ObjectReference;
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

/**
 * Semantic projection used by continuous Azure-export parity. It intentionally
 * has no acquisition-mode or publication/persistence fields.
 */
export interface ContinuousNormalizedOutput {
  schemaVersion: typeof NORMALIZED_OUTPUT_SCHEMA_VERSION;
  source: {
    system: string;
    nativeId: string;
    transcriptSha256: string;
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
  /** Business outputs expected under the approved pipeline; never proof of a write. */
  publicationIntent: PublicationIntent;
  /**
   * Outputs this runtime actually published. Immutable Azure baselines omit this
   * field because they are intent references, not an observation of a shadow run.
   */
  actualPublication?: PublicationIntent;
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

/** Queue payload for an Azure-produced continuous verification package. */
export interface AzureExportJob {
  packageId: string;
  manifestKey: string;
  manifestSha256: string;
  runId: string;
}
