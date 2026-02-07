import { describe, expect, test } from 'bun:test';
import { resolveReference } from '../resolver.js';
import type { ReferenceCandidate } from '../types.js';

describe('reference resolver', () => {
  test('resolves simple id by priority and warns on ambiguity', () => {
    const candidates: ReferenceCandidate[] = [
      { id: 'auth-utils', rootId: 'alpha', sourceRepo: 'company/backend' },
      { id: 'auth-utils', rootId: null, sourceRepo: 'company/backend' },
      { id: 'auth-utils', scope: 'enterprise' },
    ];

    const resolved = resolveReference('auth-utils', {
      rootId: 'alpha',
      repoId: 'company/backend',
      candidates,
    });

    expect(resolved.resolved).toBe(true);
    expect(resolved.targetRootId).toBe('alpha');
    expect(resolved.targetRepo).toBe('company/backend');
    expect(resolved.ambiguous).toBe(true);
    expect(resolved.warning).toContain('root:alpha/auth-utils');
    expect(resolved.warning).toContain('repo:company/backend/auth-utils');
  });

  test('falls back to infra when current root missing', () => {
    const candidates: ReferenceCandidate[] = [
      { id: 'jwt-utils', rootId: null, sourceRepo: 'company/backend' },
    ];

    const resolved = resolveReference('jwt-utils', {
      rootId: 'alpha',
      repoId: 'company/backend',
      candidates,
    });

    expect(resolved.resolved).toBe(true);
    expect(resolved.targetRootId).toBeNull();
    expect(resolved.targetRepo).toBe('company/backend');
  });

  test('marks ambiguous when multiple other roots match', () => {
    const candidates: ReferenceCandidate[] = [
      { id: 'shared', rootId: 'app-1', sourceRepo: 'company/backend' },
      { id: 'shared', rootId: 'app-2', sourceRepo: 'company/backend' },
    ];

    const resolved = resolveReference('shared', {
      rootId: 'alpha',
      repoId: 'company/backend',
      candidates,
    });

    expect(resolved.resolved).toBe(true);
    expect(resolved.targetRootId).toBe('app-1');
    expect(resolved.ambiguous).toBe(true);
  });

  test('resolves explicit repo root reference', () => {
    const resolved = resolveReference('repo:other/repo/root:app/svc', {
      rootId: 'alpha',
      repoId: 'company/backend',
    });

    expect(resolved.resolved).toBe(true);
    expect(resolved.targetRepo).toBe('other/repo');
    expect(resolved.targetRootId).toBe('app');
    expect(resolved.id).toBe('svc');
  });
});
