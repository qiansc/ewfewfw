/**
 * Feat Workflow 操作（Data Ops）
 */

import type {
  UpdateWorkflowStepParams,
  UpdateWorkflowStepResult,
  WorkflowStepStatus,
} from '../../adapter.js';
import type { DataOpsContext } from '../types.js';

// ============================================================
// UpdateWorkflowStep 操作
// ============================================================

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
 */
export async function updateWorkflowStep(
  ctx: DataOpsContext,
  params: UpdateWorkflowStepParams
): Promise<UpdateWorkflowStepResult> {
  const { feat_id, step_id, status, metadata } = params;

  // 1. 读取当前 workflow_steps 和 updated_at（用于乐观锁）
  const feat = ctx.storage.getFeat(feat_id) as {
    workflow_steps?: string | null;
    updated_at?: string;
  } | null;

  if (!feat || !feat.updated_at) {
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
  const result = ctx.storage.updateFeatWorkflowSteps({
    featId: feat_id,
    workflowSteps: JSON.stringify(workflowSteps),
    updatedAt: now,
    expectedUpdatedAt: originalUpdatedAt,
  });

  if (result.affectedRows === 0) {
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
}
