/**
 * 模式切换相关错误
 */

export type MigrationErrorCode =
  | 'C4A-MIGRATE-001' // 版本不兼容
  | 'C4A-MIGRATE-002' // 数据格式错误
  | 'C4A-MIGRATE-003' // 权限不足
  | 'C4A-MIGRATE-004'; // 连接失败

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: MigrationErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'MigrationError';
  }
}

export function isMigrationError(error: unknown): error is MigrationError {
  return error instanceof MigrationError;
}
