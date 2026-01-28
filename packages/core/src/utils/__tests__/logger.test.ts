/**
 * Logger 工具测试
 */

import { describe, expect, test } from 'bun:test';
import { Logger } from '../logger.js';

function withConsoleCapture<T>(fn: (output: { log: string[]; warn: string[]; error: string[] }) => T): T {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const output = { log: [] as string[], warn: [] as string[], error: [] as string[] };

  console.log = (message?: unknown, ...rest: unknown[]) => {
    output.log.push([message, ...rest].join(' '));
  };
  console.warn = (message?: unknown, ...rest: unknown[]) => {
    output.warn.push([message, ...rest].join(' '));
  };
  console.error = (message?: unknown, ...rest: unknown[]) => {
    output.error.push([message, ...rest].join(' '));
  };

  try {
    return fn(output);
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

describe('Logger', () => {
  test('respects log level filtering', () => {
    withConsoleCapture((output) => {
      const logger = new Logger({ level: 'warn', format: 'text' });
      logger.info('should not log');
      logger.warn('should log');

      expect(output.log.length).toBe(0);
      expect(output.warn.length).toBe(1);
      expect(output.warn[0]).toContain('WARN');
      expect(output.warn[0]).toContain('should log');
    });
  });

  test('outputs json format', () => {
    withConsoleCapture((output) => {
      const logger = new Logger({ level: 'debug', format: 'json', context: 'test' });
      logger.error('failed', { code: 500 });

      expect(output.error.length).toBe(1);
      const parsed = JSON.parse(output.error[0]);
      expect(parsed.level).toBe('error');
      expect(parsed.message).toBe('failed');
      expect(parsed.context).toBe('test');
      expect(parsed.data).toEqual({ code: 500 });
    });
  });
});
