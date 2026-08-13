import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const required = {
  CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_D1_READ_TOKEN: 'read-token', RUNTIME_D1_DATABASE_ID: 'runtime-db',
  CLOUDFLARE_FEEDBACK_TOKEN: 'feedback-token', FEEDBACK_D1_DATABASE_ID: 'feedback-db',
  RUNTIME_REVIEW_API_URL: 'http://127.0.0.1:8787', RUNTIME_REVIEW_DECISION_TOKEN: 'decision-token',
};

afterEach(() => { for (const key of Object.keys(required)) delete process.env[key]; });

describe('local runtime command environment', () => {
  it('requires the Worker URL and decision token', () => {
    Object.assign(process.env, required);
    expect(loadEnv()).toMatchObject({ RUNTIME_REVIEW_API_URL: required.RUNTIME_REVIEW_API_URL, RUNTIME_REVIEW_DECISION_TOKEN: required.RUNTIME_REVIEW_DECISION_TOKEN });
  });
  it('fails closed when the Worker decision token is absent', () => {
    Object.assign(process.env, required);
    delete process.env.RUNTIME_REVIEW_DECISION_TOKEN;
    expect(() => loadEnv()).toThrow(/RUNTIME_REVIEW_DECISION_TOKEN/);
  });
});
