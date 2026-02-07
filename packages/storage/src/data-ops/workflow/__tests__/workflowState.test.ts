import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SQLiteStore } from '../../../sqlite-store.js';
import { createStorageOperationsFromDatabase } from '../../../lite-adapter/dataOpsContext.js';
import { createWorkflow, getWorkflowState, updateWorkflowState } from '../workflowState.js';
import type { WorkflowStep } from '../types.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'workflow-state-tests');
const DB_PATH = join(TMP_ROOT, `workflow-state-${Date.now()}.db`);

let store: SQLiteStore;

function resetStoreInstance(): void {
  const storeClass = SQLiteStore as unknown as { instance: SQLiteStore | null };
  storeClass.instance = null;
  store = undefined as unknown as SQLiteStore;
}

function resetDb(): void {
  const db = store.getDatabase();
  db.exec('DELETE FROM workflow_states;');
  db.exec('DELETE FROM entity_versions;');
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
}

describe('workflowState', () => {
  beforeAll(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
    store = SQLiteStore.getInstance({ dbPath: DB_PATH });
  });

  afterAll(() => {
    store.close();
    rmSync(DB_PATH, { force: true });
    rmSync(`${DB_PATH}-wal`, { force: true });
    rmSync(`${DB_PATH}-shm`, { force: true });
    resetStoreInstance();
  });

  beforeEach(() => {
    resetDb();
  });

  test('createWorkflow persists workflow state', () => {
    const steps: WorkflowStep[] = [
      { id: 'step-1', status: 'pending', metadata: { workflow: '/c4a:know:learn' } },
      { id: 'step-2', status: 'pending' },
    ];

    const storage = createStorageOperationsFromDatabase(store.getDatabase());
    const workflow = createWorkflow(storage, 'wf-1', steps);
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
    expect(getWorkflowState(storage, 'wf-1')).toBe('pending');
  });

  test('updateWorkflowState persists changes', () => {
    const steps: WorkflowStep[] = [{ id: 'step-1', status: 'pending' }];
    const storage = createStorageOperationsFromDatabase(store.getDatabase());
    createWorkflow(storage, 'wf-2', steps);

    updateWorkflowState(storage, 'wf-2', 'running');

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
    const storage = createStorageOperationsFromDatabase(db);
    const now = new Date().toISOString();
    const uuid = randomUUID();
    db.prepare(
      `
        INSERT INTO entities (
          uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id, orphaned, orphaned_at
        )
        VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?, NULL)
      `
    ).run(
      uuid,
      'alpha',
      'entity-1',
      'system',
      JSON.stringify({ id: 'entity-1' }),
      'wf-3',
      0
    );
    db.prepare(
      `
        INSERT INTO metadata (
          entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
        )
        VALUES (?, NULL, NULL, 'draft', 'hash-entity-1', ?, ?, NULL, NULL)
      `
    ).run(uuid, now, now);
    db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, '0.0.0')`).run(uuid);

    updateWorkflowState(storage, 'wf-3', 'failed');

    const entity = db
      .prepare(
        `
          SELECT orphaned FROM entities WHERE requirement_id = ?
        `
      )
      .get('wf-3') as { orphaned: number } | undefined;
    expect(entity?.orphaned).toBe(1);
  });
});
