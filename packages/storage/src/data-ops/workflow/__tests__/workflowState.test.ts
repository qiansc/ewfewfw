import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SQLiteStore } from '../../../sqlite-store.js';
import { createWorkflow, getWorkflowState, updateWorkflowState } from '../workflowState.js';
import type { WorkflowStep } from '../types.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'workflow-state-tests');
const DB_PATH = join(TMP_ROOT, `workflow-state-${Date.now()}.db`);

let store: SQLiteStore;

function resetDb(): void {
  const db = store.getDatabase();
  db.exec('DELETE FROM workflow_states;');
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
}

describe('workflowState', () => {
  beforeAll(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
    store = SQLiteStore.getInstance({ dbPath: DB_PATH });
  });

  afterAll(() => {
    // Avoid closing the shared SQLiteStore singleton here to prevent test interference.
  });

  beforeEach(() => {
    resetDb();
  });

  test('createWorkflow persists workflow state', () => {
    const steps: WorkflowStep[] = [
      { id: 'step-1', status: 'pending', metadata: { workflow: '/c4a:know:learn' } },
      { id: 'step-2', status: 'pending' },
    ];

    const workflow = createWorkflow('wf-1', steps);
    expect(workflow.state).toBe('pending');
    expect(workflow.total_steps).toBe(2);

    const db = store.getDatabase();
    const record = db
      .prepare(
        `
          SELECT workflow_type, total_steps, state, context_json
          FROM workflow_states WHERE id = ?
        `
      )
      .get('wf-1') as
      | { workflow_type: string; total_steps: number; state: string; context_json: string }
      | undefined;

    expect(record).toBeTruthy();
    expect(record?.workflow_type).toBe('/c4a:know:learn');
    expect(record?.total_steps).toBe(2);
    expect(record?.state).toBe('pending');
    expect(getWorkflowState('wf-1')).toBe('pending');
  });

  test('updateWorkflowState persists changes', () => {
    const steps: WorkflowStep[] = [{ id: 'step-1', status: 'pending' }];
    createWorkflow('wf-2', steps);

    updateWorkflowState('wf-2', 'running');

    const db = store.getDatabase();
    const record = db
      .prepare(
        `
          SELECT state FROM workflow_states WHERE id = ?
        `
      )
      .get('wf-2') as { state: string } | undefined;

    expect(record?.state).toBe('running');
  });

  test('updateWorkflowState marks entities orphaned on failure', () => {
    const db = store.getDatabase();
    db.prepare(
      `
        INSERT INTO entities (id, source_project, proposal_id, type, data, orphaned)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run('entity-1', 'alpha', 'wf-3', 'system', JSON.stringify({ id: 'entity-1' }), 0);

    updateWorkflowState('wf-3', 'failed');

    const entity = db
      .prepare(
        `
          SELECT orphaned FROM entities WHERE proposal_id = ?
        `
      )
      .get('wf-3') as { orphaned: number } | undefined;
    expect(entity?.orphaned).toBe(1);
  });
});
