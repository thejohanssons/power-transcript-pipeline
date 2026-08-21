import { describe, expect, test } from 'vitest';
import { normalizeEntityKey, normalizeStatement } from './memory-consolidation';

describe('memory consolidation normalization', () => {
  test('normalizes versioned technical entities', () => {
    expect(normalizeEntityKey('Firmware 6.1.0 update')).toBe('firmware');
    expect(normalizeEntityKey('Firmware v6.1.0 readiness')).toBe('firmware');
    expect(normalizeEntityKey('Flutter SDK update')).toBe('flutter sdk');
  });

  test('fingerprints equivalent topic statements consistently', () => {
    expect(normalizeStatement('Firmware 6.1.0 is blocking power optimization.'))
      .toBe(normalizeStatement('Firmware 6.1.0 is blocking power optimization'));
  });
});
