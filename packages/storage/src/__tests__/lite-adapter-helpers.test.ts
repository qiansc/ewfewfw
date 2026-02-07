// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import {
  computeHash,
  extractSnippet,
  formatContent,
  generateSearchText,
  normalizeRequirementId,
  normalizeRequirementIdForQuery,
  parseContent,
  rowToEntity,
} from '../lite-adapter/helpers.js';
import type { EntityRow } from '../lite-adapter/types.js';

describe('lite-adapter helpers', () => {
  test('parse/format content roundtrip for json and yaml', () => {
    const data = { name: 'Demo', tags: ['a', 'b'], nested: { enabled: true } };

    const json = formatContent(data, 'json');
    expect(json).toContain('"name"');
    expect(parseContent(json, 'json')).toEqual(data);

    const yaml = formatContent(data, 'yaml');
    const parsed = parseContent(yaml, 'yaml');
    expect(parsed).toEqual(data);
  });

  test('computeHash is deterministic and ignores ordering', () => {
    const dataA = { name: 'Alpha', meta: { b: 2, a: 1 } };
    const dataB = { meta: { a: 1, b: 2 }, name: 'Alpha' };
    expect(computeHash(dataA)).toBe(computeHash(dataB));
  });

  test('normalizeRequirementId helpers', () => {
    expect(normalizeRequirementId(undefined)).toBeNull();
    expect(normalizeRequirementId(null)).toBeNull();
    expect(normalizeRequirementId('feat-1')).toBe('feat-1');
    expect(normalizeRequirementId(['feat-2'])).toBe('feat-2');
    expect(normalizeRequirementId([])).toBeNull();

    expect(normalizeRequirementIdForQuery(undefined)).toBeNull();
    expect(normalizeRequirementIdForQuery(null)).toBeNull();
    expect(normalizeRequirementIdForQuery('feat-3')).toEqual(['feat-3']);
    expect(normalizeRequirementIdForQuery(['feat-4', 'feat-5'])).toEqual(['feat-4', 'feat-5']);
    expect(normalizeRequirementIdForQuery([])).toBeNull();
  });

  test('rowToEntity maps database row to entity object', () => {
    const row: EntityRow = {
      uuid: 'uuid-1',
      id: 'sys-1',
      root_id: 'alpha',
      type: 'system',
      kind: null,
      scope: 'project',
      perspective: null,
      data: JSON.stringify({ name: 'System' }),
      requirement_id: null,
      component_id: null,
      status: 'approved',
      content_hash: 'hash',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      source_repo: null,
      external_url: null,
      created_by: null,
      updated_by: 'user-1',
    };

    const entity = rowToEntity(row, ['0.0.0']);
    expect(entity.id).toBe('sys-1');
    expect(entity.uuid).toBe('uuid-1');
    expect(entity.root_id).toBe('alpha');
    expect(entity.versions).toEqual(['0.0.0']);
    expect(entity.data).toEqual({ name: 'System' });
    expect(entity.metadata.updated_by).toBe('user-1');
  });

  test('extractSnippet highlights query and limits length', () => {
    const data = {
      name: 'Payment Service',
      description: 'Handles payment flows for checkout',
      title: 'Payment',
    };
    const snippet = extractSnippet(data, 'payment');
    expect(snippet.toLowerCase()).toContain('payment');

    const missing = extractSnippet({ name: 'Alpha', description: 'Beta' }, 'gamma');
    expect(missing.length).toBeLessThanOrEqual(100);
  });

  test('generateSearchText joins tags and fields', () => {
    const text = generateSearchText({
      name: 'Order',
      description: 'Order service',
      tags: ['sales', 'core'],
    });
    expect(text).toContain('Order');
    expect(text).toContain('Order service');
    expect(text).toContain('sales core');
  });
});
