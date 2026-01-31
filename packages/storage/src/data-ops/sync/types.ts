/**
 * Sync 模块类型定义（Data Ops）
 */

import type { EntityType } from '../../adapter.js';
import type { Perspective } from '@c4a/core';

// ============================================================
// Sync 核心类型
// ============================================================

export type SyncDirection = 'db-to-file' | 'file-to-db' | 'bidirectional';
export type SyncMode = 'incremental' | 'full';
export type ExportFormat = 'yaml' | 'json';

export interface SyncOptions {
  direction?: SyncDirection;
  path?: string;
  mode?: SyncMode;
  format?: ExportFormat;
  status_filter?: 'published' | 'approved' | 'all';
  feat_id?: string | null;
}

export interface SyncStats {
  scanned: number;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  conflicted: number;
  failed: number;
}

export interface SyncDetail {
  entity_id: string;
  action: 'created' | 'updated' | 'deleted' | 'skipped' | 'conflict' | 'failed';
  path?: string;
  error?: string;
}

export type ConflictType = 'content' | 'deleted' | 'type';

export interface ConflictInfo {
  entity_id: string;
  conflict_type: ConflictType;
  db_hash?: string;
  file_hash?: string;
  db_updated_at?: string;
  file_mtime?: string;
  db_type?: EntityType;
  file_type?: EntityType;
  file_path?: string;
  missing_side?: 'db' | 'file';
  reason?: string;
}

export interface SyncResult {
  success: boolean;
  direction: SyncDirection;
  stats: SyncStats;
  conflicts: ConflictInfo[];
  warnings?: string[];
  details?: SyncDetail[];
}

// ============================================================
// Export 引擎类型
// ============================================================

export interface ExportOptions {
  path?: string;
  format?: ExportFormat;
  mode?: SyncMode;
  status_filter?: 'published' | 'approved' | 'all';
  feat_id?: string | null;
}

export interface ExportResult {
  success: boolean;
  exported: number;
  skipped: number;
  deleted: number;
  conflicts: ConflictInfo[];
  path: string;
  format: ExportFormat;
}

// ============================================================
// Sync 参与实体类型（用于冲突检测/导出）
// ============================================================

export interface DbEntityInfo {
  id: string;
  type: EntityType;
  data?: Record<string, unknown>;
  status?: string;
  content_hash: string;
  updated_at?: string;
}

export interface FileEntityInfo {
  id: string;
  type: EntityType;
  content_hash: string;
  path: string;
  mtime?: string;
  feat_id?: string | null;
  perspective?: Perspective | null;
  path_type?: EntityType | null;
  declared_type?: EntityType | null;
}
