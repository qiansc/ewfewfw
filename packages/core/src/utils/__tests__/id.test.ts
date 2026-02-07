/**
 * ID 工具单元测试
 */

import { describe, expect, test } from 'bun:test';
import {
  isValidKebabCase,
  isValidSequence,
  isValidEntityId,
  incrementSequence,
  getInitialSequence,
  toKebabCase,
  generateEntityId,
  parseEntityId,
} from '../id.js';

describe('isValidKebabCase', () => {
  test('valid kebab-case', () => {
    expect(isValidKebabCase('hello')).toBe(true);
    expect(isValidKebabCase('hello-world')).toBe(true);
    expect(isValidKebabCase('my-component-name')).toBe(true);
    expect(isValidKebabCase('a1-b2-c3')).toBe(true);
  });

  test('invalid kebab-case', () => {
    expect(isValidKebabCase('')).toBe(false);
    expect(isValidKebabCase('Hello')).toBe(false);
    expect(isValidKebabCase('hello_world')).toBe(false);
    expect(isValidKebabCase('hello--world')).toBe(false);
    expect(isValidKebabCase('-hello')).toBe(false);
    expect(isValidKebabCase('hello-')).toBe(false);
    expect(isValidKebabCase('1hello')).toBe(false);
  });
});

describe('isValidSequence', () => {
  test('valid sequence', () => {
    expect(isValidSequence('001')).toBe(true);
    expect(isValidSequence('a001')).toBe(true);
    expect(isValidSequence('z999')).toBe(true);
    expect(isValidSequence('m123')).toBe(true);
  });

  test('invalid sequence', () => {
    expect(isValidSequence('')).toBe(false);
    expect(isValidSequence('A001')).toBe(false);
    expect(isValidSequence('a01')).toBe(false);
    expect(isValidSequence('a0001')).toBe(false);
    expect(isValidSequence('1001')).toBe(false);
    expect(isValidSequence('aa01')).toBe(false);
  });
});

describe('isValidEntityId', () => {
  test('valid feat ID', () => {
    expect(isValidEntityId('feat-user-login', 'feat')).toBe(true);
    expect(isValidEntityId('feat-dark-mode', 'feat')).toBe(true);
  });

  test('valid adr ID', () => {
    expect(isValidEntityId('adr-001-introduce-mq', 'adr')).toBe(true);
    expect(isValidEntityId('adr-b002-introduce-mq', 'adr')).toBe(true);
  });

  test('valid process ID', () => {
    expect(isValidEntityId('prc-b-001', 'process')).toBe(true);
    expect(isValidEntityId('prc-t-z999', 'process')).toBe(true);
  });

  test('valid sor ID', () => {
    expect(isValidEntityId('sor-b-001', 'sor')).toBe(true);
    expect(isValidEntityId('sor-t-m123', 'sor')).toBe(true);
  });

  test('valid kebab-case ID for other types', () => {
    expect(isValidEntityId('my-system', 'system')).toBe(true);
    expect(isValidEntityId('auth-service', 'container')).toBe(true);
    expect(isValidEntityId('@byted-tiktok/tux-web', 'component')).toBe(true);
  });
});

describe('incrementSequence', () => {
  test('increment numeric sequence', () => {
    expect(incrementSequence('001')).toBe('002');
    expect(incrementSequence('099')).toBe('100');
    expect(incrementSequence('999')).toBe('a001');
  });

  test('increment within same letter', () => {
    expect(incrementSequence('a001')).toBe('a002');
    expect(incrementSequence('a099')).toBe('a100');
    expect(incrementSequence('a998')).toBe('a999');
  });

  test('increment to next letter', () => {
    expect(incrementSequence('a999')).toBe('b001');
    expect(incrementSequence('m999')).toBe('n001');
  });

  test('throws on overflow at z999', () => {
    expect(() => incrementSequence('z999')).toThrow('Sequence overflow');
  });
});

describe('getInitialSequence', () => {
  test('returns 001', () => {
    expect(getInitialSequence()).toBe('001');
  });
});

describe('toKebabCase', () => {
  test('converts spaces to hyphens', () => {
    expect(toKebabCase('hello world')).toBe('hello-world');
    expect(toKebabCase('my component name')).toBe('my-component-name');
  });

  test('converts to lowercase', () => {
    expect(toKebabCase('Hello World')).toBe('hello-world');
    expect(toKebabCase('HELLO')).toBe('hello');
  });

  test('handles special characters', () => {
    expect(toKebabCase('hello_world')).toBe('hello-world');
    // 点号会被移除而不是转换
    expect(toKebabCase('hello.world')).toBe('helloworld');
  });

  test('removes consecutive hyphens', () => {
    expect(toKebabCase('hello  world')).toBe('hello-world');
    expect(toKebabCase('hello--world')).toBe('hello-world');
  });

  test('trims leading/trailing hyphens', () => {
    expect(toKebabCase(' hello ')).toBe('hello');
    expect(toKebabCase('-hello-')).toBe('hello');
  });
});

describe('generateEntityId', () => {
  test('generates feat ID', () => {
    const id = generateEntityId('feat', 'User Login');
    expect(id).toBe('feat-user-login');
  });

  test('generates adr ID', () => {
    const id = generateEntityId('adr', 'Introduce MQ', '001');
    expect(id).toBe('adr-001-introduce-mq');
  });

  test('generates process ID with perspective', () => {
    const bizId = generateEntityId('process', 'Order Flow', '001', 'business');
    expect(bizId).toBe('prc-b-001');

    const techId = generateEntityId('process', 'Data Sync', '001', 'technical');
    expect(techId).toBe('prc-t-001');
  });

  test('generates sor ID with perspective', () => {
    const bizId = generateEntityId('sor', 'User Profile', '001', 'business');
    expect(bizId).toBe('sor-b-001');

    const techId = generateEntityId('sor', 'Cache Store', '001', 'technical');
    expect(techId).toBe('sor-t-001');
  });

  test('generates simple kebab-case ID for other types', () => {
    const sysId = generateEntityId('system', 'E-Commerce Platform');
    expect(sysId).toBe('e-commerce-platform');

    const containerId = generateEntityId('container', 'Auth Service');
    expect(containerId).toBe('auth-service');
  });
});

describe('parseEntityId', () => {
  test('parses feat ID', () => {
    const result = parseEntityId('feat-user-login');
    expect(result.type).toBe('feat');
    expect(result.sequence).toBeNull();
    expect(result.name).toBe('user-login');
    expect(result.raw).toBe('feat-user-login');
  });

  test('parses adr ID', () => {
    const result = parseEntityId('adr-001-introduce-mq');
    expect(result.type).toBe('adr');
    expect(result.sequence).toBe('001');
    expect(result.name).toBe('introduce-mq');
  });

  test('parses process ID with perspective', () => {
    const bizResult = parseEntityId('prc-b-001');
    expect(bizResult.type).toBe('process');
    expect(bizResult.perspective).toBe('business');
    expect(bizResult.sequence).toBe('001');

    const techResult = parseEntityId('prc-t-001');
    expect(techResult.type).toBe('process');
    expect(techResult.perspective).toBe('technical');
  });

  test('parses sor ID with perspective', () => {
    const bizResult = parseEntityId('sor-b-001');
    expect(bizResult.type).toBe('sor');
    expect(bizResult.perspective).toBe('business');
    expect(bizResult.sequence).toBe('001');
  });

  test('returns object with null fields for invalid ID', () => {
    const result = parseEntityId('');
    expect(result.type).toBeNull();
    expect(result.sequence).toBeNull();
  });
});
