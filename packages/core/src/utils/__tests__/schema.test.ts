/**
 * Schema 验证工具测试
 */

import { describe, expect, test } from 'bun:test';
import { validateEntity, validateSchema } from '../schema.js';

describe('validateEntity', () => {
  test('validates feat entity', () => {
    const feat = {
      id: 'feat-a001-test',
      type: 'feat',
      name: 'Test Feat',
      status: 'draft',
      source_project: 'demo-project',
      created_at: new Date().toISOString(),
    };

    const result = validateEntity(feat, 'feat');
    expect(result.valid).toBe(true);
  });

  test('validates checklist entity', () => {
    const checklist = {
      id: 'checklist-001',
      feat_id: 'feat-a001-test',
      title: 'Release Checklist',
      items: [
        {
          id: 'item-1',
          content: 'Run tests',
          type: 'task',
          status: 'pending',
        },
      ],
      created_at: new Date().toISOString(),
    };

    const result = validateEntity(checklist, 'checklist');
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
      id: 'feat-a001-test',
      type: 'feat',
      name: 'Test Feat',
      status: 'draft',
      source_project: 'demo-project',
      created_at: new Date().toISOString(),
    };

    const result = validateSchema(
      feat,
      'https://context4ai.org/schemas/c4a-feat.schema.json',
    );
    expect(result.valid).toBe(true);
  });
});
