/**
 * 版本注入工具单元测试
 */

import { describe, expect, test } from 'bun:test';
import { DEFAULT_LATEST_VERSION, injectWorkspaceVersion, resolveVersions } from '../version.js';
import type { Entity } from '../../types/entities.js';

describe('resolveVersions', () => {
  test('uses workspace version when provided', () => {
    expect(resolveVersions(undefined, '1.2.3')).toEqual(['1.2.3']);
  });

  test('falls back to default latest version', () => {
    expect(resolveVersions(undefined)).toEqual([DEFAULT_LATEST_VERSION]);
  });
});

describe('injectWorkspaceVersion', () => {
  test('injects versions when missing', () => {
    const entity: Entity = {
      id: 'payment-service',
      type: 'system',
      scope: 'project',
      name: 'Payment Service',
      status: 'draft',
    };

    const injected = injectWorkspaceVersion(entity, '2.0.0');
    expect(injected.versions).toEqual(['2.0.0']);
    expect(entity.versions).toBeUndefined();
    expect(injected).not.toBe(entity);
  });

  test('keeps existing versions', () => {
    const entity: Entity = {
      id: 'payment-service',
      type: 'system',
      scope: 'project',
      name: 'Payment Service',
      status: 'draft',
      versions: ['1.0.0'],
    };

    const injected = injectWorkspaceVersion(entity, '2.0.0');
    expect(injected.versions).toEqual(['1.0.0']);
  });
});
