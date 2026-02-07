/**
 * UUID 工具单元测试
 */

import { describe, expect, test } from 'bun:test';
import { generateUuid, isUuidV4 } from '../uuid.js';

describe('generateUuid', () => {
  test('generates valid uuid v4', () => {
    const uuid = generateUuid();
    expect(isUuidV4(uuid)).toBe(true);
  });
});

