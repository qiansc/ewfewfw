/**
 * Feat Checklist 操作（Data Ops）
 */

import type {
  ChecklistParams,
  ChecklistResult,
  Checklist,
  ChecklistItem,
} from '../../adapter.js';
import type { DataOpsContext, FeatMergeEntity } from '../types.js';

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
  ctx: DataOpsContext,
  params: ChecklistParams
): Promise<ChecklistResult> {
  const featId = params.feat_id;
  const shouldValidate = params.validate !== false; // 默认 true

  switch (params.action) {
    case 'generate':
      return generateChecklist(ctx, featId, params.source, shouldValidate);
    case 'get':
      return getChecklist(ctx, featId);
    case 'patch':
      return patchChecklist(ctx, featId, params.patches || [], shouldValidate);
    case 'clear':
      return clearChecklist(ctx, featId);
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
  ctx: DataOpsContext,
  featId: string,
  source?: string,
  validate?: boolean
): ChecklistResult {
  const feat = ctx.storage.getFeat(featId);
  if (!feat) {
    return {
      success: false,
      feat_id: featId,
      error: 'FEAT_NOT_FOUND',
      message: `Feat ${featId} not found`,
    };
  }

  const entities = ctx.storage.listFeatEntitiesForMerge(featId);
  const items = buildChecklistItems(entities);
  const now = new Date().toISOString();
  const expectedUpdatedAt = feat.updated_at ?? now;

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

  const updateResult = updateChecklistRecord(
    ctx,
    featId,
    checklist,
    feat.checklist_version ?? null,
    expectedUpdatedAt,
    now
  );
  if (!updateResult.success) {
    return updateResult.result;
  }

  return {
    success: true,
    feat_id: featId,
    checklist,
  };
}

/**
 * 获取 Checklist
 */
function getChecklist(ctx: DataOpsContext, featId: string): ChecklistResult {
  const feat = ctx.storage.getFeat(featId);
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

  const parsedChecklist = parseChecklistPayload(feat.checklist, featId);
  if (!parsedChecklist.success) {
    return parsedChecklist.result;
  }

  return {
    success: true,
    feat_id: featId,
    checklist: parsedChecklist.checklist,
  };
}

/**
 * 增量更新 Checklist
 *
 * P2-3.2: 支持 validate 参数验证 checklist 结构
 */
function patchChecklist(
  ctx: DataOpsContext,
  featId: string,
  patches: ChecklistParams['patches'],
  validate?: boolean
): ChecklistResult {
  const feat = ctx.storage.getFeat(featId);
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

  const parsedChecklist = parseChecklistPayload(feat.checklist, featId);
  if (!parsedChecklist.success) {
    return parsedChecklist.result;
  }

  const checklist = parsedChecklist.checklist;
  const patchedTasks: Array<{ task_id: string; fields_updated: string[] }> = [];
  const missingTasks: string[] = [];

  for (const patch of patches || []) {
    const taskIndex = checklist.items.findIndex((item) => item.id === patch.task_id);

    if (taskIndex === -1) {
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

  const now = new Date().toISOString();
  checklist.updated_at = now;
  const expectedUpdatedAt = feat.updated_at ?? now;

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

  const updateResult = updateChecklistRecord(
    ctx,
    featId,
    checklist,
    feat.checklist_version ?? null,
    expectedUpdatedAt,
    now
  );
  if (!updateResult.success) {
    return updateResult.result;
  }

  return {
    success: true,
    feat_id: featId,
    patched_at: now,
    patched_tasks: patchedTasks,
    updated_checklist: checklist,
  };
}

function parseChecklistPayload(
  rawChecklist: string,
  featId: string
): { success: true; checklist: Checklist } | { success: false; result: ChecklistResult } {
  try {
    const checklist = JSON.parse(rawChecklist) as Checklist;
    return { success: true, checklist };
  } catch (error) {
    return {
      success: false,
      result: {
        success: false,
        feat_id: featId,
        error: 'CHECKLIST_PARSE_FAILED',
        message: `Checklist 数据损坏，无法解析: ${(error as Error).message}`,
      },
    };
  }
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

  if (!checklist.version) {
    errors.push({
      code: 'MISSING_VERSION',
      message: 'Checklist 缺少 version 字段',
    });
  }

  if (!checklist.items || !Array.isArray(checklist.items)) {
    errors.push({
      code: 'MISSING_ITEMS',
      message: 'Checklist 缺少 items 数组',
    });
    return errors;
  }

  const seenIds = new Set<string>();
  const validStatuses = ['pending', 'in_progress', 'completed', 'blocked', 'skipped'];

  for (const item of checklist.items) {
    if (!item.id) {
      errors.push({
        code: 'MISSING_TASK_ID',
        message: 'Checklist item 缺少 id 字段',
      });
      continue;
    }

    if (seenIds.has(item.id)) {
      errors.push({
        code: 'DUPLICATE_TASK_ID',
        message: `Checklist item id "${item.id}" 重复`,
        task_id: item.id,
      });
    }
    seenIds.add(item.id);

    if (!item.title) {
      errors.push({
        code: 'MISSING_TASK_TITLE',
        message: `Checklist item "${item.id}" 缺少 title 字段`,
        task_id: item.id,
      });
    }

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
function clearChecklist(ctx: DataOpsContext, featId: string): ChecklistResult {
  const feat = ctx.storage.getFeat(featId);
  if (!feat) {
    return {
      success: false,
      feat_id: featId,
      error: 'FEAT_NOT_FOUND',
      message: `Feat ${featId} not found`,
    };
  }

  const now = new Date().toISOString();
  const expectedUpdatedAt = feat.updated_at ?? now;
  const updateResult = updateChecklistRecord(
    ctx,
    featId,
    null,
    feat.checklist_version ?? null,
    expectedUpdatedAt,
    now
  );
  if (!updateResult.success) {
    return updateResult.result;
  }

  return {
    success: true,
    feat_id: featId,
    cleared: true,
  };
}

function buildChecklistItems(entities: FeatMergeEntity[]): ChecklistItem[] {
  return entities.map((entity, index) => {
    let name: string | undefined;
    try {
      const data = JSON.parse(entity.data) as Record<string, unknown>;
      if (typeof data.name === 'string') {
        name = data.name;
      }
    } catch {
      name = undefined;
    }

    return {
      id: `task-${String(index + 1).padStart(3, '0')}`,
      title: `${entity.type}: ${name || entity.id}`,
      status: 'pending',
      type: 'dsl',
      entity_id: entity.id,
    };
  });
}

function updateChecklistRecord(
  ctx: DataOpsContext,
  featId: string,
  checklist: Checklist | null,
  expectedVersion: string | null,
  expectedUpdatedAt: string,
  updatedAt: string
): { success: true } | { success: false; result: ChecklistResult } {
  const checklistVersion = checklist ? createChecklistVersion() : null;
  const payload = checklist ? JSON.stringify(checklist) : null;
  const result = ctx.storage.updateFeatChecklist({
    featId,
    checklist: payload,
    checklistVersion,
    expectedVersion,
    updatedAt,
    expectedUpdatedAt,
  });

  if (result.affectedRows === 0) {
    return {
      success: false,
      result: {
        success: false,
        feat_id: featId,
        error: 'CHECKLIST_CONFLICT',
        message: 'Checklist 已被其他会话更新，请先执行 get 获取最新内容',
      },
    };
  }

  return { success: true };
}

function createChecklistVersion(): string {
  return new Date().toISOString();
}
