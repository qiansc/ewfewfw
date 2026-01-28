/**
 * 模式切换共享类型
 */

import type { EntityType, EntityStatus } from './adapter.js';

/**
 * 冲突处理策略
 */
export type ConflictPolicy = 'skip' | 'override' | 'merge' | 'error';

/**
 * 备份选项
 */
export interface BackupOptions {
  /** 输出文件路径 */
  output: string;
  /** 是否包含向量数据 */
  includeVectors?: boolean;
  /** 是否压缩 */
  compress?: boolean;
  /** 备份进度回调 */
  onProgress?: (progress: BackupProgress) => void;
}

/**
 * 恢复选项
 */
export interface RestoreOptions {
  /** 备份文件路径 */
  input: string;
  /** 冲突处理策略 */
  conflictPolicy?: ConflictPolicy;
  /** 是否重建向量索引 */
  rebuildVectors?: boolean;
  /** 恢复进度回调 */
  onProgress?: (progress: RestoreProgress) => void;
}

/**
 * 备份结果
 */
export interface BackupResult {
  success: boolean;
  output: string;
  stats: {
    entities: number;
    relations: number;
    feats: number;
    vectors: number;
  };
  size: number;
}

export interface BackupProgress {
  phase: 'entities' | 'relations' | 'feats' | 'write' | 'done';
  current: number;
  total: number;
  message?: string;
}

/**
 * 恢复结果
 */
export interface RestoreResult {
  success: boolean;
  stats: {
    entities: { created: number; updated: number; skipped: number };
    relations: number;
    feats: { created: number; updated: number; skipped: number };
    vectors: number;
  };
  conflicts?: Array<{
    id: string;
    reason: string;
    resolution: string;
    target_type?: string;
    target_status?: string;
  }>;
  conflict_summary?: ConflictSummary;
}

export interface RestoreProgress {
  phase: 'feats' | 'entities' | 'relations' | 'vectors' | 'done';
  current: number;
  total: number;
  message?: string;
}

export interface ConflictSummary {
  total: number;
  by_target: Record<string, number>;
  by_entity_type: Record<string, number>;
  by_status: Record<string, number>;
  by_feat_status: Record<string, number>;
  by_reason: Record<string, number>;
  by_resolution: Record<string, number>;
  by_target_resolution: Record<string, Record<string, number>>;
  by_target_status: Record<string, Record<string, number>>;
}

/**
 * 导出数据格式
 *
 * 设计文档: mode-switch.md §5.4
 */
export interface ExportData {
  version: string;
  exported_at: string;
  entities: ExportEntity[];
  relations: ExportRelation[];
  feats: ExportFeat[];
}

/**
 * 导出实体格式
 */
export interface ExportEntity {
  id: string;
  type: EntityType;
  kind?: string;
  scope?: string;
  perspective?: string;
  data: Record<string, unknown>;
  metadata: {
    source_project: string;
    source_repo?: string;
    status: EntityStatus;
    content_hash?: string;
    created_at: string;
    updated_at: string;
  };
  proposal_id: string | null;
}

/**
 * 导出关系格式
 */
export interface ExportRelation {
  id?: string;
  proposal_id?: string | null;
  from_project?: string | null;
  from_id: string;
  to_project?: string | null;
  to_id: string;
  rel_type: string;
  status?: 'active' | 'deleted';
  properties?: Record<string, unknown> | null;
}

/**
 * 导出 Feat 格式
 */
export interface ExportFeat {
  id: string;
  status: string;
  title?: string;
  description?: string;
  created_by?: string;
  checklist?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const EXPORT_VERSION = '0.3.0';
