/**
 * 基础类型与状态流转测试
 */

import { describe, expect, test } from 'bun:test';
import { isValidStatusTransition } from '../base.js';

describe('isValidStatusTransition', () => {
  test('allows expected transitions', () => {
    expect(isValidStatusTransition('draft', 'approved')).toBe(true);
    expect(isValidStatusTransition('deprecated', 'archived')).toBe(true);
  });

  test('rejects invalid transitions', () => {
    expect(isValidStatusTransition('draft', 'published')).toBe(false);
    expect(isValidStatusTransition('published', 'archived')).toBe(false);
  });
});
