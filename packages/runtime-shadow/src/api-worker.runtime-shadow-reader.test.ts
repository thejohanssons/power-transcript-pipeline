import { describe, expect, it } from 'vitest';
import apiWorker from '../../api-worker/src/index';

class LocalR2 {
  readonly objects = new Map<string, string>();
  getCalls: string[] = [];

  async get(key: string) {
    this.getCalls.push(key);
    const value = this.objects.get(key);
    return value === undefined ? null : {
      body: new TextEncoder().encode(value),
      size: new TextEncoder().encode(value).byteLength,
      etag: 'local-etag',
      httpMetadata: { contentType: 'text/vtt' },
    };
  }
}

const route = 'https://api.local/internal/runtime-shadow/azure-artifacts/';

function environment(storage: LocalR2, environmentName = 'staging') {
  return {
    DB: {},
    STORAGE: storage,
    ENVIRONMENT: environmentName,
    SHADOW_ARTIFACT_READ_TOKEN: 'reader-token',
  } as unknown as Parameters<typeof apiWorker.fetch>[1];
}

describe('API Worker runtime-shadow artifact reader', () => {
  it('is staging-only, bearer-authenticated, prefix-limited, and GET-only', async () => {
    const storage = new LocalR2();
    storage.objects.set('transcripts/2026-08/synthetic.vtt', 'WEBVTT\n');
    const staging = environment(storage);

    const allowed = await apiWorker.fetch(new Request(`${route}transcripts/2026-08/synthetic.vtt`, {
      headers: { authorization: 'Bearer reader-token' },
    }), staging, {} as ExecutionContext);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe('WEBVTT\n');
    expect(storage.getCalls).toEqual(['transcripts/2026-08/synthetic.vtt']);

    const missingToken = await apiWorker.fetch(new Request(`${route}transcripts/2026-08/synthetic.vtt`), staging, {} as ExecutionContext);
    expect(missingToken.status).toBe(401);

    const invalidToken = await apiWorker.fetch(new Request(`${route}transcripts/2026-08/synthetic.vtt`, {
      headers: { authorization: 'Bearer incorrect-token' },
    }), staging, {} as ExecutionContext);
    expect(invalidToken.status).toBe(401);

    const nonApprovedPrefix = await apiWorker.fetch(new Request(`${route}logs/private.txt`, {
      headers: { authorization: 'Bearer reader-token' },
    }), staging, {} as ExecutionContext);
    expect(nonApprovedPrefix.status).toBe(400);

    const traversal = await apiWorker.fetch(new Request(`${route}transcripts/%2e%2e/logs/private.txt`, {
      headers: { authorization: 'Bearer reader-token' },
    }), staging, {} as ExecutionContext);
    expect(traversal.status).toBe(400);

    const nonStaging = await apiWorker.fetch(new Request(`${route}transcripts/2026-08/synthetic.vtt`, {
      headers: { authorization: 'Bearer reader-token' },
    }), environment(storage, 'production'), {} as ExecutionContext);
    expect(nonStaging.status).toBe(404);

    const post = await apiWorker.fetch(new Request(`${route}transcripts/2026-08/synthetic.vtt`, {
      method: 'POST',
      headers: { authorization: 'Bearer reader-token' },
    }), staging, {} as ExecutionContext);
    expect(post.status).toBe(404);
    expect(storage.getCalls).toEqual(['transcripts/2026-08/synthetic.vtt']);
  });
});
