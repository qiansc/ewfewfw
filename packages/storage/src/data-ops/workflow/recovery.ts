import { SQLiteStore } from '../../sqlite-store.js';
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

function getDatabase(): ReturnType<SQLiteStore['getDatabase']> {
  return SQLiteStore.getInstance().getDatabase();
}

function readWorkflowRecord(workflowId: string): WorkflowStateRecord | null {
  const db = getDatabase();
  const record = db
    .prepare(
      `
        SELECT id, workflow_type, current_step, total_steps, state, context_json, created_at, updated_at
        FROM workflow_states WHERE id = ?
      `
    )
    .get(workflowId) as WorkflowStateRecord | undefined;
  return record ?? null;
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
  workflowId: string,
  record: WorkflowStateRecord | null,
  context: WorkflowContextData,
  currentStep: number
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  if (!record) {
    db.prepare(
      `
        INSERT INTO workflow_states (
          id, workflow_type, current_step, total_steps, state, context_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      workflowId,
      workflowId,
      currentStep,
      context.steps.length,
      'running',
      JSON.stringify(context),
      now,
      now
    );
    return;
  }

  db.prepare(
    `
      UPDATE workflow_states
      SET current_step = ?, context_json = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(currentStep, JSON.stringify(context), now, workflowId);
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
export function saveCheckpoint(workflowId: string, checkpoint: WorkflowCheckpoint): void {
  const record = readWorkflowRecord(workflowId);
  const context = parseContext(record);
  context.checkpoint = checkpoint;

  if (context.steps[checkpoint.step_index]) {
    context.steps[checkpoint.step_index] = {
      ...context.steps[checkpoint.step_index],
      status: 'completed',
      input_hash: checkpoint.input_hash ?? context.steps[checkpoint.step_index].input_hash,
    };
  }

  persistContext(workflowId, record, context, checkpoint.step_index + 1);
}

/**
 * 从 checkpoint 恢复
 */
export async function resumeFromCheckpoint(workflowId: string): Promise<void> {
  const record = readWorkflowRecord(workflowId);
  if (!record) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  const context = parseContext(record);
  const registered = getRegisteredWorkflowSteps(workflowId);
  const steps = mergeSteps(context.steps, registered);
  const startIndex = context.checkpoint?.step_index ?? -1;

  updateWorkflowState(workflowId, 'running');

  for (let index = startIndex + 1; index < steps.length; index += 1) {
    const step = steps[index];
    const result = await executeStep(step);
    if (!result.success) {
      updateWorkflowState(workflowId, 'failed');
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
    saveCheckpoint(workflowId, checkpoint);
  }

  updateWorkflowState(workflowId, 'completed');
}

/**
 * 清理孤儿实体
 */
export async function cleanupOrphanedEntities(workflowId: string): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 1. 标记 workflow 关联实体为 orphaned
  db.prepare(
    `
      UPDATE entities
      SET orphaned = 1, orphaned_at = ?
      WHERE proposal_id = ? AND orphaned = 0
    `
  ).run(now, workflowId);

  // 2. 清理超过 24 小时的 orphaned 实体
  const orphanedRows = db
    .prepare(
      `
        SELECT id, source_project, proposal_id
        FROM entities
        WHERE orphaned = 1 AND orphaned_at IS NOT NULL AND orphaned_at <= ?
      `
    )
    .all(cutoff) as Array<{ id: string; source_project: string; proposal_id: string }>;

  for (const row of orphanedRows) {
    db.prepare(
      `
        DELETE FROM metadata
        WHERE entity_id = ? AND source_project = ? AND proposal_id = ?
      `
    ).run(row.id, row.source_project, row.proposal_id);

    db.prepare(
      `
        DELETE FROM relations
        WHERE proposal_id = ? AND (from_id = ? OR to_id = ?)
      `
    ).run(row.proposal_id, row.id, row.id);
  }

  if (orphanedRows.length > 0) {
    db.prepare(
      `
        DELETE FROM entities
        WHERE orphaned = 1 AND orphaned_at IS NOT NULL AND orphaned_at <= ?
      `
    ).run(cutoff);
  }
}

/**
 * 兼容旧接口：基于 record 恢复 workflow
 */
export async function recoverWorkflow(record: WorkflowStateRecord): Promise<RecoveryResult> {
  try {
    await resumeFromCheckpoint(record.id);
    return { success: true, recovered: true };
  } catch (error) {
    return {
      success: false,
      recovered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
