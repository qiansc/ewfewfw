import { describe, expect, test } from 'bun:test';
import { parseReference } from '../parser.js';

describe('reference parser', () => {
  test('parses simple id', () => {
    const parsed = parseReference('payment-service');
    expect(parsed.format).toBe('simple');
    expect(parsed.id).toBe('payment-service');
  });

  test('parses root reference', () => {
    const parsed = parseReference('root:frontend-app/auth');
    expect(parsed.format).toBe('root');
    expect(parsed.rootId).toBe('frontend-app');
    expect(parsed.id).toBe('auth');
  });

  test('parses repo reference', () => {
    const parsed = parseReference('repo:company/shared-lib/jwt-utils');
    expect(parsed.format).toBe('repo');
    expect(parsed.repoId).toBe('company/shared-lib');
    expect(parsed.id).toBe('jwt-utils');
  });

  test('parses repo reference with nested root path', () => {
    const parsed = parseReference('repo:other/repo/root:app/svc');
    expect(parsed.format).toBe('repo');
    expect(parsed.repoId).toBe('other/repo');
    expect(parsed.id).toBe('root:app/svc');
  });

  test('parses scope reference', () => {
    const parsed = parseReference('scope:domain/order-fsm');
    expect(parsed.format).toBe('scope');
    expect(parsed.scope).toBe('domain');
    expect(parsed.id).toBe('order-fsm');
  });

  test('throws on empty reference', () => {
    expect(() => parseReference('  ')).toThrow('Reference string cannot be empty');
  });
});
