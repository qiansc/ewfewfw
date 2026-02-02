import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SQLiteStore } from '../../../sqlite-store.js';
import { createStorageOperationsFromDatabase } from '../../../lite-adapter/dataOpsContext.js';
import { createWorkflow, getWorkflowState } from '../workflowState.js';
import { cleanupOrphanedEntities, resumeFromCheckpoint, saveCheckpoint } from '../recovery.js';
import { resetStepResultCache } from '../stepExecutor.js';
import type { WorkflowStep } from '../types.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'workflow-recovery-tests');
const DB_PATH = join(TMP_ROOT, `workflow-recovery-${Date.now()}.db`);

let store: SQLiteStore;

function resetStoreInstance(): void {
  const storeClass = SQLiteStore as unknown as { instance: SQLiteStore | null };
  storeClass.instance = null;
  store = undefined as unknown as SQLiteStore;
}

function resetDb(): void {
  const db = store.getDatabase();
  db.exec('DELETE FROM workflow_states;');
  db.exec('DELETE FROM relations;');
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
  db.exec('DELETE FROM feats;');
}

function insertEntity(params: {
  id: string;
  proposalId: string;
  orphaned?: number;
  orphanedAt?: string | null;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO entities (id, source_project, proposal_id, type, data, orphaned, orphaned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    params.id,
    'alpha',
    params.proposalId,
    'system',
    JSON.stringify({ id: params.id }),
    params.orphaned ?? 0,
    params.orphanedAt ?? null
  );

  db.prepare(
    `
      INSERT INTO metadata (
        entity_id, source_project, proposal_id, source_repo, external_url,
        status, content_hash, created_at, updated_at, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    params.id,
    'alpha',
    params.proposalId,
    null,
    null,
    'draft',
    'hash',
    now,
    now,
    null,
    null
  );
}

describe('workflow recovery', () => {
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
    resetStepResultCache();
  });

  test('resumeFromCheckpoint continues from last completed step', async () => {
    const storage = createStorageOperationsFromDatabase(store.getDatabase());
    const executed: string[] = [];
    const steps: WorkflowStep[] = [
      {
        id: 'step-1',
        status: 'pending',
        execute: async () => {
          executed.push('step-1');
          return { success: true };
        },
      },
      {
        id: 'step-2',
        status: 'pending',
        execute: async () => {
          executed.push('step-2');
          return { success: true };
        },
      },
      {
        id: 'step-3',
        status: 'pending',
        execute: async () => {
          executed.push('step-3');
          return { success: true };
        },
      },
    ];

    createWorkflow(storage, 'wf-resume', steps);
    saveCheckpoint(storage, 'wf-resume', {
      workflow_id: 'wf-resume',
      step_id: 'step-1',
      step_index: 0,
      status: 'completed',
      created_at: new Date().toISOString(),
    });

    await resumeFromCheckpoint(storage, 'wf-resume');

    expect(executed).toEqual(['step-2', 'step-3']);
    expect(getWorkflowState(storage, 'wf-resume')).toBe('completed');
  });

  test('cleanupOrphanedEntities marks workflow entities and deletes stale orphans', async () => {
    const storage = createStorageOperationsFromDatabase(store.getDatabase());
    insertEntity({ id: 'entity-active', proposalId: 'wf-clean' });

    const oldTimestamp = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    insertEntity({ id: 'entity-old', proposalId: 'wf-old', orphaned: 1, orphanedAt: oldTimestamp });

    await cleanupOrphanedEntities(storage, 'wf-clean');

    const db = store.getDatabase();
    const marked = db
      .prepare(
        `
          SELECT orphaned, orphaned_at FROM entities WHERE id = ?
        `
      )
      .get('entity-active') as { orphaned: number; orphaned_at: string | null } | undefined;
    expect(marked?.orphaned).toBe(1);
    expect(marked?.orphaned_at).toBeTruthy();

    const removed = db
      .prepare(
        `
          SELECT id FROM entities WHERE id = ?
        `
      )
      .get('entity-old') as { id: string } | undefined | null;
    expect(removed).toBeFalsy();

    const metadata = db
      .prepare(
        `
          SELECT entity_id FROM metadata WHERE entity_id = ?
        `
      )
      .get('entity-old') as { entity_id: string } | undefined | null;
    expect(metadata).toBeFalsy();
  });
});
