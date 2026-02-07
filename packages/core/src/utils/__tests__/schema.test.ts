/**
 * Schema 验证工具测试
 */

import { describe, expect, test } from 'bun:test';
import { validateEntity, validateSchema } from '../schema.js';

describe('validateEntity', () => {
  test('validates feat entity', () => {
    const feat = {
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      root_id: '',
      versions: ['0.0.0'],
      id: 'feat-user-login',
      type: 'feat',
      name: 'Test Feat',
      status: 'draft',
      scope: 'project',
      created_at: new Date().toISOString(),
    };

    const result = validateEntity(feat, 'feat');
    expect(result.valid).toBe(true);
  });

  test('validates checklist entity', () => {
    const checklist = {
      uuid: '550e8400-e29b-41d4-a716-446655440010',
      root_id: '',
      versions: ['0.0.0'],
      id: 'checklist-user-login',
      type: 'checklist',
      name: 'User Login Checklist',
      status: 'draft',
      scope: 'project',
      metadata: {
        feat_id: 'feat-user-login',
        generated_at: new Date().toISOString(),
        source: 'technical_spec',
      },
      updated_at: new Date().toISOString(),
      updated_by: 'tester',
      items: [
        {
          id: 'task-1',
          title: 'Run tests',
          type: 'test',
          status: 'pending',
        },
      ],
    };

    const result = validateEntity(checklist, 'checklist');
    expect(result.valid).toBe(true);
  });

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

  test('reports errors for invalid feat entity', () => {
    const invalidFeat = {
      type: 'feat',
      name: 'Missing required fields',
    };

    const result = validateEntity(invalidFeat, 'feat');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('validateSchema', () => {
  test('validates using schema $id', () => {
    const feat = {
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      root_id: '',
      versions: ['0.0.0'],
      id: 'feat-user-login',
      type: 'feat',
      name: 'Test Feat',
      status: 'draft',
      scope: 'project',
      created_at: new Date().toISOString(),
    };

    const result = validateSchema(
      feat,
      'https://context4ai.org/schemas/c4a-feat.schema.json',
    );
    expect(result.valid).toBe(true);
  });
});
