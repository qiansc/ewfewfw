/**
 * C4A 日志系统
 *
 * 提供统一的日志记录功能
 */

// ============================================================================
// 日志级别
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ============================================================================
// 日志格式化
// ============================================================================

export type LogFormat = 'json' | 'text';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: string;
  data?: unknown;
}

function formatText(entry: LogEntry): string {
  const prefix = entry.context ? `[${entry.context}]` : '';
  const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
  return `${entry.timestamp} ${entry.level.toUpperCase()} ${prefix} ${entry.message}${dataStr}`;
}

function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

// ============================================================================
// Logger 类
// ============================================================================

export interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
  context?: string;
}

export class Logger {
  private level: LogLevel;
  private format: LogFormat;
  private context?: string;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.format = options.format ?? 'text';
    this.context = options.context;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: this.context,
      data,
    };

    const output = this.format === 'json' ? formatJson(entry) : formatText(entry);

    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  child(context: string): Logger {
    return new Logger({
      level: this.level,
      format: this.format,
      context: this.context ? `${this.context}:${context}` : context,
    });
  }
}

// ============================================================================
// 默认实例
// ============================================================================

/** 默认 logger 实例 */
export const logger = new Logger();

/**
 * 创建带上下文的 logger
 */
export function createLogger(context: string, options?: Omit<LoggerOptions, 'context'>): Logger {
  return new Logger({ ...options, context });
}
