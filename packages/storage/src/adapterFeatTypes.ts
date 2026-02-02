/**
 * Storage Adapter Layer - Feat 类型定义
 */

import type { FeatStatus } from '@c4a/core/types';

// ============================================================
// Feat 生命周期类型
// ============================================================

/**
 * Feat 状态 - 从 types 模块导入
 * 定义见 v0.3.0/concepts.md
 */
export type { FeatStatus };

/**
 * Feat 生命周期操作
 */
export type FeatAction = 'create' | 'transition' | 'delete';

/**
 * Feat 生命周期参数
 */
export interface FeatLifecycleParams {
  action: FeatAction;
  feat_id: string;
  metadata?: {
    title: string;
    description: string;
    created_by: string;
  };
  to_status?: FeatStatus;
  sync_checklist?: boolean;
  force_publish?: boolean;
  expected_content_hash?: string;
}

/**
 * Feat 生命周期结果
 */
export interface FeatLifecycleResult {
  success: boolean;
  feat_id: string;
  status?: FeatStatus;
  from_status?: FeatStatus;
  to_status?: FeatStatus;
  deleted?: boolean;
  error?: string;
  message?: string;
  conflicts?: FeatConflict[];
  merge_result?: {
    merged: string[];
    conflicts: FeatConflict[];
  };
  // content_hash 验证失败时返回
  expected_hash?: string;
  actual_hash?: string;
}

/**
 * Feat 合并参数
 */
export interface FeatMergeParams {
  feat_id: string;
  strategy: 'auto' | 'manual';
  conflict_resolution?: Array<{
    entity_id: string;
    resolution: 'keep_main' | 'keep_feat';
  }>;
}

/**
 * Feat 冲突
 */
export interface FeatConflict {
  entity_id: string;
  conflict_type: 'content' | 'deleted' | 'both_modified' | 'type';
  main_branch?: Record<string, unknown>;
  feat_branch?: Record<string, unknown>;
  suggested_resolution?: 'keep_main' | 'keep_feat';
}

/**
 * Feat 合并结果
 */
export interface FeatMergeResult {
  success: boolean;
  merged: string[];
  conflicts: FeatConflict[];
}

// ============================================================
// Checklist 类型
// ============================================================

/**
 * Checklist 操作类型
 */
export type ChecklistAction = 'generate' | 'get' | 'patch' | 'clear';

/**
 * Checklist 任务状态
 */
export type ChecklistTaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped';

/**
 * Checklist 任务类型
 */
export type ChecklistTaskType = 'dsl' | 'code' | 'test' | 'doc' | 'contract';

/**
 * Checklist 任务项
 */
export interface ChecklistItem {
  id: string;
  title: string;
  status: ChecklistTaskStatus;
  type?: ChecklistTaskType;
  entity_id?: string;
  assignee?: string;
  completed_at?: string;
  blocked_reason?: string;
}

/**
 * Checklist 数据
 */
export interface Checklist {
  version: string;
  metadata?: {
    feat_id: string;
    generated_at?: string;
    source?: string;
  };
  updated_at?: string;
  updated_by?: string;
  items: ChecklistItem[];
}

/**
 * Checklist 补丁
 */
export interface ChecklistPatch {
  task_id: string;
  updates: Partial<Omit<ChecklistItem, 'id'>> & { title?: string };
}

/**
 * Checklist 参数
 */
export interface ChecklistParams {
  action: ChecklistAction;
  feat_id: string;
  source?: 'technical_spec';
  items?: Array<{
    id: string;
    title?: string;
    status?: string;
    type?: string;
    entity_id?: string;
    assignee?: string;
  }>;
  patches?: ChecklistPatch[];
  validate?: boolean;
}

/**
 * Checklist 结果
 */
export interface ChecklistResult {
  success: boolean;
  feat_id: string;
  checklist?: Checklist;
  cleared?: boolean;
  patched_at?: string;
  patched_tasks?: Array<{ task_id: string; fields_updated: string[] }>;
  updated_checklist?: Checklist;
  error?: string;
  message?: string;
  missing_tasks?: string[];
  validation_errors?: Array<{ code: string; message: string; task_id?: string }>;
}

// ============================================================
// Workflow Step 类型
// ============================================================

/**
 * Workflow 步骤状态
 */
export type WorkflowStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

/**
 * Workflow 步骤元数据
 */
export interface WorkflowStepMetadata {
  started_at?: string;
  completed_at?: string;
  failed_at?: string;
  error?: string;
  recovered?: boolean;
  [key: string]: unknown;
}

/**
 * 更新 Workflow 步骤参数
 * 设计文档: store-feat-checklist.md §3.9
 */
export interface UpdateWorkflowStepParams {
  feat_id: string;
  step_id: string;
  status?: WorkflowStepStatus;
  metadata?: WorkflowStepMetadata;
}

/**
 * 更新 Workflow 步骤结果
 */
export interface UpdateWorkflowStepResult {
  success: boolean;
  feat_id: string;
  step_id: string;
  status?: WorkflowStepStatus;
  updated_at?: string;
  updated_fields?: string[];
  error?: 'feat_not_found' | 'step_not_found' | 'concurrent_update';
  message?: string;
}
