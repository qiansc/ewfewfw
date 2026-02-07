import { describe, expect, test } from 'bun:test';
import { validateReferences } from '../validator.js';
import type { Entity } from '../../../adapter.js';

const now = new Date().toISOString();

function createEntity(status: Entity['metadata']['status'], references: unknown[], candidates?: unknown[]): Entity {
  return {
    id: 'svc',
    root_id: 'alpha',
    type: 'system',
    data: {
      id: 'svc',
      references,
      reference_candidates: candidates ?? [],
    },
    metadata: {
      source_repo: 'company/backend',
      status,
      content_hash: 'hash',
      created_at: now,
      updated_at: now,
    },
  };
}

describe('reference validator', () => {
  test('warns on dangling references for draft entities', () => {
    const entity = createEntity('draft', ['missing'], []);
    const result = validateReferences(entity);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings?.[0]?.code).toBe('C4A-DATA-004');
    expect(result.suggestions?.length).toBeGreaterThan(0);
  });

  test('errors on dangling references for published entities', () => {
    const entity = createEntity('published', ['missing'], []);
    const result = validateReferences(entity);

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]?.code).toBe('C4A-DATA-004');
  });

  test('passes when references are resolved', () => {
    const entity = createEntity('draft', ['existing'], [
      { id: 'existing', root_id: 'alpha', source_repo: 'company/backend' },
    ]);
    const result = validateReferences(entity);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toBeUndefined();
  });

  test('reports invalid reference format', () => {
    const entity = createEntity('draft', ['repo:invalid'], []);
    const result = validateReferences(entity);

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe('C4A-INPUT-002');
  });
});
