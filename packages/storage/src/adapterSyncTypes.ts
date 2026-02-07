/**
 * Storage Adapter Layer - 同步类型定义
 */

import type { EntityType } from './adapterBaseTypes.js';

// ============================================================
// 同步操作类型
// ============================================================

/**
 * 同步方向
 */
export type SyncDirection = 'import' | 'export';

/**
 * 同步模式
 */
export type SyncMode = 'incremental' | 'full';

/**
 * 冲突策略
 */
export type ConflictPolicy = 'warn' | 'skip' | 'override' | 'prompt';

/**
 * 同步参数 (Local 模式)
 * 设计文档: store-sync.md §3.5
 */
export interface SyncParams {
  direction: SyncDirection;
  path?: string;
  mode?: SyncMode;
  status_filter?: 'published' | 'approved' | 'all';
  format?: 'yaml' | 'json';
  conflict_policy?: ConflictPolicy;
}

/**
 * 同步结果
 */
export interface SyncResult {
  success: boolean;
  stats: {
    scanned: number;
    created: number;
    updated: number;
    skipped: number;
    conflicted: number;
    failed: number;
  };
  details?: SyncDetail[];
  conflicts?: SyncConflict[];
}

/**
 * 同步状态 (Server 模式)
 */
export interface SyncStatus {
  pending_count: number;
  failed_count: number;
  processing_count: number;
  last_sync_at: string | null;
  lag_seconds: number;
}

/**
 * 同步详情
 */
export interface SyncDetail {
  path?: string;
  entity_id: string;
  type?: EntityType;
  action: 'created' | 'updated' | 'skipped' | 'failed' | 'exported' | 'conflict';
  error?: string;
}

/**
 * 同步冲突
 */
export interface SyncConflict {
  entity_id: string;
  local_hash: string;
  remote_hash: string;
  local_updated_at: string;
  remote_updated_at: string;
}

/**
 * 同步计划参数 (Server/Remote 模式)
 * 设计文档: store-sync.md §3.5.1
 */
export interface PlanSyncParams {
  local_manifest: LocalManifest;
  snapshot?: SyncSnapshot | null;
  options?: {
    root_id?: string;
    requirement_id?: string;
    status_filter?: 'published' | 'approved' | 'all';
    conflict_policy?: ConflictPolicy;
  };
  execute?: boolean;
}

/**
 * 本地文件清单
 */
export interface LocalManifest {
  files: LocalFileInfo[];
}

/**
 * 本地文件信息
 */
export interface LocalFileInfo {
  path: string;
  entity_id: string;
  type: EntityType;
  content_hash: string;
  updated_at: string;
  root_id?: string;
  requirement_id?: string;
  content?: string;
}

/**
 * 同步快照
 */
export interface SyncSnapshot {
  synced_at: string;
  entities: Record<
    string,
    {
      content_hash: string;
      root_id?: string;
      requirement_id?: string;
    }
  >;
}

/**
 * 同步计划结果
 */
export interface PlanSyncResult {
  plan: SyncPlan;
  executed?: boolean;
  result?: SyncResult;
  new_snapshot?: SyncSnapshot;
}

/**
 * 同步计划
 */
export interface SyncPlan {
  to_upload: SyncAction[];
  to_download: SyncAction[];
  to_delete_local: SyncAction[];
  to_delete_remote: SyncAction[];
  conflicts: PlanConflict[];
  unchanged: string[];
}

/**
 * 同步操作
 * 设计文档: store-sync.md §3.5.1
 */
export interface SyncAction {
  op: 'upload' | 'download' | 'delete_local' | 'delete_remote' | 'conflict' | 'skip';
  entity_id: string;
  type?: EntityType;
  path?: string;
  content?: string;
  content_hash?: string;
  expected_hash?: string;
  reason?: string;
}

/**
 * 计划项（兼容旧接口）
 */
export interface PlanItem {
  entity_id: string;
  type: EntityType;
  action: 'create' | 'update';
  content_hash: string;
}

/**
 * 计划冲突
 */
export interface PlanConflict {
  entity_id: string;
  conflict_type: 'both_modified' | 'local_deleted' | 'remote_deleted';
  local_hash?: string;
  remote_hash?: string;
  remote_content?: string;
  reason?: string;
  resolution?: 'keep_local' | 'keep_remote';
}
