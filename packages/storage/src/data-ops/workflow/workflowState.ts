import { SQLiteStore } from '../../sqlite-store.js';
import type {
  Workflow,
  WorkflowContextData,
  WorkflowState,
  WorkflowStateRecord,
  WorkflowStep,
  WorkflowStepSnapshot,
} from './types.js';

const workflowRegistry = new Map<string, WorkflowStep[]>();

function getDatabase(): ReturnType<SQLiteStore['getDatabase']> {
  return SQLiteStore.getInstance().getDatabase();
}

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

function upsertWorkflowState(record: WorkflowStateRecord): void {
  const db = getDatabase();
  db.prepare(
    `
      INSERT INTO workflow_states (
        id, workflow_type, current_step, total_steps, state, context_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_type = excluded.workflow_type,
        current_step = excluded.current_step,
        total_steps = excluded.total_steps,
        state = excluded.state,
        context_json = excluded.context_json,
        updated_at = excluded.updated_at
    `
  ).run(
    record.id,
    record.workflow_type,
    record.current_step,
    record.total_steps,
    record.state,
    record.context_json ?? null,
    record.created_at,
    record.updated_at
  );
}

function markWorkflowEntitiesOrphaned(workflowId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `
      UPDATE entities
      SET orphaned = 1, orphaned_at = ?
      WHERE proposal_id = ? AND orphaned = 0
    `
  ).run(now, workflowId);
}

export function createWorkflow(workflowId: string, steps: WorkflowStep[]): Workflow {
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

  upsertWorkflowState(record);

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

export function getWorkflowState(workflowId: string): WorkflowState {
  const db = getDatabase();
  const record = db
    .prepare(
      `
        SELECT state FROM workflow_states WHERE id = ?
      `
    )
    .get(workflowId) as { state: WorkflowState } | undefined;
  return record?.state ?? 'pending';
}

export function updateWorkflowState(workflowId: string, state: WorkflowState): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      `
        SELECT id, workflow_type, current_step, total_steps, state, context_json, created_at, updated_at
        FROM workflow_states WHERE id = ?
      `
    )
    .get(workflowId) as WorkflowStateRecord | undefined;

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
    upsertWorkflowState(record);
  } else {
    db.prepare(
      `
        UPDATE workflow_states
        SET state = ?, updated_at = ?
        WHERE id = ?
      `
    ).run(state, now, workflowId);
  }

  if (state === 'failed') {
    markWorkflowEntitiesOrphaned(workflowId);
  }
}

export function getRegisteredWorkflowSteps(workflowId: string): WorkflowStep[] | null {
  return workflowRegistry.get(workflowId) ?? null;
}
