/**
 * Storage Adapter Layer - 工具类型定义
 */

// ============================================================
// 历史记录类型
// ============================================================

/**
 * 历史记录项
 */
export interface HistoryItem {
  entity_id?: string;
  feat_id: string | null;
  action: 'create' | 'update' | 'delete' | 'archive';
  changed_fields?: string[];
  changed_by?: string;
  changed_at: string;
}

/**
 * 读取历史参数
 * 设计文档: store-utils.md §3.11
 */
export interface ReadHistoryParams {
  entity_id?: string;
  feat_id?: string;
  limit?: number;
  order?: 'asc' | 'desc';
}

/**
 * 读取历史结果
 */
export interface ReadHistoryResult {
  success: boolean;
  items: HistoryItem[];
  total?: number;
}

// ============================================================
// 备份恢复类型
// ============================================================

/**
 * 备份统计
 */
export interface BackupStats {
  entities: number;
  relations: number;
  vectors: number;
}

/**
 * 备份参数
 * 设计文档: store-utils.md §3.13
 */
export interface BackupParams {
  output: string;
  status_filter?: 'published' | 'approved' | 'all';
  format?: 'tar.gz' | 'json';
  include_metadata?: boolean;
}

/**
 * 备份结果
 */
export interface BackupResult {
  success: boolean;
  file?: string;
  size?: number;
  format_version?: string;
  stats?: BackupStats;
  error?: string;
}

/**
 * 恢复冲突
 */
export interface RestoreConflict {
  entity_id: string;
  reason: string;
  resolution: string;
}

/**
 * 恢复参数
 * 设计文档: store-utils.md §3.14
 */
export interface RestoreParams {
  input: string;
  conflict_policy?: 'skip' | 'override' | 'merge' | 'error';
  validate_checksums?: boolean;
}

/**
 * 恢复结果
 */
export interface RestoreResult {
  success: boolean;
  format_version?: string;
  compatible?: boolean;
  stats?: BackupStats;
  conflicts?: RestoreConflict[];
  error?: string;
}

// ============================================================
// 修复类型
// ============================================================

/**
 * 不一致问题
 */
export interface Inconsistency {
  entity_id: string;
  issue: string;
  fixed: boolean;
}

/**
 * 修复参数
 * 设计文档: store-utils.md §3.15
 */
export interface RepairParams {
  scope?: 'all' | 'neo4j' | 'milvus';
  dry_run?: boolean;
  entity_ids?: string[];
}

/**
 * 修复结果
 */
export interface RepairResult {
  success: boolean;
  scanned: number;
  inconsistencies: Inconsistency[];
  stats?: {
    neo4j_fixed: number;
    milvus_fixed: number;
    failed: number;
  };
  message?: string;
}

// ============================================================
// 一致性检查类型
// ============================================================

/**
 * 一致性检查详情
 */
export interface ConsistencyDetail {
  id: string;
  neo4j: string;
  milvus: string;
}

/**
 * 一致性检查结果
 */
export interface ConsistencyResult {
  total: number;
  synced: number;
  pending: number;
  failed: number;
  no_status: number;
  details: ConsistencyDetail[];
}

// ============================================================
// 验证类型
// ============================================================

/**
 * 验证检查类型
 */
export type ValidateCheckType =
  | 'functional_spec'
  | 'technical_spec'
  | 'contracts'
  | 'references'
  | 'adr_completeness'
  | 'checklist';

/**
 * 验证错误
 */
export interface ValidateError {
  code: string;
  entity_id?: string;
  message: string;
  suggestion?: string;
}

/**
 * 单项检查结果
 */
export interface ValidateCheckResult {
  status: 'passed' | 'warning' | 'error';
  message: string;
  errors?: ValidateError[];
  warnings?: ValidateError[];
  dangling_count?: number;
  changes_detected?: Array<{
    type: string;
    entity_id: string;
    detail: string;
  }>;
  progress?: {
    completed: number;
    total: number;
    percentage: number;
  };
  blocked?: string[];
  suggestion?: string;
}

/**
 * 验证参数
 * 设计文档: store-utils.md §3.16
 */
export interface ValidateParams {
  requirement_id?: string;
  checks?: ValidateCheckType[];
  options?: {
    check_depth?: number;
    include_suggestions?: boolean;
  };
}

/**
 * 验证结果
 */
export interface ValidateResult {
  success: boolean;
  requirement_id?: string;
  summary?: {
    passed: number;
    warnings: number;
    errors: number;
    status: 'passed' | 'warnings' | 'failed';
  };
  checks?: Record<string, ValidateCheckResult>;
  suggestions?: string[];
  error?: string;
}
