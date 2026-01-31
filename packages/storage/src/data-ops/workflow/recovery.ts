import type { StorageOperations } from '../types.js';
import type {
  WorkflowCheckpoint,
  WorkflowContextData,
  WorkflowStateRecord,
  WorkflowStep,
  WorkflowStepSnapshot,
} from './types.js';
import { executeStep } from './stepExecutor.js';
import { getRegisteredWorkflowSteps, updateWorkflowState } from './workflowState.js';

export interface RecoveryResult {
  success: boolean;
  recovered?: boolean;
  error?: string;
}

function readWorkflowRecord(
  storage: StorageOperations,
  workflowId: string
): WorkflowStateRecord | null {
  return storage.getWorkflowStateRecord(workflowId);
}

function parseContext(record: WorkflowStateRecord | null): WorkflowContextData {
  if (!record?.context_json) {
    return { steps: [], checkpoint: null };
  }
  try {
    return JSON.parse(record.context_json) as WorkflowContextData;
  } catch {
    return { steps: [], checkpoint: null };
  }
}

function persistContext(
  storage: StorageOperations,
  workflowId: string,
  record: WorkflowStateRecord | null,
  context: WorkflowContextData,
  currentStep: number
): void {
  const now = new Date().toISOString();
  if (!record) {
    storage.upsertWorkflowState({
      id: workflowId,
      workflow_type: workflowId,
      current_step: currentStep,
      total_steps: context.steps.length,
      state: 'running',
      context_json: JSON.stringify(context),
      created_at: now,
      updated_at: now,
    });
    return;
  }

  storage.upsertWorkflowState({
    ...record,
    current_step: currentStep,
    total_steps: context.steps.length,
    context_json: JSON.stringify(context),
    updated_at: now,
  });
}

function mergeSteps(
  snapshots: WorkflowStepSnapshot[],
  registered: WorkflowStep[] | null
): WorkflowStep[] {
  if (!registered) {
    return snapshots.map((step) => ({
      ...step,
      status: step.status,
    }));
  }

  return snapshots.map((snapshot) => {
    const registeredStep = registered.find((step) => step.id === snapshot.id);
    return {
      ...snapshot,
      status: snapshot.status,
      execute: registeredStep?.execute,
      checkCompleted: registeredStep?.checkCompleted,
      input: registeredStep?.input,
      input_hash: snapshot.input_hash ?? registeredStep?.input_hash,
      metadata: snapshot.metadata ?? registeredStep?.metadata,
      type: snapshot.type ?? registeredStep?.type,
      title: snapshot.title ?? registeredStep?.title,
    };
  });
}

/**
 * 保存 checkpoint
 */
export function saveCheckpoint(
  storage: StorageOperations,
  workflowId: string,
  checkpoint: WorkflowCheckpoint
): void {
  const record = readWorkflowRecord(storage, workflowId);
  const context = parseContext(record);
  context.checkpoint = checkpoint;

  if (context.steps[checkpoint.step_index]) {
    context.steps[checkpoint.step_index] = {
      ...context.steps[checkpoint.step_index],
      status: 'completed',
      input_hash: checkpoint.input_hash ?? context.steps[checkpoint.step_index].input_hash,
    };
  }

  persistContext(storage, workflowId, record, context, checkpoint.step_index + 1);
}

/**
 * 从 checkpoint 恢复
 */
export async function resumeFromCheckpoint(
  storage: StorageOperations,
  workflowId: string
): Promise<void> {
  const record = readWorkflowRecord(storage, workflowId);
  if (!record) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  const context = parseContext(record);
  const registered = getRegisteredWorkflowSteps(workflowId);
  const steps = mergeSteps(context.steps, registered);
  const startIndex = context.checkpoint?.step_index ?? -1;

  updateWorkflowState(storage, workflowId, 'running');

  for (let index = startIndex + 1; index < steps.length; index += 1) {
    const step = steps[index];
    const result = await executeStep(step);
    if (!result.success) {
      updateWorkflowState(storage, workflowId, 'failed');
      throw new Error(result.error ?? `Workflow ${workflowId} step failed`);
    }

    const checkpoint: WorkflowCheckpoint = {
      workflow_id: workflowId,
      step_id: step.id,
      step_index: index,
      status: 'completed',
      input_hash: step.input_hash,
      created_at: new Date().toISOString(),
    };
    saveCheckpoint(storage, workflowId, checkpoint);
  }

  updateWorkflowState(storage, workflowId, 'completed');
}

/**
 * 清理孤儿实体
 */
export async function cleanupOrphanedEntities(
  storage: StorageOperations,
  workflowId: string
): Promise<void> {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 1. 标记 workflow 关联实体为 orphaned
  storage.markEntitiesOrphaned(workflowId, now);

  // 2. 清理超过 24 小时的 orphaned 实体
  storage.cleanupOrphanedEntities(cutoff);
}

/**
 * 兼容旧接口：基于 record 恢复 workflow
 */
export async function recoverWorkflow(
  storage: StorageOperations,
  record: WorkflowStateRecord
): Promise<RecoveryResult> {
  try {
    await resumeFromCheckpoint(storage, record.id);
    return { success: true, recovered: true };
  } catch (error) {
    return {
      success: false,
      recovered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
