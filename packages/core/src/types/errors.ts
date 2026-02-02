/**
 * C4A 错误类型定义
 *
 * 错误码格式：C4A-{类别}-{编号}
 * 类别：INPUT | DATA | SYS | BIZ | STORE | PERM | MIGRATE
 */

// ============================================================================
// 错误类别
// ============================================================================

/**
 * 错误类别
 */
export type ErrorCategory =
  | 'INPUT' // 用户输入错误
  | 'DATA' // 数据一致性错误
  | 'SYS' // 系统错误
  | 'BIZ' // 业务逻辑错误
  | 'STORE' // 存储操作
  | 'PERM' // 权限错误
  | 'MIGRATE' // 数据迁移错误
  | 'EXTRACT' // Extract MCP 错误
  | 'QUERY' // Query MCP 错误
  | 'VISUAL'; // Visual MCP 错误

// ============================================================================
// 错误码定义
// ============================================================================

/**
 * INPUT 类错误码
 */
export const INPUT_ERROR_CODES = {
  MISSING_REQUIRED_FIELD: 'C4A-INPUT-001', // 缺少必填字段
  INVALID_FIELD_FORMAT: 'C4A-INPUT-002', // 字段格式错误
  FIELD_OUT_OF_RANGE: 'C4A-INPUT-003', // 字段值超出范围
  INVALID_ENTITY_TYPE: 'C4A-INPUT-004', // 无效的实体类型
  INVALID_ID_FORMAT: 'C4A-INPUT-005', // 无效的 ID 格式
  PATH_TRAVERSAL: 'C4A-INPUT-006', // 路径遍历攻击
  INVALID_PATH_CHARS: 'C4A-INPUT-007', // 路径包含非法字符
} as const;

/**
 * DATA 类错误码
 */
export const DATA_ERROR_CODES = {
  ENTITY_NOT_FOUND: 'C4A-DATA-001', // 引用的实体不存在
  ENTITY_ALREADY_EXISTS: 'C4A-DATA-002', // 实体已存在
  CIRCULAR_DEPENDENCY: 'C4A-DATA-003', // 循环依赖
  DANGLING_REFERENCE: 'C4A-DATA-004', // 悬空引用
  VERSION_CONFLICT: 'C4A-DATA-005', // 版本冲突
  RELATION_TYPE_MISMATCH: 'C4A-DATA-006', // 关系类型不匹配
  INVALID_CROSS_SCOPE_REFERENCE: 'C4A-DATA-007', // 跨层级引用无效
} as const;

/**
 * SYS 类错误码
 */
export const SYS_ERROR_CODES = {
  DATABASE_CONNECTION_FAILED: 'C4A-SYS-001', // 数据库连接失败
  MCP_TIMEOUT: 'C4A-SYS-002', // MCP 工具调用超时
  INTERNAL_ERROR: 'C4A-SYS-003', // 内部服务错误
  VECTOR_SERVICE_UNAVAILABLE: 'C4A-SYS-004', // 向量搜索服务不可用
  REMOTE_SERVICE_UNAVAILABLE: 'C4A-SYS-005', // 远程服务不可用
  GATEWAY_TIMEOUT: 'C4A-SYS-006', // Gateway 超时
  GATEWAY_BAD_GATEWAY: 'C4A-SYS-007', // 上游服务错误
  GATEWAY_SERVICE_UNAVAILABLE: 'C4A-SYS-008', // Gateway 服务不可用
  TRANSPORT_ERROR: 'C4A-SYS-009', // 传输层错误（stdio/http 通用）
} as const;

/**
 * BIZ 类错误码
 */
export const BIZ_ERROR_CODES = {
  INVALID_STATUS_TRANSITION: 'C4A-BIZ-001', // 非法状态流转
  FEAT_STATUS_NOT_ALLOWED: 'C4A-BIZ-002', // feat 状态不允许操作
  CONSISTENCY_CHECK_FAILED: 'C4A-BIZ-003', // 一致性检查失败
  MERGE_CONFLICT: 'C4A-BIZ-004', // 合并冲突
  ENTITY_REFERENCED: 'C4A-BIZ-005', // 实体被引用，无法删除
  CROSS_PROJECT_APPROVAL_REQUIRED: 'C4A-BIZ-006', // 跨项目 feat 需要多方批准
} as const;

/**
 * STORE 类错误码
 */
export const STORE_ERROR_CODES = {
  CONCURRENT_MODIFICATION_WARNING: 'C4A-STORE-001', // 并发修改警告
  MISSING_ADR: 'C4A-STORE-002', // 缺少关联 ADR
  ENTITY_REFERENCED_CANNOT_DELETE: 'C4A-STORE-003', // 实体被其他实体引用，无法删除
  ENTITY_IN_FEAT_CANNOT_DELETE: 'C4A-STORE-004', // 实体正在被 feat 修改，无法删除
} as const;

/**
 * PERM 类错误码
 */
export const PERM_ERROR_CODES = {
  NO_WRITE_PERMISSION: 'C4A-PERM-001', // 无写权限
  NO_APPROVE_PERMISSION: 'C4A-PERM-002', // 无批准权限
  NO_READ_PERMISSION: 'C4A-PERM-003', // 无读权限
  AUTHENTICATION_FAILED: 'C4A-PERM-004', // 认证失败
  CROSS_PROJECT_PERMISSION_DENIED: 'C4A-PERM-005', // 跨项目操作权限不足
} as const;

/**
 * MIGRATE 类错误码
 */
export const MIGRATE_ERROR_CODES = {
  MISSING_SOURCE_PROJECT: 'C4A-MIGRATE-001', // 缺少 source_project 字段
  MISSING_SOURCE_REPO: 'C4A-MIGRATE-002', // 缺少 source_repo 字段
  INVALID_SOURCE_PROJECT_FORMAT: 'C4A-MIGRATE-003', // source_project 格式不正确
  SOURCE_REPO_FORMAT_SUGGESTION: 'C4A-MIGRATE-004', // source_repo 格式建议改进
  NON_PROJECT_SCOPE_HAS_SOURCE_PROJECT: 'C4A-MIGRATE-005', // Domain/Enterprise 层级不应有 source_project
  NON_PROJECT_SCOPE_HAS_SOURCE_REPO: 'C4A-MIGRATE-006', // Domain/Enterprise 层级不应有 source_repo
  EXTERNAL_ENTITY_HAS_SOURCE_PROJECT: 'C4A-MIGRATE-007', // external 实体不应有 source_project
  EXTERNAL_ENTITY_MISSING_URL: 'C4A-MIGRATE-008', // external 实体缺少 external_url
} as const;

/**
 * EXTRACT 类错误码
 */
export const EXTRACT_ERROR_CODES = {
  INTERNAL_ERROR: 'C4A-EXTRACT-001', // Extract MCP 内部错误
} as const;

/**
 * QUERY 类错误码
 */
export const QUERY_ERROR_CODES = {
  INTERNAL_ERROR: 'C4A-QUERY-001', // Query MCP 内部错误
} as const;

/**
 * VISUAL 类错误码
 */
export const VISUAL_ERROR_CODES = {
  INTERNAL_ERROR: 'C4A-VISUAL-001', // Visual MCP 内部错误
} as const;

/**
 * 所有错误码
 */
export const ERROR_CODES = {
  ...INPUT_ERROR_CODES,
  ...DATA_ERROR_CODES,
  ...SYS_ERROR_CODES,
  ...BIZ_ERROR_CODES,
  ...STORE_ERROR_CODES,
  ...PERM_ERROR_CODES,
  ...MIGRATE_ERROR_CODES,
  ...EXTRACT_ERROR_CODES,
  ...QUERY_ERROR_CODES,
  ...VISUAL_ERROR_CODES,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ============================================================================
// 错误码到 HTTP 状态码映射
// ============================================================================

export const ERROR_CODE_TO_HTTP_STATUS: Record<ErrorCode, number> = {
  // INPUT
  'C4A-INPUT-001': 400,
  'C4A-INPUT-002': 400,
  'C4A-INPUT-003': 400,
  'C4A-INPUT-004': 400,
  'C4A-INPUT-005': 400,
  'C4A-INPUT-006': 400,
  'C4A-INPUT-007': 400,
  // DATA
  'C4A-DATA-001': 404,
  'C4A-DATA-002': 409,
  'C4A-DATA-003': 422,
  'C4A-DATA-004': 422,
  'C4A-DATA-005': 409,
  'C4A-DATA-006': 422,
  'C4A-DATA-007': 422,
  // SYS
  'C4A-SYS-001': 503,
  'C4A-SYS-002': 504,
  'C4A-SYS-003': 500,
  'C4A-SYS-004': 503,
  'C4A-SYS-005': 503,
  'C4A-SYS-006': 504,
  'C4A-SYS-007': 502,
  'C4A-SYS-008': 503,
  'C4A-SYS-009': 500,
  // BIZ
  'C4A-BIZ-001': 422,
  'C4A-BIZ-002': 422,
  'C4A-BIZ-003': 422,
  'C4A-BIZ-004': 422,
  'C4A-BIZ-005': 422,
  'C4A-BIZ-006': 422,
  // STORE
  'C4A-STORE-001': 200, // 警告，不是错误
  'C4A-STORE-002': 422,
  'C4A-STORE-003': 422,
  'C4A-STORE-004': 422,
  // PERM
  'C4A-PERM-001': 403,
  'C4A-PERM-002': 403,
  'C4A-PERM-003': 403,
  'C4A-PERM-004': 401,
  'C4A-PERM-005': 403,
  // MIGRATE
  'C4A-MIGRATE-001': 422,
  'C4A-MIGRATE-002': 422,
  'C4A-MIGRATE-003': 422,
  'C4A-MIGRATE-004': 422,
  'C4A-MIGRATE-005': 422,
  'C4A-MIGRATE-006': 422,
  'C4A-MIGRATE-007': 422,
  'C4A-MIGRATE-008': 422,
  'C4A-EXTRACT-001': 500,
  'C4A-QUERY-001': 500,
  'C4A-VISUAL-001': 500,
};

// ============================================================================
// 错误消息（多语言支持）
// ============================================================================

export const ERROR_MESSAGES: Record<ErrorCode, { zh: string; en: string }> = {
  // INPUT
  'C4A-INPUT-001': { zh: '缺少必填字段', en: 'Missing required field' },
  'C4A-INPUT-002': { zh: '字段格式错误', en: 'Invalid field format' },
  'C4A-INPUT-003': { zh: '字段值超出范围', en: 'Field value out of range' },
  'C4A-INPUT-004': { zh: '无效的实体类型', en: 'Invalid entity type' },
  'C4A-INPUT-005': { zh: '无效的 ID 格式', en: 'Invalid ID format' },
  'C4A-INPUT-006': { zh: '路径必须在项目根目录内', en: 'Path must be within project root' },
  'C4A-INPUT-007': { zh: '路径包含非法字符', en: 'Path contains invalid characters' },
  // DATA
  'C4A-DATA-001': { zh: '引用的实体不存在', en: 'Referenced entity not found' },
  'C4A-DATA-002': { zh: '实体已存在', en: 'Entity already exists' },
  'C4A-DATA-003': { zh: '检测到循环依赖', en: 'Circular dependency detected' },
  'C4A-DATA-004': { zh: '存在悬空引用', en: 'Dangling reference detected' },
  'C4A-DATA-005': { zh: '版本冲突，请获取最新版本', en: 'Version conflict, please fetch latest' },
  'C4A-DATA-006': { zh: '关系类型不匹配', en: 'Relation type mismatch' },
  'C4A-DATA-007': { zh: '跨层级引用无效', en: 'Invalid cross-scope reference' },
  // SYS
  'C4A-SYS-001': { zh: '数据库连接失败', en: 'Database connection failed' },
  'C4A-SYS-002': { zh: 'MCP 工具调用超时', en: 'MCP tool call timeout' },
  'C4A-SYS-003': { zh: '内部服务错误', en: 'Internal service error' },
  'C4A-SYS-004': { zh: '向量搜索服务不可用', en: 'Vector search service unavailable' },
  'C4A-SYS-005': { zh: '远程服务不可用', en: 'Remote service unavailable' },
  'C4A-SYS-006': { zh: 'Gateway 超时', en: 'Gateway timeout' },
  'C4A-SYS-007': { zh: '上游服务错误', en: 'Bad gateway' },
  'C4A-SYS-008': { zh: 'Gateway 服务不可用', en: 'Gateway service unavailable' },
  'C4A-SYS-009': { zh: '传输层错误', en: 'Transport error' },
  // BIZ
  'C4A-BIZ-001': { zh: '非法状态流转', en: 'Invalid status transition' },
  'C4A-BIZ-002': { zh: 'feat 状态不允许此操作', en: 'Feat status does not allow this operation' },
  'C4A-BIZ-003': { zh: '一致性检查失败', en: 'Consistency check failed' },
  'C4A-BIZ-004': { zh: '合并冲突', en: 'Merge conflict' },
  'C4A-BIZ-005': { zh: '实体被引用，无法删除', en: 'Entity is referenced, cannot delete' },
  'C4A-BIZ-006': {
    zh: '跨项目 feat 需要所有项目负责人批准',
    en: 'Cross-project feat requires approval from all project owners',
  },
  // STORE
  'C4A-STORE-001': {
    zh: '检测到并发修改，请协调变更范围',
    en: 'Concurrent modification detected',
  },
  'C4A-STORE-002': { zh: '缺少关联的 ADR', en: 'Missing related ADR' },
  'C4A-STORE-003': { zh: '实体被其他实体引用，无法删除', en: 'Entity is referenced, cannot delete' },
  'C4A-STORE-004': { zh: '实体正在被 feat 修改，无法删除', en: 'Entity is being modified in feat' },
  // PERM
  'C4A-PERM-001': { zh: '无写权限', en: 'No write permission' },
  'C4A-PERM-002': { zh: '无批准权限', en: 'No approve permission' },
  'C4A-PERM-003': { zh: '无读权限', en: 'No read permission' },
  'C4A-PERM-004': { zh: '认证失败', en: 'Authentication failed' },
  'C4A-PERM-005': { zh: '跨项目操作权限不足', en: 'Insufficient cross-project permission' },
  // MIGRATE
  'C4A-MIGRATE-001': { zh: '缺少 source_project 字段', en: 'Missing source_project field' },
  'C4A-MIGRATE-002': { zh: '缺少 source_repo 字段', en: 'Missing source_repo field' },
  'C4A-MIGRATE-003': { zh: 'source_project 格式不正确', en: 'Invalid source_project format' },
  'C4A-MIGRATE-004': { zh: 'source_repo 格式建议改进', en: 'source_repo format should be owner/repo' },
  'C4A-MIGRATE-005': {
    zh: 'Domain/Enterprise 层级不应有 source_project',
    en: 'Domain/Enterprise scope should not have source_project',
  },
  'C4A-MIGRATE-006': {
    zh: 'Domain/Enterprise 层级不应有 source_repo',
    en: 'Domain/Enterprise scope should not have source_repo',
  },
  'C4A-MIGRATE-007': {
    zh: 'external 实体不应有 source_project',
    en: 'External entity should not have source_project',
  },
  'C4A-MIGRATE-008': { zh: 'external 实体缺少 external_url', en: 'External entity missing external_url' },
  'C4A-EXTRACT-001': { zh: 'Extract MCP 内部错误', en: 'Extract MCP internal error' },
  'C4A-QUERY-001': { zh: 'Query MCP 内部错误', en: 'Query MCP internal error' },
  'C4A-VISUAL-001': { zh: 'Visual MCP 内部错误', en: 'Visual MCP internal error' },
};

// ============================================================================
// 错误详情
// ============================================================================

/**
 * 可恢复操作
 */
export interface RecoverableAction {
  /** 操作标识 */
  action: string;
  /** 操作描述 */
  label: string;
  /** 重试时需要的参数 */
  params?: Record<string, unknown>;
}

/**
 * 错误详情
 */
export interface ErrorDetails {
  /** 出错字段 */
  field?: string;
  /** 期望值 */
  expected?: string;
  /** 实际值 */
  actual?: string;
  /** 修复建议 */
  suggestion?: string;
  /** 相关实体 */
  entity_id?: string;
  /** 相关项目 */
  project?: string;
  /** 可恢复操作 */
  recoverable_actions?: RecoverableAction[];
  /** 扩展数据 */
  [key: string]: unknown;
}

/**
 * 错误响应格式
 */
export interface ErrorResponse {
  /** 错误码 */
  code: ErrorCode;
  /** 错误消息 */
  message: string;
  /** 详细信息 */
  details?: ErrorDetails;
  /** 错误发生时间 */
  timestamp: string;
  /** 请求 ID */
  request_id?: string;
  /** 可恢复操作 */
  recoverable_actions?: RecoverableAction[];
}

// ============================================================================
// C4A 错误基类
// ============================================================================

/**
 * C4A 错误基类
 */
export class C4AError extends Error {
  readonly code: ErrorCode;
  readonly details?: ErrorDetails;
  readonly timestamp: string;
  readonly httpStatus: number;

  constructor(code: ErrorCode, details?: ErrorDetails, message?: string) {
    const lang = 'zh'; // 可以从配置或环境变量获取
    const defaultMessage = ERROR_MESSAGES[code]?.[lang] || ERROR_MESSAGES[code]?.en || code;
    super(message || defaultMessage);

    this.name = 'C4AError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    this.httpStatus = ERROR_CODE_TO_HTTP_STATUS[code] || 500;

    // 保持正确的原型链
    Object.setPrototypeOf(this, C4AError.prototype);
  }

  /**
   * 转换为错误响应格式
   */
  toResponse(requestId?: string): ErrorResponse {
    const recoverableActions = this.details?.recoverable_actions;
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      request_id: requestId,
      recoverable_actions: recoverableActions,
    };
  }

  /**
   * 获取错误类别
   */
  getCategory(): ErrorCategory {
    const parts = this.code.split('-');
    return parts[1] as ErrorCategory;
  }
}

// ============================================================================
// 具体错误类
// ============================================================================

/**
 * 输入错误
 */
export class InputError extends C4AError {
  constructor(
    code: (typeof INPUT_ERROR_CODES)[keyof typeof INPUT_ERROR_CODES],
    details?: ErrorDetails,
    message?: string,
  ) {
    super(code, details, message);
    this.name = 'InputError';
  }
}

/**
 * 数据错误
 */
export class DataError extends C4AError {
  constructor(
    code: (typeof DATA_ERROR_CODES)[keyof typeof DATA_ERROR_CODES],
    details?: ErrorDetails,
    message?: string,
  ) {
    super(code, details, message);
    this.name = 'DataError';
  }
}

/**
 * 系统错误
 */
export class SystemError extends C4AError {
  constructor(
    code: (typeof SYS_ERROR_CODES)[keyof typeof SYS_ERROR_CODES],
    details?: ErrorDetails,
    message?: string,
  ) {
    super(code, details, message);
    this.name = 'SystemError';
  }
}

/**
 * 业务错误
 */
export class BusinessError extends C4AError {
  constructor(
    code: (typeof BIZ_ERROR_CODES)[keyof typeof BIZ_ERROR_CODES],
    details?: ErrorDetails,
    message?: string,
  ) {
    super(code, details, message);
    this.name = 'BusinessError';
  }
}

/**
 * 存储错误
 */
export class StoreError extends C4AError {
  constructor(
    code: (typeof STORE_ERROR_CODES)[keyof typeof STORE_ERROR_CODES],
    details?: ErrorDetails,
    message?: string,
  ) {
    super(code, details, message);
    this.name = 'StoreError';
  }
}

/**
 * 权限错误
 */
export class PermissionError extends C4AError {
  constructor(
    code: (typeof PERM_ERROR_CODES)[keyof typeof PERM_ERROR_CODES],
    details?: ErrorDetails,
    message?: string,
  ) {
    super(code, details, message);
    this.name = 'PermissionError';
  }
}

/**
 * 迁移错误
 */
export class MigrateError extends C4AError {
  constructor(
    code: (typeof MIGRATE_ERROR_CODES)[keyof typeof MIGRATE_ERROR_CODES],
    details?: ErrorDetails,
    message?: string,
  ) {
    super(code, details, message);
    this.name = 'MigrateError';
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 从错误码获取错误消息
 */
export function getErrorMessage(code: ErrorCode, lang: 'zh' | 'en' = 'zh'): string {
  return ERROR_MESSAGES[code]?.[lang] || ERROR_MESSAGES[code]?.en || code;
}

/**
 * 从错误码获取 HTTP 状态码
 */
export function getHttpStatus(code: ErrorCode): number {
  return ERROR_CODE_TO_HTTP_STATUS[code] || 500;
}

/**
 * 从错误码获取类别
 */
export function getErrorCategory(code: ErrorCode): ErrorCategory {
  const parts = code.split('-');
  return parts[1] as ErrorCategory;
}

/**
 * 判断是否为 C4A 错误
 */
export function isC4AError(error: unknown): error is C4AError {
  return error instanceof C4AError;
}

/**
 * 判断错误是否可恢复
 */
export function isRecoverableError(error: C4AError): boolean {
  const category = error.getCategory();
  // INPUT 和部分 BIZ 错误通常可以通过修改参数恢复
  return category === 'INPUT' || category === 'BIZ';
}

// ============================================================================
// MCP 错误响应序列化
// ============================================================================

/**
 * MCP 错误响应格式
 *
 * MCP 层与 HTTP API 共用错误结构。
 */
export type McpErrorResponse = ErrorResponse;

/**
 * 将 C4AError 转换为 MCP 错误响应
 */
export function toMcpErrorResponse(error: C4AError): McpErrorResponse {
  const response = error.toResponse();
  if (error.details?.recoverable_actions) {
    response.recoverable_actions = error.details.recoverable_actions;
  }
  return response;
}

/**
 * 从未知错误创建 MCP 错误响应
 */
export function errorToMcpResponse(error: unknown): McpErrorResponse {
  if (isC4AError(error)) {
    return toMcpErrorResponse(error);
  }

  // 未知错误转换为系统错误
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: SYS_ERROR_CODES.INTERNAL_ERROR,
    message: `内部错误: ${message}`,
    timestamp: new Date().toISOString(),
  };
}
