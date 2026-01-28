/**
 * Feat 状态流转测试
 */

import { describe, expect, test } from 'bun:test';
import { isValidFeatStatusTransition } from '../feat.js';

describe('isValidFeatStatusTransition', () => {
  test('allows feat-specific transitions', () => {
    expect(isValidFeatStatusTransition('published', 'archived')).toBe(true);
  });

  test('rejects invalid transitions', () => {
    expect(isValidFeatStatusTransition('approved', 'archived')).toBe(false);
    expect(isValidFeatStatusTransition('archived', 'draft')).toBe(false);
  });
});
