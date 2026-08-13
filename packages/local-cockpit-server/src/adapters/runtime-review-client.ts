export interface TopicMemoryReviewDecisionRequest {
  decision: 'approve_match' | 'reject_match';
  expectedSourceVersion: string;
  expectedProposedMatchMemoryId: string;
  reviewerName: string;
  note: string;
  warningAcknowledged: true;
  idempotencyKey: string;
}

export interface TopicMemoryReviewDecisionResponse {
  decision: 'approve_match' | 'reject_match';
  candidateMemoryId: string;
  candidateMatchStatus: 'merged' | 'confirmed';
  targetMemoryId: string;
  candidateUpdatedAt: string;
  targetUpdatedAt: string | null;
  auditEventId: string;
  appliedAt: string;
  idempotentReplay: boolean;
}

export interface RuntimeReviewClientConfig {
  apiUrl: string;
  decisionToken: string;
  timeoutMs?: number;
}

export class RuntimeReviewConflictError extends Error {
  readonly status = 409;
  constructor(message = 'The review candidate changed. Refresh and reassess the current data.') {
    super(message);
    this.name = 'RuntimeReviewConflictError';
  }
}

export class RuntimeReviewClientError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'RuntimeReviewClientError';
    this.status = status;
  }
}

export interface RuntimeReviewClient {
  submitTopicMemoryDecision(
    memoryId: string,
    decision: TopicMemoryReviewDecisionRequest,
  ): Promise<TopicMemoryReviewDecisionResponse>;
}

export function createRuntimeReviewClient(config: RuntimeReviewClientConfig): RuntimeReviewClient {
  const baseUrl = config.apiUrl.replace(/\/$/, '');
  const timeoutMs = config.timeoutMs ?? 10_000;

  return {
    async submitTopicMemoryDecision(memoryId, decision) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${baseUrl}/v1/topic-memory/${encodeURIComponent(memoryId)}/match`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${config.decisionToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(decision),
          signal: controller.signal,
        });
        if (response.status === 409) {
          throw new RuntimeReviewConflictError();
        }
        if (!response.ok) {
          throw new RuntimeReviewClientError(response.status, 'Runtime review command failed safely');
        }
        const payload = await response.json() as TopicMemoryReviewDecisionResponse;
        return payload;
      } catch (error) {
        if (error instanceof RuntimeReviewConflictError || error instanceof RuntimeReviewClientError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw new RuntimeReviewClientError(504, 'Runtime review command timed out');
        }
        throw new RuntimeReviewClientError(502, 'Runtime review command unavailable');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
