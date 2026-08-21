import { describe, expect, test } from 'vitest';
import { correctTechnicalDeliveryRiskClassification } from './meeting-processing';

describe('controlled entity classification corrections', () => {
  test('maps a product camera service classification to Technology Platform', () => {
    const result = correctTechnicalDeliveryRiskClassification({
      entityType: 'Service',
      entity: 'Inspire QR-login camera',
      topicStatement: 'The web camera freezes when reopened and requires a browser workaround.',
      summary: null,
      keyFacts: [{ id: 'fact-1', text: 'The camera feed becomes stuck after reopening in the browser.' }],
      domain: 'Product Management',
      aspect: 'Quality',
      outcome: 'Issue',
      disposition: 'Deferral',
    });

    expect(result.entityType).toBe('Technology Platform');
    expect(result.domain).toBe('Product Management');
    expect(result.aspect).toBe('Performance');
    expect(result.outcome).toBe('Risk');
    expect(result.disposition).toBe('Deferral');
  });

  test('does not relabel an ordinary operational service', () => {
    const result = correctTechnicalDeliveryRiskClassification({
      entityType: 'Service',
      entity: 'Customer support service',
      topicStatement: 'Customer support service coverage is being monitored.',
      summary: null,
      keyFacts: [{ id: 'fact-1', text: 'Support coverage is staffed for the current quarter.' }],
      domain: 'Product Management',
      aspect: 'Capability',
      outcome: 'Progress',
      disposition: 'Monitoring',
    });

    expect(result.entityType).toBe('Service');
    expect(result.outcome).toBe('Progress');
  });
});
