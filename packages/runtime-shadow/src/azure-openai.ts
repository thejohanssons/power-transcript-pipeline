import type { LlmAdapter, LlmRequest, LlmResponse } from './contracts';

interface AzureOpenAiConfig {
  endpoint: string;
  deployment: string;
  apiKey: string;
}

interface ChatCompletionsPayload {
  model?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(message);
  return value;
}

function errorSummary(status: number, body: string): string {
  const compactBody = body.replaceAll(/\s+/g, ' ').slice(0, 512);
  return compactBody.length > 0
    ? `Azure OpenAI request failed with status ${status}: ${compactBody}`
    : `Azure OpenAI request failed with status ${status}`;
}

function chatCompletionsUrl(config: AzureOpenAiConfig): URL {
  const endpoint = requireNonEmptyString(config.endpoint, 'Azure OpenAI endpoint is incomplete').replace(/\/$/, '');
  const deployment = requireNonEmptyString(config.deployment, 'Azure OpenAI deployment is incomplete');
  const resourceRoot = endpoint.replace(/\/openai(?:\/v\d+)?$/i, '');
  const url = new URL(`/openai/deployments/${encodeURIComponent(deployment)}/chat/completions`, `${resourceRoot}/`);
  url.searchParams.set('api-version', '2024-02-15-preview');
  return url;
}

function extractResponseText(payload: ChatCompletionsPayload): string {
  return requireNonEmptyString(
    payload.choices?.[0]?.message?.content,
    'Azure OpenAI response did not contain assistant content',
  );
}

export class AzureOpenAiAdapter implements LlmAdapter {
  constructor(private readonly config: AzureOpenAiConfig) {}

  async invoke(request: LlmRequest): Promise<LlmResponse> {
    if (!this.config.endpoint || !this.config.deployment || !this.config.apiKey) {
      throw new Error('Azure OpenAI staging configuration is incomplete');
    }

    const body = {
      model: this.config.deployment,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userContent },
      ],
      max_completion_tokens: request.maxTokens,
      response_format: { type: request.responseFormat },
    };
    const requestBody = JSON.stringify(body);
    const response = await fetch(chatCompletionsUrl(this.config), {
      method: 'POST',
      headers: {
        'api-key': this.config.apiKey,
        'content-type': 'application/json',
        'x-eip-correlation-id': request.correlationId,
      },
      body: requestBody,
    });

    if (!response.ok) {
      throw new Error(errorSummary(response.status, await response.text()));
    }

    const payload = await response.json() as ChatCompletionsPayload;
    const responseText = extractResponseText(payload);
    return {
      provider: 'azure_openai',
      model: typeof payload.model === 'string' ? payload.model : this.config.deployment,
      deployment: this.config.deployment,
      responseText,
      requestSha256: await sha256(requestBody),
      responseSha256: await sha256(responseText),
      usage: {
        inputTokens: typeof payload.usage?.prompt_tokens === 'number' ? payload.usage.prompt_tokens : undefined,
        outputTokens: typeof payload.usage?.completion_tokens === 'number' ? payload.usage.completion_tokens : undefined,
      },
    };
  }
}
