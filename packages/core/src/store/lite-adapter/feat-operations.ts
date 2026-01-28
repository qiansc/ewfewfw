/**
 * LiteAdapter Feat 生命周期操作
 */

import { isValidFeatStatusTransition } from '../../types/index.js';
import type { SQLiteStore } from '../sqlite-store.js';
import type {
  FeatLifecycleParams,
  FeatLifecycleResult,
  FeatMergeParams,
  FeatMergeResult,
  FeatStatus,
  FeatConflict,
  ChecklistParams,
  ChecklistResult,
  Checklist,
  ChecklistItem,
  UpdateWorkflowStepParams,
  UpdateWorkflowStepResult,
  WorkflowStepStatus,
} from '../adapter.js';
import type { AdapterContext } from './types.js';

// ============================================================
// FeatLifecycle 操作
// ============================================================

/**
 * Feat 生命周期管理
 */
export async function featLifecycle(
  ctx: AdapterContext,
  params: FeatLifecycleParams
): Promise<FeatLifecycleResult> {
  const db = ctx.store.getDatabase();

  switch (params.action) {
    case 'create':
      return createFeat(db, params);
    case 'transition':
      return transitionFeat(db, params);
    case 'delete':
      return deleteFeat(db, params);
    default:
      return {
        success: false,
        feat_id: params.feat_id,
        error: 'INVALID_ACTION',
        message: `Unknown action: ${params.action}`,
      };
  }
}

// ============================================================
// FeatMerge 操作
// ============================================================

/**
 * Feat 合并操作
 */
export async function featMerge(
  ctx: AdapterContext,
  params: FeatMergeParams
): Promise<FeatMergeResult> {
  const db = ctx.store.getDatabase();
  const featId = params.feat_id;

  // 检测冲突
  const conflicts = detectFeatConflicts(db, featId);

  if (params.strategy === 'auto') {
    if (conflicts.length > 0) {
      return {
        success: false,
        merged: [],
        conflicts,
      };
    }

    // 无冲突，执行合并
    const result = mergeFeatToMain(db, featId);
    return {
      success: true,
      merged: result.merged,
      conflicts: [],
    };
  }

  // manual 策略：应用冲突解决方案
  if (params.conflict_resolution) {
    for (const resolution of params.conflict_resolution) {
      if (resolution.resolution === 'keep_main') {
        // 删除 feat 中的实体
        db.prepare(`
          DELETE FROM entities WHERE id = ? AND proposal_id = ?
        `).run(resolution.entity_id, featId);
      }
      // keep_feat: 保留 feat 版本，合并时会覆盖主分支
    }
  }

  // 执行合并
  const result = mergeFeatToMain(db, featId);
  return {
    success: true,
    merged: result.merged,
    conflicts: [],
  };
}

// ============================================================
// 内部辅助函数
// ============================================================

/**
 * 创建 Feat
 */
function createFeat(
  db: ReturnType<SQLiteStore['getDatabase']>,
  params: FeatLifecycleParams
): FeatLifecycleResult {
  const now = new Date().toISOString();
  const featId = params.feat_id;

  // 检查 feat 是否已存在
  const existing = db.prepare(`
    SELECT id FROM feats WHERE id = ?
  `).get(featId);

  if (existing) {
    return {
      success: false,
      feat_id: featId,
      error: 'FEAT_EXISTS',
      message: `Feat ${featId} already exists`,
    };
  }

  // 创建 feat
  db.prepare(`
    INSERT INTO feats (id, status, title, description, created_by, created_at, updated_at)
    VALUES (?, 'draft', ?, ?, ?, ?, ?)
  `).run(
    featId,
    params.metadata?.title || featId,
    params.metadata?.description || '',
    params.metadata?.created_by || 'unknown',
    now,
    now
  );

  return {
    success: true,
    feat_id: featId,
    status: 'draft' as FeatStatus,
  };
}

/**
 * 流转 Feat 状态
 *
 * 设计文档: store-feat-lifecycle.md §3.6
 */
function transitionFeat(
  db: ReturnType<SQLiteStore['getDatabase']>,
  params: FeatLifecycleParams
): FeatLifecycleResult {
  const featId = params.feat_id;
  const toStatus = params.to_status;

  if (!toStatus) {
    return {
      success: false,
      feat_id: featId,
      error: 'MISSING_STATUS',
      message: 'to_status is required for transition action',
    };
  }

  // 获取当前状态
  const feat = db.prepare(`
    SELECT status FROM feats WHERE id = ?
  `).get(featId) as { status: FeatStatus } | undefined;

  if (!feat) {
    return {
      success: false,
      feat_id: featId,
      error: 'FEAT_NOT_FOUND',
      message: `Feat ${featId} not found`,
    };
  }

  const fromStatus = feat.status;

  // 验证状态流转
  if (!isValidFeatStatusTransition(fromStatus, toStatus)) {
    return {
      success: false,
      feat_id: featId,
      from_status: fromStatus,
      error: 'INVALID_TRANSITION',
      message: `Cannot transition from ${fromStatus} to ${toStatus}`,
    };
  }

  // P1-2.2: 发布前同步校验（expected_content_hash）
  // 设计文档: store-feat-lifecycle.md §3.6
  if (toStatus === 'published' && params.expected_content_hash) {
    const actualHash = computeFeatContentHash(db, featId);
    if (actualHash !== params.expected_content_hash) {
      return {
        success: false,
        feat_id: featId,
        from_status: fromStatus,
        error: 'content_hash_mismatch',
        message: '本地存在未同步的修改，请先执行 c4a sync',
        expected_hash: params.expected_content_hash,
        actual_hash: actualHash,
      };
    }
  }

  // 发布时检查冲突
  if (toStatus === 'published' && !params.force_publish) {
    const conflicts = detectFeatConflicts(db, featId);
    if (conflicts.length > 0) {
      return {
        success: false,
        feat_id: featId,
        from_status: fromStatus,
        error: 'merge_conflict',
        message: '发布前需要先解决冲突',
        conflicts,
      };
    }
  }

  // 执行状态流转
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE feats SET status = ?, updated_at = ? WHERE id = ?
  `).run(toStatus, now, featId);

  // 发布时合并实体到主分支
  let mergeResult: { merged: string[]; conflicts: FeatConflict[] } | undefined;
  if (toStatus === 'published') {
    mergeResult = mergeFeatToMain(db, featId);
  }

  return {
    success: true,
    feat_id: featId,
    from_status: fromStatus,
    to_status: toStatus as FeatStatus,
    merge_result: mergeResult,
  };
}

/**
 * 删除 Feat
 */
function deleteFeat(
  db: ReturnType<SQLiteStore['getDatabase']>,
  params: FeatLifecycleParams
): FeatLifecycleResult {
  const featId = params.feat_id;

  // 删除 feat 关联的实体
  db.prepare(`DELETE FROM entities WHERE proposal_id = ?`).run(featId);
  db.prepare(`DELETE FROM metadata WHERE proposal_id = ?`).run(featId);
  db.prepare(`DELETE FROM relations WHERE proposal_id = ?`).run(featId);

  // 删除 feat 本身
  db.prepare(`DELETE FROM feats WHERE id = ?`).run(featId);

  return {
    success: true,
    feat_id: featId,
    deleted: true,
  };
}

/**
 * 计算 Feat 内容哈希
 * 用于发布前同步校验
 */
function computeFeatContentHash(
  db: ReturnType<SQLiteStore['getDatabase']>,
  featId: string
): string {
  // 获取 feat 中所有实体的 content_hash，按 ID 排序后拼接
  const hashes = db.prepare(`
    SELECT m.content_hash
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE e.proposal_id = ?
    ORDER BY e.id
  `).all(featId) as Array<{ content_hash: string }>;

  // 拼接所有哈希值
  const combined = hashes.map(h => h.content_hash).join('|');

  // 计算组合哈希
  const { createHash } = require('node:crypto');
  return 'sha256:' + createHash('sha256').update(combined).digest('hex').slice(0, 16);
}

/**
 * 检测 Feat 冲突
 */
function detectFeatConflicts(
  db: ReturnType<SQLiteStore['getDatabase']>,
  featId: string
): FeatConflict[] {
  // 查找 feat 中修改的实体
  const featEntities = db.prepare(`
    SELECT e.id, e.source_project, e.data, m.content_hash
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE e.proposal_id = ?
  `).all(featId) as Array<{
    id: string;
    source_project: string;
    data: string;
    content_hash: string;
  }>;

  const conflicts: FeatConflict[] = [];

  for (const entity of featEntities) {
    // 检查主分支是否有同名实体
    const mainEntity = db.prepare(`
      SELECT e.data, m.content_hash
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      WHERE e.id = ? AND e.source_project = ? AND e.proposal_id IS NULL
    `).get(entity.id, entity.source_project) as {
      data: string;
      content_hash: string;
    } | undefined;

    if (mainEntity && mainEntity.content_hash !== entity.content_hash) {
      conflicts.push({
        entity_id: entity.id,
        conflict_type: 'both_modified',
        main_branch: JSON.parse(mainEntity.data),
        feat_branch: JSON.parse(entity.data),
        suggested_resolution: 'keep_feat',
      });
    }
  }

  return conflicts;
}

/**
 * 合并 Feat 到主分支
 *
 * 设计文档: store-feat-lifecycle.md §3.7
 * Copy-on-Write 机制：将 feat 版本移到主分支，删除旧版本
 *
 * 步骤：
 * 1. 删除主分支中被 feat 修改的实体旧版本
 * 2. 将 feat 版本移到主分支（proposal_id 设为 NULL）
 */
function mergeFeatToMain(
  db: ReturnType<SQLiteStore['getDatabase']>,
  featId: string
): { merged: string[]; conflicts: FeatConflict[] } {
  const merged: string[] = [];
  const now = new Date().toISOString();

  // 获取 feat 中的所有实体 ID
  const featEntities = db.prepare(`
    SELECT e.id, e.source_project, e.type, e.kind, e.scope, e.perspective, e.data,
           m.status, m.content_hash
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE e.proposal_id = ?
  `).all(featId) as Array<{
    id: string;
    source_project: string;
    type: string;
    kind: string | null;
    scope: string | null;
    perspective: string | null;
    data: string;
    status: string;
    content_hash: string;
  }>;

  // 使用事务确保原子性
  const transaction = db.transaction(() => {
    for (const entity of featEntities) {
      // 1. 删除主分支旧版本（如果存在）
      db.prepare(`
        DELETE FROM entities
        WHERE id = ? AND source_project = ? AND proposal_id IS NULL
      `).run(entity.id, entity.source_project);

      db.prepare(`
        DELETE FROM metadata
        WHERE entity_id = ? AND source_project = ? AND proposal_id IS NULL
      `).run(entity.id, entity.source_project);

      db.prepare(`
        DELETE FROM relations
        WHERE (from_id = ? OR to_id = ?) AND from_project = ? AND proposal_id IS NULL
      `).run(entity.id, entity.id, entity.source_project);

      merged.push(entity.id);
    }

    // 2. 将 feat 版本移到主分支（更新 proposal_id 为 NULL）
    db.prepare(`
      UPDATE entities SET proposal_id = NULL WHERE proposal_id = ?
    `).run(featId);

    db.prepare(`
      UPDATE metadata SET proposal_id = NULL, status = 'published', updated_at = ?
      WHERE proposal_id = ?
    `).run(now, featId);

    db.prepare(`
      UPDATE relations SET proposal_id = NULL WHERE proposal_id = ?
    `).run(featId);

    // 3. 清理 feat 的 checklist（发布后不再需要）
    db.prepare(`
      UPDATE feats SET checklist = NULL WHERE id = ?
    `).run(featId);
  });

  transaction();

  return { merged, conflicts: [] };
}

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

// ============================================================
// UpdateWorkflowStep 操作
// ============================================================

/**
 * Workflow 步骤数据结构
 */
interface WorkflowStep {
  id: string;
  status: WorkflowStepStatus;
  metadata?: Record<string, unknown>;
  updated_at?: string;
}

/**
 * 原子更新 workflow 步骤状态
 *
 * 设计文档: store-feat-checklist.md §3.9
 *
 * 职责说明：
 * - 原子更新：使用数据库事务 + 乐观锁更新特定步骤的字段
 * - 并发安全：通过 updated_at 字段实现乐观锁，检测并发修改
 * - 部分更新：仅更新指定字段，不影响其他步骤或 Feat 的其他字段
 * - 错误恢复：支持 Skills 错误恢复机制中的状态持久化
 */
export async function updateWorkflowStep(
  ctx: AdapterContext,
  params: UpdateWorkflowStepParams
): Promise<UpdateWorkflowStepResult> {
  const db = ctx.store.getDatabase();
  const { feat_id, step_id, status, metadata } = params;

  // 使用事务 + 乐观锁实现原子更新
  const transaction = db.transaction(() => {
    // 1. 读取当前 workflow_steps 和 updated_at（用于乐观锁）
    const feat = db.prepare(`
      SELECT workflow_steps, updated_at FROM feats WHERE id = ?
    `).get(feat_id) as { workflow_steps: string | null; updated_at: string } | undefined;

    if (!feat) {
      return {
        success: false,
        feat_id,
        step_id,
        error: 'feat_not_found',
        message: `Feat ${feat_id} 不存在`,
      };
    }

    const originalUpdatedAt = feat.updated_at;

    // 解析 workflow_steps
    let workflowSteps: WorkflowStep[] = [];
    if (feat.workflow_steps) {
      try {
        workflowSteps = JSON.parse(feat.workflow_steps) as WorkflowStep[];
      } catch {
        workflowSteps = [];
      }
    }

    // 2. 查找目标步骤
    const stepIndex = workflowSteps.findIndex((s) => s.id === step_id);

    if (stepIndex === -1) {
      return {
        success: false,
        feat_id,
        step_id,
        error: 'step_not_found',
        message: `Step ${step_id} 在 ${feat_id} 中不存在`,
      };
    }

    // 3. 更新特定步骤
    const updatedFields: string[] = [];
    const step = workflowSteps[stepIndex];

    if (status !== undefined) {
      step.status = status;
      updatedFields.push('status');
    }

    if (metadata !== undefined) {
      step.metadata = {
        ...step.metadata,
        ...metadata,
      };
      // 记录更新的 metadata 字段
      for (const key of Object.keys(metadata)) {
        updatedFields.push(`metadata.${key}`);
      }
    }

    step.updated_at = new Date().toISOString();

    // 4. 乐观锁写回：检查 updated_at 是否被其他事务修改
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE feats
      SET workflow_steps = ?, updated_at = ?
      WHERE id = ? AND updated_at = ?
    `).run(JSON.stringify(workflowSteps), now, feat_id, originalUpdatedAt);

    if (result.changes === 0) {
      // 乐观锁冲突：其他事务已修改
      return {
        success: false,
        feat_id,
        step_id,
        error: 'concurrent_modification',
        message: `Feat ${feat_id} 已被其他操作修改，请重试`,
      };
    }

    return {
      success: true,
      feat_id,
      step_id,
      updated_fields: updatedFields,
    };
  });

  return transaction() as UpdateWorkflowStepResult;
}
