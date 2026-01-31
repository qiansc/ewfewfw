import { describe, expect, test } from 'bun:test';
import { resolveReference } from '../resolver.js';
import type { ReferenceCandidate } from '../types.js';

describe('reference resolver', () => {
  test('resolves simple id by priority and warns on ambiguity', () => {
    const candidates: ReferenceCandidate[] = [
      { id: 'auth-utils', sourceProject: 'alpha', sourceRepo: 'company/backend' },
      { id: 'auth-utils', sourceProject: null, sourceRepo: 'company/backend' },
      { id: 'auth-utils', scope: 'enterprise' },
    ];

    const resolved = resolveReference('auth-utils', {
      projectId: 'alpha',
      repoId: 'company/backend',
      candidates,
    });

    expect(resolved.resolved).toBe(true);
    expect(resolved.targetProject).toBe('alpha');
    expect(resolved.targetRepo).toBe('company/backend');
    expect(resolved.ambiguous).toBe(true);
    expect(resolved.warning).toContain('project:alpha/auth-utils');
    expect(resolved.warning).toContain('repo:company/backend/auth-utils');
  });

  test('falls back to infra when current project missing', () => {
    const candidates: ReferenceCandidate[] = [
      { id: 'jwt-utils', sourceProject: null, sourceRepo: 'company/backend' },
    ];

    const resolved = resolveReference('jwt-utils', {
      projectId: 'alpha',
      repoId: 'company/backend',
      candidates,
    });

    expect(resolved.resolved).toBe(true);
    expect(resolved.targetProject).toBeNull();
    expect(resolved.targetRepo).toBe('company/backend');
  });

  test('marks ambiguous when multiple other projects match', () => {
    const candidates: ReferenceCandidate[] = [
      { id: 'shared', sourceProject: 'app-1', sourceRepo: 'company/backend' },
      { id: 'shared', sourceProject: 'app-2', sourceRepo: 'company/backend' },
    ];

    const resolved = resolveReference('shared', {
      projectId: 'alpha',
      repoId: 'company/backend',
      candidates,
    });

    expect(resolved.resolved).toBe(true);
    expect(resolved.targetProject).toBe('app-1');
    expect(resolved.ambiguous).toBe(true);
  });

  test('resolves explicit repo project reference', () => {
    const resolved = resolveReference('repo:other/repo/project:app/svc', {
      projectId: 'alpha',
      repoId: 'company/backend',
    });

    expect(resolved.resolved).toBe(true);
    expect(resolved.targetRepo).toBe('other/repo');
    expect(resolved.targetProject).toBe('app');
    expect(resolved.id).toBe('svc');
  });
});
