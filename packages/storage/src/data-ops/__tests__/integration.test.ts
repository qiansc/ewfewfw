import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SQLiteStore } from '../../sqlite-store.js';
import { InMemoryGraph } from '../../in-memory-graph.js';
import { GraphQueryCache } from '../../graph-query-cache.js';
import { createDataOpsContext, createStorageOperationsFromDatabase } from '../../lite-adapter/dataOpsContext.js';
import { computeContentHash } from '../../utils/contentHash.js';
import type { AdapterContext } from '../../lite-adapter/types.js';
import {
  beginFeatTransaction,
  commitFeatTransaction,
  cleanupOrphanedEntities,
  createWorkflow,
  featLifecycle,
  getFeatConflicts,
  getWorkflowState,
  parseReference,
  resolveConflict,
  resolveReference,
  resumeFromCheckpoint,
  saveCheckpoint,
  sync,
} from '../index.js';
import { resetStepResultCache } from '../workflow/stepExecutor.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'data-ops-integration-tests');
const DB_PATH = join(TMP_ROOT, `data-ops-integration-${Date.now()}.db`);
const FILES_ROOT = join(TMP_ROOT, 'files');

let store: SQLiteStore;

function resetStoreInstance(): void {
  const storeClass = SQLiteStore as unknown as { instance: SQLiteStore | null };
  storeClass.instance = null;
  store = undefined as unknown as SQLiteStore;
}

function createContext(): AdapterContext {
  return {
    store,
    graph: new InMemoryGraph(),
    cache: new GraphQueryCache(),
    config: {
      dbPath: DB_PATH,
      defaultProject: 'alpha',
      enableVectorSearch: false,
      repoId: null,
      feat: {
        concurrent_warning: true,
        auto_notify: false,
      },
    },
  };
}

function resetDb(): void {
  const db = store.getDatabase();
  db.exec('DELETE FROM workflow_states;');
  db.exec('DELETE FROM feat_history;');
  db.exec('DELETE FROM relations;');
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
  db.exec('DELETE FROM feats;');
}

function computeHash(data: Record<string, unknown>): string {
  return computeContentHash(data);
}

describe('Data Ops integration', () => {
  beforeAll(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
    mkdirSync(FILES_ROOT, { recursive: true });
    store = SQLiteStore.getInstance({ dbPath: DB_PATH });
  });

  afterAll(() => {
    store.close();
    rmSync(DB_PATH, { force: true });
    rmSync(`${DB_PATH}-wal`, { force: true });
    rmSync(`${DB_PATH}-shm`, { force: true });
    rmSync(FILES_ROOT, { recursive: true, force: true });
    resetStoreInstance();
  });

  beforeEach(() => {
    resetDb();
    rmSync(FILES_ROOT, { recursive: true, force: true });
    mkdirSync(FILES_ROOT, { recursive: true });
    resetStepResultCache();
  });

  test('end-to-end feat + reference + sync + publish', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);
    const featId = 'feat-e2e';

    await featLifecycle(dataOpsCtx, {
      action: 'create',
      feat_id: featId,
      metadata: {
        title: featId,
        description: 'integration test',
        created_by: 'tester',
      },
    });

    const entityData = { id: 'sys-e2e', type: 'system', name: 'E2E' };
    dataOpsCtx.storage.insertEntity({
      entityId: entityData.id,
      sourceProject: ctx.config.defaultProject,
      entityType: 'system',
      data: entityData,
      contentHash: computeHash(entityData),
      proposalId: featId,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const parsed = parseReference(`project:${ctx.config.defaultProject}/${entityData.id}`);
    expect(parsed.format).toBe('project');
    const resolved = resolveReference(`project:${ctx.config.defaultProject}/${entityData.id}`, {
      projectId: ctx.config.defaultProject,
      repoId: ctx.config.repoId,
    });
    expect(resolved.resolved).toBe(true);
    expect(resolved.id).toBe(entityData.id);

    const projectRoot = join(FILES_ROOT, 'e2e');
    mkdirSync(projectRoot, { recursive: true });
    const syncResult = await sync(dataOpsCtx, {
      direction: 'db-to-file',
      path: projectRoot,
      mode: 'full',
      format: 'yaml',
      feat_id: featId,
    });
    expect(syncResult.success).toBe(true);

    const expectedPath = join(
      projectRoot,
      '.context',
      'feat',
      featId,
      'technical',
      'systems',
      `${entityData.id}.c4a.yaml`
    );
    expect(existsSync(expectedPath)).toBe(true);

    await featLifecycle(dataOpsCtx, {
      action: 'transition',
      feat_id: featId,
      to_status: 'approved',
    });
    const published = await featLifecycle(dataOpsCtx, {
      action: 'transition',
      feat_id: featId,
      to_status: 'published',
      force_publish: true,
      metadata: {
        title: featId,
        description: '',
        created_by: 'tester',
      },
    });
    expect(published.success).toBe(true);

    const row = store
      .getDatabase()
      .prepare(
        `SELECT proposal_id FROM entities WHERE id = ? AND (proposal_id IS NULL OR proposal_id = '')`
      )
      .get(entityData.id) as { proposal_id: string | null } | undefined;
    expect(row).toBeTruthy();
  });

  test('cross-project feat transaction merges entities', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);
    const now = new Date().toISOString();

    dataOpsCtx.storage.createFeat({
      id: 'feat-cross',
      status: 'approved',
      title: 'feat-cross',
      description: '',
      created_by: 'tester',
      created_at: now,
      updated_at: now,
    });

    dataOpsCtx.storage.insertEntity({
      entityId: 'svc-1',
      sourceProject: 'alpha',
      entityType: 'system',
      data: { id: 'svc-1', type: 'system' },
      contentHash: computeHash({ id: 'svc-1', type: 'system' }),
      proposalId: 'feat-cross',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    });

    dataOpsCtx.storage.insertEntity({
      entityId: 'svc-2',
      sourceProject: 'beta',
      entityType: 'system',
      data: { id: 'svc-2', type: 'system' },
      contentHash: computeHash({ id: 'svc-2', type: 'system' }),
      proposalId: 'feat-cross',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    });

    const tx = beginFeatTransaction(dataOpsCtx, 'feat-cross');
    await commitFeatTransaction(dataOpsCtx, tx);

    const db = store.getDatabase();
    const alphaMain = db
      .prepare(
        `SELECT proposal_id FROM entities WHERE id = ? AND source_project = ? AND (proposal_id IS NULL OR proposal_id = '')`
      )
      .get('svc-1', 'alpha') as { proposal_id: string | null } | undefined;
    const betaMain = db
      .prepare(
        `SELECT proposal_id FROM entities WHERE id = ? AND source_project = ? AND (proposal_id IS NULL OR proposal_id = '')`
      )
      .get('svc-2', 'beta') as { proposal_id: string | null } | undefined;
    expect(alphaMain).toBeTruthy();
    expect(betaMain).toBeTruthy();
  });

  test('conflict detection + resolution report', () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);
    const now = new Date().toISOString();

    dataOpsCtx.storage.insertEntity({
      entityId: 'svc-conflict',
      sourceProject: 'alpha',
      entityType: 'system',
      data: { id: 'svc-conflict', type: 'system', name: 'main' },
      contentHash: computeHash({ id: 'svc-conflict', name: 'main' }),
      status: 'published',
      createdAt: now,
      updatedAt: now,
    });

    dataOpsCtx.storage.insertEntity({
      entityId: 'svc-conflict',
      sourceProject: 'alpha',
      entityType: 'system',
      data: { id: 'svc-conflict', type: 'system', name: 'feat' },
      contentHash: computeHash({ id: 'svc-conflict', name: 'feat' }),
      proposalId: 'feat-conflict',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    });

    const conflicts = getFeatConflicts(dataOpsCtx, 'feat-conflict');
    expect(conflicts.length).toBe(1);

    const resolution = resolveConflict(conflicts[0]!, 'ours');
    expect(resolution.action).toBe('keep_feat');
    expect(resolution.manual_required).toBe(true);
  });

  test('workflow recovery resumes from checkpoint and cleans orphaned entities', async () => {
    const workflowId = `wf-${randomUUID()}`;
    const executed: string[] = [];
    const storage = createStorageOperationsFromDatabase(store.getDatabase());

    createWorkflow(storage, workflowId, [
      {
        id: 'step-1',
        title: 'step-1',
        metadata: { workflow: 'integration' },
        execute: async () => {
          executed.push('step-1');
          return { success: true };
        },
      },
      {
        id: 'step-2',
        title: 'step-2',
        execute: async () => {
          executed.push('step-2');
          return { success: true };
        },
      },
      {
        id: 'step-3',
        title: 'step-3',
        execute: async () => {
          executed.push('step-3');
          return { success: true };
        },
      },
    ]);

    saveCheckpoint(storage, workflowId, {
      workflow_id: workflowId,
      step_id: 'step-1',
      step_index: 0,
      status: 'completed',
      input_hash: 'hash-step-1',
      created_at: new Date().toISOString(),
    });

    await resumeFromCheckpoint(storage, workflowId);
    expect(executed).toEqual(['step-2', 'step-3']);
    expect(getWorkflowState(storage, workflowId)).toBe('completed');

    const db = store.getDatabase();
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `
        INSERT INTO entities (
          id, source_project, proposal_id, type, kind, scope, perspective, data, orphaned, orphaned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      'orphan-1',
      'alpha',
      workflowId,
      'system',
      null,
      null,
      null,
      JSON.stringify({ id: 'orphan-1', type: 'system' }),
      1,
      oldTime
    );

    db.prepare(
      `
        INSERT INTO metadata (
          entity_id, source_project, proposal_id, source_repo, external_url,
          status, content_hash, created_at, updated_at, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      'orphan-1',
      'alpha',
      workflowId,
      null,
      null,
      'draft',
      'hash-orphan',
      oldTime,
      oldTime,
      null,
      null
    );

    await cleanupOrphanedEntities(storage, workflowId);

    const orphan = db
      .prepare(`SELECT id FROM entities WHERE id = ? AND proposal_id = ?`)
      .get('orphan-1', workflowId) as { id: string } | undefined | null;
    expect(orphan).toBeFalsy();
  });
});
