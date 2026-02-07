/**
 * C4A Checklist 类型定义
 *
 * Checklist 用于跟踪 feat 实施过程中的任务
 * 存储在数据库中，本地只有只读视图
 */

import type { Entity } from './entities.js';

// ============================================================================
// Checklist Item 状态
// ============================================================================

/**
 * Checklist 项目状态
 */
export type ChecklistItemStatus =
  | 'pending' // 待处理
  | 'in_progress' // 进行中
  | 'completed' // 已完成
  | 'skipped' // 已跳过
  | 'blocked'; // 被阻塞

// ============================================================================
// Checklist Item
// ============================================================================

/**
 * Checklist 项目类型
 */
export type ChecklistItemType =
  | 'dsl' // DSL 定义
  | 'code' // 代码实现
  | 'test' // 测试
  | 'doc' // 文档
  | 'contract'; // 契约

/**
 * Checklist 项目
 */
export interface ChecklistItem {
  /** 任务 ID */
  id: string;

  /** 任务标题 */
  title: string;

  /** 状态 */
  status: ChecklistItemStatus;

  /** 任务类型 */
  type?: ChecklistItemType;

  /** 关联实体 ID */
  entity_id?: string;

  /** 负责人 */
  assignee?: string;

  /** 完成时间 */
  completed_at?: string;

  /** 阻塞原因 */
  blocked_reason?: string;
}

// ============================================================================
// Checklist
// ============================================================================

/**
 * Checklist
 *
 * 对应数据库中的 checklist 字段（详见 store-feat-checklist.md）。
 */
export interface Checklist extends Entity {
  /** 类型标识 */
  type: 'checklist';

  /** 生成元信息 */
  metadata?: {
    feat_id: string;
    generated_at?: string;
    source?: string;
  };

  /** 更新时间 */
  updated_at?: string;

  /** 更新人 */
  updated_by?: string;

  /** 任务列表 */
  items: ChecklistItem[];
}

// ============================================================================
// Checklist 操作参数
// ============================================================================

/**
 * 创建 Checklist 参数
 */
export interface CreateChecklistParams {
  /** 关联的 Feat ID */
  feat_id: string;
  /** 来源 */
  source?: string;
  /** 初始项目列表 */
  items?: Array<
    Omit<ChecklistItem, 'id' | 'status'> & { id?: string; status?: ChecklistItemStatus }
  >;
  /** 创建者 */
  created_by?: string;
}

/**
 * 更新 Checklist Item 状态参数
 */
export interface UpdateChecklistItemParams {
  /** Checklist ID */
  checklist_id: string;
  /** Item ID */
  item_id: string;
  /** 更新字段 */
  updates: Partial<Omit<ChecklistItem, 'id'>>;
  /** 操作者 */
  operator?: string;
}

/**
 * 添加 Checklist Item 参数
 */
export interface AddChecklistItemParams {
  /** Checklist ID */
  checklist_id: string;
  /** 任务标题 */
  title: string;
  /** 任务类型 */
  type?: ChecklistItemType;
  /** 状态 */
  status?: ChecklistItemStatus;
  /** 关联实体 ID */
  entity_id?: string;
  /** 负责人 */
  assignee?: string;
  /** 完成时间 */
  completed_at?: string;
  /** 阻塞原因 */
  blocked_reason?: string;
}

// ============================================================================
// Checklist 渲染
// ============================================================================

/**
 * Checklist 渲染格式
 */
export type ChecklistRenderFormat = 'markdown' | 'yaml' | 'json' | 'html';

/**
 * Checklist 渲染选项
 */
export interface ChecklistRenderOptions {
  /** 输出格式 */
  format: ChecklistRenderFormat;
  /** 是否包含完成的项目 */
  include_completed?: boolean;
  /** 是否包含跳过的项目 */
  include_skipped?: boolean;
  /** 是否分组显示 */
  group_by?: 'status' | 'type' | 'assignee' | 'group';
  /** 是否显示进度 */
  show_progress?: boolean;
}

/**
 * Checklist 渲染结果
 */
export interface ChecklistRenderResult {
  /** 渲染的内容 */
  content: string;
  /** 格式 */
  format: ChecklistRenderFormat;
  /** 进度摘要 */
  summary?: string;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * Checklist 进度统计
 */
export interface ChecklistProgress {
  total: number;
  completed: number;
  in_progress: number;
  pending: number;
  skipped: number;
  blocked: number;
}

/**
 * 计算 Checklist 进度
 */
export function calculateChecklistProgress(checklist: Checklist): ChecklistProgress {
  const items = checklist.items;
  const total = items.length;

  return {
    total,
    completed: items.filter((i) => i.status === 'completed').length,
    in_progress: items.filter((i) => i.status === 'in_progress').length,
    pending: items.filter((i) => i.status === 'pending').length,
    skipped: items.filter((i) => i.status === 'skipped').length,
    blocked: items.filter((i) => i.status === 'blocked').length,
  };
}

/**
 * 检查 Checklist 是否完成
 */
export function isChecklistCompleted(checklist: Checklist): boolean {
  return checklist.items.every((i) => i.status === 'completed' || i.status === 'skipped');
}

/**
 * 获取阻塞的项目
 */
export function getBlockedItems(checklist: Checklist): ChecklistItem[] {
  return checklist.items.filter((item) => item.status === 'blocked');
}
