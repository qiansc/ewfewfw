/**
 * C4A Feat 类型定义
 *
 * feat（Feature 分支）用于管理需求迭代中的实体变更
 * 支持 Copy-on-Write 机制
 */

import type { LifecycleStatus, Owner } from './base.js';

// ============================================================================
// Feat 状态
// ============================================================================

/**
 * Feat 生命周期状态
 *
 * 状态流转（与通用实体生命周期一致）：
 * draft ──批准──► approved ──发布──► published ──废弃──► deprecated ──归档──► archived
 *
 * 参考：v0.3.0/architecture.md §7.1
 */
export type FeatStatus =
  | 'draft' // 草稿：刚创建，尚未开始
  | 'approved' // 已批准：审核通过，等待发布
  | 'published' // 已发布：合并到主分支
  | 'deprecated' // 已废弃：不推荐使用
  | 'archived'; // 已归档：终态

/**
 * Feat 状态流转有效性映射
 *
 * 根据 v0.3.0/architecture.md 定义的生命周期：
 * draft ──批准──► approved ──发布──► published ──废弃──► deprecated ──归档──► archived
 *   │                                    │
 *   └──────────────拒绝──────────────────►│
 *                                        ▼
 *                                    archived
 *
 * 规则：
 * - 状态流转必须按顺序进行，不可跳过
 * - draft 可直接到 archived（拒绝场景）
 * - approved 必须先发布，不能直接归档
 * - published 可直接到 archived（快速归档场景），或先废弃再归档
 */
export const VALID_FEAT_STATUS_TRANSITIONS: Record<FeatStatus, FeatStatus[]> = {
  draft: ['approved', 'archived'], // archived 用于拒绝场景
  approved: ['published'], // 必须先发布
  published: ['deprecated', 'archived'], // 可直接归档或先废弃
  deprecated: ['archived'],
  archived: [], // 终态
};

/**
 * 检查 Feat 状态流转是否有效
 */
export function isValidFeatStatusTransition(from: FeatStatus, to: FeatStatus): boolean {
  return VALID_FEAT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================================================
// Feat 变更记录
// ============================================================================

/**
 * 变更操作类型
 */
export type ChangeOperation = 'create' | 'update' | 'delete';

/**
 * Feat 变更记录
 * 记录 feat 中对实体的变更
 */
export interface FeatChange {
  /** 实体 ID */
  entity_id: string;

  /** 实体类型 */
  entity_type: string;

  /** 变更操作 */
  operation: ChangeOperation;

  /** 变更前的内容哈希（update/delete 时有值） */
  before_hash?: string;

  /** 变更后的内容哈希（create/update 时有值） */
  after_hash?: string;

  /** 变更时间 */
  changed_at: string;

  /** 变更者 */
  changed_by?: string;

  /** 变更说明 */
  change_note?: string;
}

// ============================================================================
// Feat Workflow 步骤
// ============================================================================

/**
 * Workflow 步骤状态
 */
export type WorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Workflow 步骤
 * 用于断点续传和恢复
 */
export interface WorkflowStep {
  /** 步骤 ID */
  step_id: string;

  /** 步骤名称 */
  name: string;

  /** 步骤状态 */
  status: WorkflowStepStatus;

  /** 开始时间 */
  started_at?: string;

  /** 完成时间 */
  completed_at?: string;

  /** 错误信息（失败时） */
  error?: string;

  /** 步骤数据（用于恢复） */
  data?: Record<string, unknown>;
}

// ============================================================================
// Feat 实体
// ============================================================================

/**
 * Feat（需求迭代）
 *
 * 命名规范：feat-{序号}-{简短描述}，如 feat-a001-user-login
 */
export interface Feat {
  /** Feat ID，如 feat-a001-user-login */
  id: string;

  /** 类型标识 */
  type: 'feat';

  /** 显示名称 */
  name: string;

  /** 描述 */
  description?: string;

  /** 状态 */
  status: FeatStatus;

  /** 所属项目 */
  source_project: string;

  /** 所属仓库 */
  source_repo?: string;

  /** 创建时间 */
  created_at: string;

  /** 更新时间 */
  updated_at?: string;

  /** 创建者 */
  created_by?: string;

  /** 负责人 */
  owner?: Owner;

  /** 变更记录列表 */
  changes?: FeatChange[];

  /** Workflow 步骤（用于断点续传） */
  workflow_steps?: WorkflowStep[];

  /** 当前 Workflow 步骤索引 */
  current_step_index?: number;

  /** 关联的 ADR ID 列表 */
  related_adrs?: string[];

  /** 关联的 Checklist ID */
  checklist_id?: string;

  /** 扩展元数据 */
  metadata?: {
    /** 审核人列表 */
    reviewers?: string[];
    /** 批准人 */
    approved_by?: string;
    /** 批准时间 */
    approved_at?: string;
    /** 发布时间 */
    published_at?: string;
    /** 拒绝原因 */
    rejection_reason?: string;
    /** 关联的外部系统 ID（如 Jira ticket） */
    external_id?: string;
    /** 扩展字段 */
    [key: string]: unknown;
  };
}

// ============================================================================
// Feat 操作参数
// ============================================================================

/**
 * 创建 Feat 参数
 */
export interface CreateFeatParams {
  /** Feat ID */
  feat_id: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 所属项目 */
  source_project: string;
  /** 所属仓库 */
  source_repo?: string;
  /** 创建者 */
  created_by?: string;
  /** 负责人 */
  owner?: Owner;
}

/**
 * Feat 状态流转的目标状态
 *
 * 注意：不包含 'draft'，因为 feat 创建时自动为 draft 状态，
 * 不需要通过 transition 操作流转到 draft。
 *
 * 参考：v0.3.0/detailed-design/mcp/store-feat-lifecycle.md
 */
export type FeatTransitionTarget = 'approved' | 'published' | 'deprecated' | 'archived';

/**
 * Feat 状态流转参数
 */
export interface TransitionFeatStatusParams {
  /** Feat ID */
  feat_id: string;

  /**
   * 目标状态
   *
   * 可选值：approved | published | deprecated | archived
   * 不包含 draft（feat 创建时自动为 draft）
   */
  to_status: FeatTransitionTarget;

  /** 操作者 */
  operator?: string;

  /** 备注（如归档原因） */
  note?: string;

  /** 审核人列表（流转到 approved 时可选） */
  reviewers?: string[];
}

/**
 * Feat 合并参数
 */
export interface MergeFeatParams {
  /** Feat ID */
  feat_id: string;
  /** 冲突处理策略 */
  conflict_policy?: 'skip' | 'warn' | 'override' | 'prompt';
  /** 操作者 */
  operator?: string;
  /** 是否跳过 ADR 检查 */
  skip_adr_check?: boolean;
}

/**
 * Feat 合并结果
 */
export interface MergeFeatResult {
  /** 是否成功 */
  success: boolean;
  /** 合并的实体数量 */
  merged_count: number;
  /** 冲突列表 */
  conflicts?: Array<{
    entity_id: string;
    entity_type: string;
    conflict_type: 'content_conflict' | 'deleted_in_main' | 'modified_in_main';
    resolution?: string;
  }>;
  /** 警告列表 */
  warnings?: string[];
  /** 错误信息 */
  error?: string;
}

// ============================================================================
// Feat 历史（用于回滚）
// ============================================================================

/**
 * Feat 发布历史记录
 */
export interface FeatPublishHistory {
  /** 记录 ID */
  id: string;

  /** Feat ID */
  feat_id: string;

  /** 发布时间 */
  published_at: string;

  /** 发布者 */
  published_by?: string;

  /** 发布前的实体快照（用于回滚） */
  snapshot: Array<{
    entity_id: string;
    entity_type: string;
    before_hash?: string;
    after_hash: string;
    operation: ChangeOperation;
  }>;

  /** 是否已回滚 */
  rolled_back?: boolean;

  /** 回滚时间 */
  rolled_back_at?: string;

  /** 回滚者 */
  rolled_back_by?: string;
}

// ============================================================================
// 类型守卫
// ============================================================================

export function isFeat(entity: unknown): entity is Feat {
  return (entity as Feat)?.type === 'feat';
}

export function isFeatStatus(status: string): status is FeatStatus {
  return [
    'draft',
    'approved',
    'published',
    'deprecated',
    'archived',
  ].includes(status);
}
