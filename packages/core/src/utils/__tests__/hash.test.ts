/**
 * 哈希工具单元测试
 */

import { describe, expect, test } from 'bun:test';
import {
  computeHash,
  normalizeForHash,
  computeContentHash,
  isContentEqual,
  shortHash,
} from '../hash.js';

describe('computeHash', () => {
  test('returns SHA-256 hash', () => {
    const hash = computeHash('hello');
    expect(hash).toHaveLength(64);
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  test('same input produces same hash', () => {
    expect(computeHash('test')).toBe(computeHash('test'));
  });

  test('different input produces different hash', () => {
    expect(computeHash('a')).not.toBe(computeHash('b'));
  });
});

describe('normalizeForHash', () => {
  test('excludes timestamp fields', () => {
    const obj = {
      id: 'test',
      name: 'Test',
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
    };
    const normalized = normalizeForHash(obj);
    expect(normalized).toEqual({ id: 'test', name: 'Test' });
  });

  test('excludes content_hash and metadata fields', () => {
    const obj = {
      id: 'test',
      content_hash: 'abc123',
      requirement_id: '550e8400-e29b-41d4-a716-446655440001',
      _id: 'mongo-id',
      __v: 1,
    };
    const normalized = normalizeForHash(obj);
    expect(normalized).toEqual({ id: 'test' });
  });

  test('sorts keys alphabetically', () => {
    const obj = { z: 1, a: 2, m: 3 };
    const normalized = normalizeForHash(obj);
    const keys = Object.keys(normalized);
    expect(keys).toEqual(['a', 'm', 'z']);
  });

  test('handles nested objects', () => {
    const obj = {
      outer: { z: 1, a: 2 },
    };
    const normalized = normalizeForHash(obj);
    const innerKeys = Object.keys((normalized.outer as Record<string, unknown>));
    expect(innerKeys).toEqual(['a', 'z']);
  });

  test('handles arrays', () => {
    const obj = {
      items: [{ b: 2, a: 1 }, { d: 4, c: 3 }],
    };
    const normalized = normalizeForHash(obj);
    expect(normalized.items).toHaveLength(2);
  });

  test('removes null and undefined keys', () => {
    const obj = { a: undefined, b: null };
    const normalized = normalizeForHash(obj);
    expect(normalized).toEqual({});
  });
});

describe('computeContentHash', () => {
  test('computes hash for entity', () => {
    const entity = { id: 'test', name: 'Test Entity' };
    const hash = computeContentHash(entity);
    expect(hash).toHaveLength(64);
  });

  test('ignores excluded fields', () => {
    const entity1 = { id: 'test', name: 'Test' };
    const entity2 = { id: 'test', name: 'Test', created_at: '2024-01-01' };
    expect(computeContentHash(entity1)).toBe(computeContentHash(entity2));
  });

  test('different content produces different hash', () => {
    const entity1 = { id: 'test', name: 'A' };
    const entity2 = { id: 'test', name: 'B' };
    expect(computeContentHash(entity1)).not.toBe(computeContentHash(entity2));
  });
});

describe('isContentEqual', () => {
  test('returns true for equal content', () => {
    const entity1 = { id: 'test', name: 'Test' };
    const entity2 = { id: 'test', name: 'Test' };
    expect(isContentEqual(entity1, entity2)).toBe(true);
  });

  test('returns true ignoring timestamps', () => {
    const entity1 = { id: 'test', created_at: '2024-01-01' };
    const entity2 = { id: 'test', created_at: '2024-01-02' };
    expect(isContentEqual(entity1, entity2)).toBe(true);
  });

  test('returns false for different content', () => {
    const entity1 = { id: 'test', name: 'A' };
    const entity2 = { id: 'test', name: 'B' };
    expect(isContentEqual(entity1, entity2)).toBe(false);
  });
});

describe('shortHash', () => {
  test('returns first 8 characters by default', () => {
    const hash = shortHash('hello');
    expect(hash).toHaveLength(8);
    expect(hash).toBe('2cf24dba');
  });

  test('returns custom length', () => {
    const hash = shortHash('hello', 12);
    expect(hash).toHaveLength(12);
  });
});
