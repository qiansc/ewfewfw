/**
 * LiteAdapter Feat Checklist 操作
 */

import type {
  ChecklistParams,
  ChecklistResult,
  Checklist,
  ChecklistItem,
} from '../adapter.js';
import type { AdapterContext } from './types.js';

// ============================================================
// FeatChecklist 操作
// ============================================================

/**
 * Checklist 管理
 *
 * P2-3.2: 支持 validate 参数
 * 设计文档: store-feat-checklist.md §3.8
 */
export async function featChecklist(
  ctx: AdapterContext,
  params: ChecklistParams
): Promise<ChecklistResult> {
  const db = ctx.store.getDatabase();
  const featId = params.feat_id;
  const shouldValidate = params.validate !== false; // 默认 true

  switch (params.action) {
    case 'generate':
      return generateChecklist(db, featId, params.source, shouldValidate);
    case 'get':
      return getChecklist(db, featId);
    case 'patch':
      return patchChecklist(db, featId, params.patches || [], shouldValidate);
    case 'clear':
      return clearChecklist(db, featId);
    default:
      return {
        success: false,
        feat_id: featId,
        error: 'INVALID_ACTION',
        message: `Unknown action: ${params.action}`,
      };
  }
}

/**
 * 生成 Checklist
 *
 * P2-3.2: 支持 validate 参数验证 checklist 结构
 */
function generateChecklist(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  featId: string,
  source?: string,
  validate?: boolean
): ChecklistResult {
  const now = new Date().toISOString();

  // 检查 feat 是否存在
  const feat = db.prepare(`SELECT id, status FROM feats WHERE id = ?`).get(featId);
  if (!feat) {
    return {
      success: false,
      feat_id: featId,
      error: 'FEAT_NOT_FOUND',
      message: `Feat ${featId} not found`,
    };
  }

  // 从 feat 关联的实体生成 checklist
  const entities = db.prepare(`
    SELECT e.id, e.type, e.data
    FROM entities e
    WHERE e.proposal_id = ?
  `).all(featId) as Array<{ id: string; type: string; data: string }>;

  const items: ChecklistItem[] = entities.map((entity, index) => {
    const data = JSON.parse(entity.data) as Record<string, unknown>;
    return {
      id: `task-${String(index + 1).padStart(3, '0')}`,
      title: `${entity.type}: ${data.name || entity.id}`,
      status: 'pending' as const,
      type: 'dsl' as const,
      entity_id: entity.id,
    };
  });

  const checklist: Checklist = {
    version: '1.0',
    metadata: {
      feat_id: featId,
      generated_at: now,
      source: source || 'entities',
    },
    updated_at: now,
    items,
  };

  // P2-3.2: 验证 checklist 结构
  if (validate !== false) {
    const validationErrors = validateChecklistStructure(checklist);
    if (validationErrors.length > 0) {
      return {
        success: false,
        feat_id: featId,
        error: 'VALIDATION_FAILED',
        message: 'Checklist 结构验证失败',
        validation_errors: validationErrors,
      };
    }
  }

  // 保存到数据库
  db.prepare(`
    UPDATE feats SET checklist = ?, updated_at = ? WHERE id = ?
  `).run(JSON.stringify(checklist), now, featId);

  return {
    success: true,
    feat_id: featId,
    checklist,
  };
}

/**
 * 获取 Checklist
 */
function getChecklist(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  featId: string
): ChecklistResult {
  const feat = db.prepare(`
    SELECT id, checklist FROM feats WHERE id = ?
  `).get(featId) as { id: string; checklist: string | null } | undefined;

  if (!feat) {
    return {
      success: false,
      feat_id: featId,
      error: 'FEAT_NOT_FOUND',
      message: `Feat ${featId} not found`,
    };
  }

  if (!feat.checklist) {
    return {
      success: true,
      feat_id: featId,
      checklist: undefined,
    };
  }

  return {
    success: true,
    feat_id: featId,
    checklist: JSON.parse(feat.checklist) as Checklist,
  };
}

/**
 * 增量更新 Checklist
 *
 * P2-3.2: 支持 validate 参数验证 checklist 结构
 */
function patchChecklist(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  featId: string,
  patches: ChecklistParams['patches'],
  validate?: boolean
): ChecklistResult {
  const now = new Date().toISOString();

  // 获取当前 checklist
  const feat = db.prepare(`
    SELECT id, checklist FROM feats WHERE id = ?
  `).get(featId) as { id: string; checklist: string | null } | undefined;

  if (!feat) {
    return {
      success: false,
      feat_id: featId,
      error: 'FEAT_NOT_FOUND',
      message: `Feat ${featId} not found`,
    };
  }

  if (!feat.checklist) {
    return {
      success: false,
      feat_id: featId,
      error: 'CHECKLIST_NOT_FOUND',
      message: `Checklist for feat ${featId} not found. Please generate first.`,
    };
  }

  const checklist = JSON.parse(feat.checklist) as Checklist;
  const patchedTasks: Array<{ task_id: string; fields_updated: string[] }> = [];
  const missingTasks: string[] = [];

  for (const patch of patches || []) {
    const taskIndex = checklist.items.findIndex(item => item.id === patch.task_id);

    if (taskIndex === -1) {
      // 如果任务不存在且有 title，则添加新任务
      if (patch.updates.title) {
        const newItem: ChecklistItem = {
          id: patch.task_id,
          title: patch.updates.title,
          status: patch.updates.status || 'pending',
          type: patch.updates.type,
          entity_id: patch.updates.entity_id,
          assignee: patch.updates.assignee,
          completed_at: patch.updates.completed_at,
          blocked_reason: patch.updates.blocked_reason,
        };
        checklist.items.push(newItem);
        patchedTasks.push({
          task_id: patch.task_id,
          fields_updated: Object.keys(patch.updates),
        });
      } else {
        missingTasks.push(patch.task_id);
      }
      continue;
    }

    // 更新现有任务
    const fieldsUpdated: string[] = [];
    const item = checklist.items[taskIndex];

    if (patch.updates.status !== undefined) {
      item.status = patch.updates.status;
      fieldsUpdated.push('status');
    }
    if (patch.updates.assignee !== undefined) {
      item.assignee = patch.updates.assignee;
      fieldsUpdated.push('assignee');
    }
    if (patch.updates.completed_at !== undefined) {
      item.completed_at = patch.updates.completed_at;
      fieldsUpdated.push('completed_at');
    }
    if (patch.updates.blocked_reason !== undefined) {
      item.blocked_reason = patch.updates.blocked_reason;
      fieldsUpdated.push('blocked_reason');
    }
    if (patch.updates.title !== undefined) {
      item.title = patch.updates.title;
      fieldsUpdated.push('title');
    }
    if (patch.updates.type !== undefined) {
      item.type = patch.updates.type;
      fieldsUpdated.push('type');
    }

    patchedTasks.push({ task_id: patch.task_id, fields_updated: fieldsUpdated });
  }

  if (missingTasks.length > 0) {
    return {
      success: false,
      feat_id: featId,
      error: 'task_not_found',
      missing_tasks: missingTasks,
      message: `任务 ${missingTasks.join(', ')} 不存在，请先执行 get 获取最新 checklist`,
    };
  }

  // 更新 checklist
  checklist.updated_at = now;

  // P2-3.2: 验证 checklist 结构
  if (validate !== false) {
    const validationErrors = validateChecklistStructure(checklist);
    if (validationErrors.length > 0) {
      return {
        success: false,
        feat_id: featId,
        error: 'VALIDATION_FAILED',
        message: 'Checklist 结构验证失败',
        validation_errors: validationErrors,
      };
    }
  }

  db.prepare(`
    UPDATE feats SET checklist = ?, updated_at = ? WHERE id = ?
  `).run(JSON.stringify(checklist), now, featId);

  return {
    success: true,
    feat_id: featId,
    patched_at: now,
    patched_tasks: patchedTasks,
    updated_checklist: checklist,
  };
}

/**
 * 验证 Checklist 结构
 *
 * P2-3.2: 设计文档 store-feat-checklist.md §3.8
 * 验证规则：
 * - checklist 必须有 version 字段
 * - checklist 必须有 items 数组
 * - 每个 item 必须有 id 和 title
 * - item.id 必须唯一
 * - item.status 必须是有效值
 */
function validateChecklistStructure(
  checklist: Checklist
): Array<{ code: string; message: string; task_id?: string }> {
  const errors: Array<{ code: string; message: string; task_id?: string }> = [];

  // 验证 version
  if (!checklist.version) {
    errors.push({
      code: 'MISSING_VERSION',
      message: 'Checklist 缺少 version 字段',
    });
  }

  // 验证 items 数组
  if (!checklist.items || !Array.isArray(checklist.items)) {
    errors.push({
      code: 'MISSING_ITEMS',
      message: 'Checklist 缺少 items 数组',
    });
    return errors; // 无法继续验证
  }

  // 验证每个 item
  const seenIds = new Set<string>();
  const validStatuses = ['pending', 'in_progress', 'completed', 'blocked', 'skipped'];

  for (const item of checklist.items) {
    // 验证 id
    if (!item.id) {
      errors.push({
        code: 'MISSING_TASK_ID',
        message: 'Checklist item 缺少 id 字段',
      });
      continue;
    }

    // 验证 id 唯一性
    if (seenIds.has(item.id)) {
      errors.push({
        code: 'DUPLICATE_TASK_ID',
        message: `Checklist item id "${item.id}" 重复`,
        task_id: item.id,
      });
    }
    seenIds.add(item.id);

    // 验证 title
    if (!item.title) {
      errors.push({
        code: 'MISSING_TASK_TITLE',
        message: `Checklist item "${item.id}" 缺少 title 字段`,
        task_id: item.id,
      });
    }

    // 验证 status
    if (item.status && !validStatuses.includes(item.status)) {
      errors.push({
        code: 'INVALID_TASK_STATUS',
        message: `Checklist item "${item.id}" 的 status "${item.status}" 无效，有效值: ${validStatuses.join(', ')}`,
        task_id: item.id,
      });
    }
  }

  return errors;
}

/**
 * 清除 Checklist
 */
function clearChecklist(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  featId: string
): ChecklistResult {
  const now = new Date().toISOString();

  const result = db.prepare(`
    UPDATE feats SET checklist = NULL, updated_at = ? WHERE id = ?
  `).run(now, featId);

  if (result.changes === 0) {
    return {
      success: false,
      feat_id: featId,
      error: 'FEAT_NOT_FOUND',
      message: `Feat ${featId} not found`,
    };
  }

  return {
    success: true,
    feat_id: featId,
    cleared: true,
  };
}
