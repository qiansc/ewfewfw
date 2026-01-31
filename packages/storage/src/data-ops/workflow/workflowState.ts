import type { StorageOperations } from '../types.js';
import type {
  Workflow,
  WorkflowContextData,
  WorkflowState,
  WorkflowStateRecord,
  WorkflowStep,
  WorkflowStepSnapshot,
} from './types.js';

const workflowRegistry = new Map<string, WorkflowStep[]>();

function normalizeSteps(steps: WorkflowStep[]): {
  steps: WorkflowStep[];
  snapshots: WorkflowStepSnapshot[];
} {
  const normalized = steps.map((step) => ({
    ...step,
    status: step.status ?? 'pending',
  }));
  const snapshots = normalized.map((step) => ({
    id: step.id,
    type: step.type,
    title: step.title,
    status: step.status,
    metadata: step.metadata,
    input_hash: step.input_hash,
  }));
  return { steps: normalized, snapshots };
}

function resolveWorkflowType(workflowId: string, steps: WorkflowStep[]): string {
  for (const step of steps) {
    const workflowType = step.metadata?.workflow;
    if (typeof workflowType === 'string' && workflowType.length > 0) {
      return workflowType;
    }
  }
  return workflowId;
}

function buildContext(steps: WorkflowStepSnapshot[]): WorkflowContextData {
  return { steps, checkpoint: null };
}

export function createWorkflow(
  storage: StorageOperations,
  workflowId: string,
  steps: WorkflowStep[]
): Workflow {
  const now = new Date().toISOString();
  const { steps: normalizedSteps, snapshots } = normalizeSteps(steps);

  workflowRegistry.set(workflowId, normalizedSteps);

  const workflowType = resolveWorkflowType(workflowId, normalizedSteps);
  const context = buildContext(snapshots);
  const record: WorkflowStateRecord = {
    id: workflowId,
    workflow_type: workflowType,
    current_step: 0,
    total_steps: normalizedSteps.length,
    state: 'pending',
    context_json: JSON.stringify(context),
    created_at: now,
    updated_at: now,
  };

  storage.upsertWorkflowState(record);

  return {
    id: workflowId,
    workflow_type: workflowType,
    steps: snapshots,
    state: 'pending',
    current_step: 0,
    total_steps: normalizedSteps.length,
    context,
    created_at: now,
    updated_at: now,
  };
}

export function getWorkflowState(storage: StorageOperations, workflowId: string): WorkflowState {
  const record = storage.getWorkflowStateRecord(workflowId);
  return record?.state ?? 'pending';
}

export function updateWorkflowState(
  storage: StorageOperations,
  workflowId: string,
  state: WorkflowState
): void {
  const now = new Date().toISOString();
  const existing = storage.getWorkflowStateRecord(workflowId);

  if (!existing) {
    const record: WorkflowStateRecord = {
      id: workflowId,
      workflow_type: workflowId,
      current_step: 0,
      total_steps: 0,
      state,
      context_json: null,
      created_at: now,
      updated_at: now,
    };
    storage.upsertWorkflowState(record);
  } else {
    storage.upsertWorkflowState({
      ...existing,
      state,
      updated_at: now,
    });
  }

  if (state === 'failed') {
    storage.markEntitiesOrphaned(workflowId, now);
  }
}

export function getRegisteredWorkflowSteps(workflowId: string): WorkflowStep[] | null {
  return workflowRegistry.get(workflowId) ?? null;
}
