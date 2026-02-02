/**
 * 错误码定义测试
 */

import { describe, expect, test } from 'bun:test';
import {
  ERROR_CODES,
  ERROR_CODE_TO_HTTP_STATUS,
  ERROR_MESSAGES,
  MIGRATE_ERROR_CODES,
  SYS_ERROR_CODES,
} from '../errors.js';

describe('MIGRATE_ERROR_CODES', () => {
  test('includes C4A-MIGRATE-001~008', () => {
    const codes = Object.values(MIGRATE_ERROR_CODES) as Array<
      (typeof MIGRATE_ERROR_CODES)[keyof typeof MIGRATE_ERROR_CODES]
    >;
    const required = [
      'C4A-MIGRATE-001',
      'C4A-MIGRATE-002',
      'C4A-MIGRATE-003',
      'C4A-MIGRATE-004',
      'C4A-MIGRATE-005',
      'C4A-MIGRATE-006',
      'C4A-MIGRATE-007',
      'C4A-MIGRATE-008',
    ] as const;

    for (const code of required) {
      expect(codes).toContain(code);
    }
  });

  test('has messages and http status for migrate codes', () => {
    const codes = Object.values(MIGRATE_ERROR_CODES) as Array<
      (typeof MIGRATE_ERROR_CODES)[keyof typeof MIGRATE_ERROR_CODES]
    >;
    for (const code of codes) {
      expect(ERROR_MESSAGES[code]).toBeDefined();
      expect(ERROR_CODE_TO_HTTP_STATUS[code]).toBeDefined();
    }
  });
});

describe('SYS_ERROR_CODES', () => {
  const gatewayCodes = [
    'C4A-SYS-006',
    'C4A-SYS-007',
    'C4A-SYS-008',
    'C4A-SYS-009',
  ] as const;

  test('includes gateway error codes', () => {
    const codes = Object.values(SYS_ERROR_CODES) as Array<
      (typeof SYS_ERROR_CODES)[keyof typeof SYS_ERROR_CODES]
    >;
    const allCodes = Object.values(ERROR_CODES) as Array<
      (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
    >;
    for (const code of gatewayCodes) {
      expect(codes).toContain(code);
      expect(allCodes).toContain(code);
    }
  });

  test('has messages and http status for gateway codes', () => {
    for (const code of gatewayCodes) {
      expect(ERROR_MESSAGES[code]).toBeDefined();
      expect(ERROR_CODE_TO_HTTP_STATUS[code]).toBeDefined();
    }
  });
});
