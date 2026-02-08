/**
 * Schema 验证工具测试
 */

import { describe, expect, test } from 'bun:test';
import { validateEntity, validateSchema } from '../schema.js';

describe('validateEntity', () => {
  test('validates spec entity', () => {
    const spec = {
      uuid: '550e8400-e29b-41d4-a716-446655440020',
      root_id: '@acme/payment-service',
      versions: ['1.0.0'],
      id: 'spec-payment-service',
      type: 'spec',
      name: 'Payment Service Spec',
      status: 'draft',
      scope: 'project',
      data: {
        perspective: 'technical',
        format: 'markdown',
        content: '# Payment Spec',
      },
    };

    const result = validateEntity(spec, 'spec');
    expect(result.valid).toBe(true);
  });
});

describe('validateSchema', () => {
  test('validates using schema $id', () => {
    const spec = {
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      root_id: '@acme/payment-service',
      versions: ['1.0.0'],
      id: 'spec-payment-service',
      type: 'spec',
      name: 'Payment Service Spec',
      status: 'draft',
      scope: 'project',
      data: {
        perspective: 'technical',
        format: 'markdown',
        content: '# Payment Spec',
      },
    };

    const result = validateSchema(
      spec,
      'https://context4ai.org/schemas/c4a-spec.schema.json',
    );
    expect(result.valid).toBe(true);
  });
});
