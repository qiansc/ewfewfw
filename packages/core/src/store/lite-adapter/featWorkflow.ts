/**
 * LiteAdapter Feat Workflow 操作
 */

import type {
  UpdateWorkflowStepParams,
  UpdateWorkflowStepResult,
  WorkflowStepStatus,
} from '../adapter.js';
import type { AdapterContext } from './types.js';

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

    // 3. 更新字段
    const now = new Date().toISOString();
    if (status !== undefined) {
      workflowSteps[stepIndex].status = status;
    }
    if (metadata !== undefined) {
      workflowSteps[stepIndex].metadata = metadata;
    }
    workflowSteps[stepIndex].updated_at = now;

    // 4. 写回并进行乐观锁校验
    const result = db.prepare(`
      UPDATE feats
      SET workflow_steps = ?, updated_at = ?
      WHERE id = ? AND updated_at = ?
    `).run(JSON.stringify(workflowSteps), now, feat_id, originalUpdatedAt);

    if (result.changes === 0) {
      return {
        success: false,
        feat_id,
        step_id,
        error: 'concurrent_update',
        message: '步骤更新失败，检测到并发修改',
      };
    }

    return {
      success: true,
      feat_id,
      step_id,
      status: workflowSteps[stepIndex].status,
      updated_at: now,
    };
  });

  return transaction() as UpdateWorkflowStepResult;
}
