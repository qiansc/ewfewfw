/**
 * YAML 工具单元测试
 */

import { describe, expect, test } from 'bun:test';
import {
  parseYAML,
  parseYAMLSafe,
  stringifyYAML,
  validateYAMLSyntax,
} from '../yaml.js';

describe('parseYAML', () => {
  test('parses simple YAML', () => {
    const yaml = 'name: test\nvalue: 123';
    const result = parseYAML<{ name: string; value: number }>(yaml);
    expect(result.name).toBe('test');
    expect(result.value).toBe(123);
  });

  test('parses nested YAML', () => {
    const yaml = `
outer:
  inner: value
`;
    const result = parseYAML<{ outer: { inner: string } }>(yaml);
    expect(result.outer.inner).toBe('value');
  });

  test('parses arrays', () => {
    const yaml = `
items:
  - one
  - two
`;
    const result = parseYAML<{ items: string[] }>(yaml);
    expect(result.items).toEqual(['one', 'two']);
  });
});

describe('parseYAMLSafe', () => {
  test('returns success for valid YAML', () => {
    const yaml = 'name: test';
    const result = parseYAMLSafe<{ name: string }>(yaml);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('test');
    }
  });

  test('returns error for invalid YAML', () => {
    const yaml = '{ invalid: yaml: syntax }';
    const result = parseYAMLSafe(yaml);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});

describe('stringifyYAML', () => {
  test('serializes object to YAML', () => {
    const data = { name: 'test', value: 123 };
    const yaml = stringifyYAML(data);
    expect(yaml).toContain('name: test');
    expect(yaml).toContain('value: 123');
  });

  test('uses custom indent', () => {
    const data = { outer: { inner: 'value' } };
    const yaml = stringifyYAML(data, { indent: 4 });
    expect(yaml).toContain('    inner');
  });
});

describe('validateYAMLSyntax', () => {
  test('returns valid for correct YAML', () => {
    const yaml = 'name: test\nvalue: 123';
    const result = validateYAMLSyntax(yaml);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('returns invalid for incorrect YAML', () => {
    const yaml = '{ bad: yaml: here }';
    const result = validateYAMLSyntax(yaml);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});
