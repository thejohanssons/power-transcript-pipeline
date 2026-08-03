import type { LlmAdapter, LlmRequest, LlmResponse } from './contracts';

interface AzureOpenAiConfig {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  apiKey: string;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class AzureOpenAiAdapter implements LlmAdapter {
  constructor(private readonly config: AzureOpenAiConfig) {}

  async invoke(request: LlmRequest): Promise<LlmResponse> {
    if (!this.config.endpoint || !this.config.deployment || !this.config.apiKey) {
      throw new Error('Azure OpenAI configuration is incomplete');
    }

    const body = {
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userContent },
      ],
      max_tokens: request.maxTokens,
      response_format: { type: request.responseFormat },
    };
    const requestBody = JSON.stringify(body);
    const url = new URL(
      `/openai/deployments/${encodeURIComponent(this.config.deployment)}/chat/completions`,
      this.config.endpoint,
    );
    url.searchParams.set('api-version', this.config.apiVersion);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key': this.config.apiKey,
        'x-eip-correlation-id': request.correlationId,
      },
      body: requestBody,
    });

    if (!response.ok) {
      throw new Error(`Azure OpenAI request failed with status ${response.status}`);
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const responseText = payload.choices?.[0]?.message?.content;
    if (!responseText) throw new Error('Azure OpenAI response did not contain a completion');

    return {
      provider: 'azure_openai',
      model: payload.model ?? this.config.deployment,
      deployment: this.config.deployment,
      responseText,
      requestSha256: await sha256(requestBody),
      responseSha256: await sha256(responseText),
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
      },
    };
  }
}
