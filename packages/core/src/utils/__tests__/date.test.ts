/**
 * 日期工具单元测试
 */

import { describe, expect, test } from 'bun:test';
import {
  ISO_FORMAT,
  DATE_FORMAT,
  TIME_FORMAT,
  now,
  today,
  parseDate,
  isValidDate,
  formatDate,
  formatDateShort,
  formatRelative,
} from '../date.js';

describe('constants', () => {
  test('ISO_FORMAT is correct', () => {
    expect(ISO_FORMAT).toBe('YYYY-MM-DDTHH:mm:ss.SSSZ');
  });

  test('DATE_FORMAT is correct', () => {
    expect(DATE_FORMAT).toBe('YYYY-MM-DD');
  });

  test('TIME_FORMAT is correct', () => {
    expect(TIME_FORMAT).toBe('HH:mm:ss');
  });
});

describe('now', () => {
  test('returns ISO string', () => {
    const result = now();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('returns current time', () => {
    const before = Date.now();
    const result = new Date(now()).getTime();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});

describe('today', () => {
  test('returns date only', () => {
    const result = today();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('parseDate', () => {
  test('parses ISO string', () => {
    const result = parseDate('2024-01-15T10:30:00.000Z');
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe('2024-01-15T10:30:00.000Z');
  });

  test('parses date only string', () => {
    const result = parseDate('2024-01-15');
    expect(result).toBeInstanceOf(Date);
  });

  test('returns null for invalid string', () => {
    expect(parseDate('invalid')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('isValidDate', () => {
  test('returns true for valid date', () => {
    expect(isValidDate('2024-01-15')).toBe(true);
    expect(isValidDate('2024-01-15T10:30:00Z')).toBe(true);
  });

  test('returns false for invalid date', () => {
    expect(isValidDate('invalid')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });
});

describe('formatDate', () => {
  test('formats Date object', () => {
    const date = new Date('2024-01-15T10:30:00.000Z');
    expect(formatDate(date)).toBe('2024-01-15T10:30:00.000Z');
  });

  test('formats string date', () => {
    const result = formatDate('2024-01-15T10:30:00Z');
    expect(result).toMatch(/^2024-01-15T10:30:00/);
  });
});

describe('formatDateShort', () => {
  test('returns date only', () => {
    const date = new Date('2024-01-15T10:30:00.000Z');
    expect(formatDateShort(date)).toBe('2024-01-15');
  });

  test('formats string date', () => {
    expect(formatDateShort('2024-01-15T10:30:00Z')).toBe('2024-01-15');
  });
});

describe('formatRelative', () => {
  test('returns just now for recent time', () => {
    const recent = new Date(Date.now() - 30 * 1000); // 30 seconds ago
    expect(formatRelative(recent)).toBe('just now');
  });

  test('returns minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelative(fiveMinAgo)).toBe('5m ago');
  });

  test('returns hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(formatRelative(twoHoursAgo)).toBe('2h ago');
  });

  test('returns days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatRelative(threeDaysAgo)).toBe('3d ago');
  });

  test('returns unknown for invalid date', () => {
    expect(formatRelative('invalid')).toBe('unknown');
  });
});
