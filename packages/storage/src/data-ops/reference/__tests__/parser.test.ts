import { describe, expect, test } from 'bun:test';
import { parseReference } from '../parser.js';

describe('reference parser', () => {
  test('parses simple id', () => {
    const parsed = parseReference('payment-service');
    expect(parsed.format).toBe('simple');
    expect(parsed.id).toBe('payment-service');
  });

  test('parses project reference', () => {
    const parsed = parseReference('project:frontend-app/auth');
    expect(parsed.format).toBe('project');
    expect(parsed.projectId).toBe('frontend-app');
    expect(parsed.id).toBe('auth');
  });

  test('parses repo reference', () => {
    const parsed = parseReference('repo:company/shared-lib/jwt-utils');
    expect(parsed.format).toBe('repo');
    expect(parsed.repoId).toBe('company/shared-lib');
    expect(parsed.id).toBe('jwt-utils');
  });

  test('parses repo reference with nested project path', () => {
    const parsed = parseReference('repo:other/repo/project:app/svc');
    expect(parsed.format).toBe('repo');
    expect(parsed.repoId).toBe('other/repo');
    expect(parsed.id).toBe('project:app/svc');
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
