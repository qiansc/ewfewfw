/**
 * C4A Checklist 类型定义
 *
 * Checklist 用于跟踪 feat 实施过程中的任务
 * 存储在数据库中，本地只有只读视图
 */

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
  | 'task' // 普通任务
  | 'milestone' // 里程碑
  | 'review' // 审核点
  | 'validation'; // 验证点

/**
 * Checklist 项目
 */
export interface ChecklistItem {
  /** 项目 ID */
  id: string;

  /** 项目内容 */
  content: string;

  /** 项目类型 */
  type: ChecklistItemType;

  /** 状态 */
  status: ChecklistItemStatus;

  /** 负责人 */
  assignee?: string;

  /** 预计完成时间 */
  due_date?: string;

  /** 实际完成时间 */
  completed_at?: string;

  /** 完成者 */
  completed_by?: string;

  /** 关联的实体 ID */
  related_entity_id?: string;

  /** 关联的实体类型 */
  related_entity_type?: string;

  /** 前置任务 ID 列表 */
  depends_on?: string[];

  /** 备注 */
  notes?: string;

  /** 顺序（用于排序） */
  order?: number;

  /** 扩展数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Checklist
// ============================================================================

/**
 * Checklist 分组
 */
export interface ChecklistGroup {
  /** 分组 ID */
  id: string;

  /** 分组名称 */
  name: string;

  /** 分组描述 */
  description?: string;

  /** 分组内的项目 ID 列表 */
  item_ids: string[];

  /** 顺序 */
  order?: number;
}

/**
 * Checklist
 */
export interface Checklist {
  /** Checklist ID */
  id: string;

  /** 关联的 Feat ID */
  feat_id: string;

  /** 标题 */
  title: string;

  /** 描述 */
  description?: string;

  /** 所有项目 */
  items: ChecklistItem[];

  /** 分组（可选） */
  groups?: ChecklistGroup[];

  /** 创建时间 */
  created_at: string;

  /** 更新时间 */
  updated_at?: string;

  /** 创建者 */
  created_by?: string;

  /** 进度统计 */
  progress?: {
    total: number;
    completed: number;
    in_progress: number;
    pending: number;
    skipped: number;
    blocked: number;
  };

  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
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
  /** 标题 */
  title: string;
  /** 描述 */
  description?: string;
  /** 初始项目列表 */
  items?: Array<Omit<ChecklistItem, 'id' | 'status'> & { status?: ChecklistItemStatus }>;
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
  /** 目标状态 */
  status: ChecklistItemStatus;
  /** 操作者 */
  operator?: string;
  /** 备注 */
  notes?: string;
}

/**
 * 添加 Checklist Item 参数
 */
export interface AddChecklistItemParams {
  /** Checklist ID */
  checklist_id: string;
  /** 项目内容 */
  content: string;
  /** 项目类型 */
  type?: ChecklistItemType;
  /** 负责人 */
  assignee?: string;
  /** 预计完成时间 */
  due_date?: string;
  /** 关联的实体 ID */
  related_entity_id?: string;
  /** 关联的实体类型 */
  related_entity_type?: string;
  /** 前置任务 ID 列表 */
  depends_on?: string[];
  /** 插入位置（分组 ID） */
  group_id?: string;
  /** 顺序 */
  order?: number;
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
 * 计算 Checklist 进度
 */
export function calculateChecklistProgress(checklist: Checklist): Checklist['progress'] {
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
  const completedIds = new Set(
    checklist.items.filter((i) => i.status === 'completed').map((i) => i.id),
  );

  return checklist.items.filter((item) => {
    if (item.status !== 'pending') return false;
    if (!item.depends_on || item.depends_on.length === 0) return false;
    return item.depends_on.some((depId) => !completedIds.has(depId));
  });
}
