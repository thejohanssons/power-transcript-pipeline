import { describe, expect, it } from 'vitest';
import {
  azureExportRunRequestAction,
  didClaimAzureExportRunProcessing,
} from './azure-export-run-lifecycle';

describe('Azure export run lifecycle', () => {
  it('creates once, replays active or completed work, and only recovers failed reservations', () => {
    expect(azureExportRunRequestAction(undefined)).toBe('create');
    expect(azureExportRunRequestAction('queued')).toBe('replay');
    expect(azureExportRunRequestAction('processing')).toBe('replay');
    expect(azureExportRunRequestAction('completed')).toBe('replay');
    expect(azureExportRunRequestAction('failed')).toBe('recover');
  });

  it('recognizes only one-row conditional claims as processing ownership', () => {
    expect(didClaimAzureExportRunProcessing(1)).toBe(true);
    expect(didClaimAzureExportRunProcessing(0)).toBe(false);
    expect(didClaimAzureExportRunProcessing(2)).toBe(false);
  });
});
