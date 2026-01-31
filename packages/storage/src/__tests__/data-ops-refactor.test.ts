import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SQLiteStore } from '../sqlite-store.js';
import { InMemoryGraph } from '../in-memory-graph.js';
import { GraphQueryCache } from '../graph-query-cache.js';
import { featLifecycle } from '../data-ops/feat/lifecycle.js';
import { detectFeatConflicts } from '../data-ops/feat/merge.js';
import { sync, planSync } from '../data-ops/sync/syncEngine.js';
import { updateWorkflowStep } from '../data-ops/workflow/updateWorkflowStep.js';
import { createDataOpsContext } from '../lite-adapter/dataOpsContext.js';
import type { AdapterContext } from '../lite-adapter/types.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'data-ops-tests');
const DB_PATH = join(TMP_ROOT, `data-ops-${Date.now()}.db`);

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
  db.exec('DELETE FROM feat_history;');
  db.exec('DELETE FROM relations;');
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
  db.exec('DELETE FROM feats;');
}

function insertFeatEntity(params: {
  id: string;
  featId: string;
  sourceProject?: string;
  data?: Record<string, unknown>;
  contentHash?: string;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const sourceProject = params.sourceProject ?? 'alpha';
  const data = params.data ?? { id: params.id };
  const contentHash = params.contentHash ?? 'hash';

  db.prepare(`
    INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(params.id, sourceProject, params.featId, 'system', null, null, null, JSON.stringify(data));

  db.prepare(`
    INSERT INTO metadata (
      entity_id, source_project, proposal_id, source_repo, external_url,
      status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    sourceProject,
    params.featId,
    null,
    null,
    'draft',
    contentHash,
    now,
    now,
    null,
    null
  );
}

function insertMainEntity(params: {
  id: string;
  sourceProject?: string;
  type?: string;
  data?: Record<string, unknown>;
  contentHash?: string;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const sourceProject = params.sourceProject ?? 'alpha';
  const type = params.type ?? 'system';
  const data = params.data ?? { id: params.id };
  const contentHash = params.contentHash ?? 'hash-main';

  db.prepare(`
    INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
    VALUES (?, ?, '', ?, ?, ?, ?, ?)
  `).run(params.id, sourceProject, type, null, null, null, JSON.stringify(data));

  db.prepare(`
    INSERT INTO metadata (
      entity_id, source_project, proposal_id, source_repo, external_url,
      status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    sourceProject,
    null,
    null,
    'published',
    contentHash,
    now,
    now,
    null,
    null
  );
}

describe('Data Ops refactor', () => {
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

  test('featLifecycle publishes feat and merges entities to main branch', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    await featLifecycle(dataOpsCtx, {
      action: 'create',
      feat_id: 'feat-1',
      metadata: {
        title: 'feat-1',
        description: '',
        created_by: 'tester',
      },
    });

    insertFeatEntity({ id: 'sys-1', featId: 'feat-1' });

    const approved = await featLifecycle(dataOpsCtx, {
      action: 'transition',
      feat_id: 'feat-1',
      to_status: 'approved',
    });
    expect(approved.success).toBe(true);

    const published = await featLifecycle(dataOpsCtx, {
      action: 'transition',
      feat_id: 'feat-1',
      to_status: 'published',
      force_publish: true,
      metadata: {
        title: 'feat-1',
        description: '',
        created_by: 'tester',
      },
    });

    expect(published.success).toBe(true);

    const db = store.getDatabase();
    const feat = db.prepare(`SELECT status FROM feats WHERE id = ?`).get('feat-1') as
      | { status: string }
      | undefined;
    expect(feat?.status).toBe('published');

    const mainEntity = db.prepare(`
      SELECT proposal_id FROM entities WHERE id = ? AND (proposal_id IS NULL OR proposal_id = '')
    `).get('sys-1') as { proposal_id: string | null } | undefined;
    expect(mainEntity).toBeTruthy();

    const history = db.prepare(`
      SELECT COUNT(1) as count FROM feat_history WHERE feat_id = ?
    `).get('feat-1') as { count: number } | undefined;
    expect(history?.count).toBe(1);
  });

  test('detectFeatConflicts reports modified entities', () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    insertMainEntity({
      id: 'svc-1',
      data: { id: 'svc-1', name: 'main' },
      contentHash: 'hash-main',
    });
    insertFeatEntity({
      id: 'svc-1',
      featId: 'feat-2',
      data: { id: 'svc-1', name: 'feat' },
      contentHash: 'hash-feat',
    });

    const conflicts = detectFeatConflicts(dataOpsCtx.storage, 'feat-2');
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]?.entity_id).toBe('svc-1');
    expect(conflicts[0]?.conflict_type).toBe('both_modified');
  });

  test('updateWorkflowStep updates status and metadata', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    await featLifecycle(dataOpsCtx, {
      action: 'create',
      feat_id: 'feat-wf',
      metadata: {
        title: 'feat-wf',
        description: '',
        created_by: 'tester',
      },
    });

    const db = store.getDatabase();
    const originalUpdatedAt = '2026-01-01T00:00:00.000Z';
    const workflowSteps = [{ id: 'step-1', status: 'pending' }];
    db.prepare(`
      UPDATE feats SET workflow_steps = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(workflowSteps), originalUpdatedAt, 'feat-wf');

    const result = await updateWorkflowStep(dataOpsCtx, {
      feat_id: 'feat-wf',
      step_id: 'step-1',
      status: 'completed',
      metadata: { done: true },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.updated_at).not.toBe(originalUpdatedAt);

    const row = db.prepare(`SELECT workflow_steps FROM feats WHERE id = ?`).get('feat-wf') as
      | { workflow_steps: string | null }
      | undefined;
    const parsed = row?.workflow_steps ? JSON.parse(row.workflow_steps) : [];
    expect(parsed[0]?.status).toBe('completed');
  });

  test('updateWorkflowStep returns step_not_found when missing', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    await featLifecycle(dataOpsCtx, {
      action: 'create',
      feat_id: 'feat-miss',
      metadata: {
        title: 'feat-miss',
        description: '',
        created_by: 'tester',
      },
    });

    const db = store.getDatabase();
    const workflowSteps = [{ id: 'step-1', status: 'pending' }];
    db.prepare(`
      UPDATE feats SET workflow_steps = ? WHERE id = ?
    `).run(JSON.stringify(workflowSteps), 'feat-miss');

    const result = await updateWorkflowStep(dataOpsCtx, {
      feat_id: 'feat-miss',
      step_id: 'step-2',
      status: 'completed',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('step_not_found');
  });

  test('sync import inserts entities via storage operations', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);
    const basePath = join(TMP_ROOT, 'import');
    mkdirSync(join(basePath, 'systems'), { recursive: true });

    const filePath = join(basePath, 'systems', 'sys-import.yaml');
    writeFileSync(
      filePath,
      ['id: sys-import', 'type: system', 'name: Import Target'].join('\n'),
      'utf-8'
    );

    const result = await sync(dataOpsCtx, { direction: 'import', path: basePath });
    expect(result.success).toBe(true);
    expect(result.stats.created).toBe(1);

    const db = store.getDatabase();
    const row = db.prepare(`
      SELECT e.id FROM entities e
      WHERE e.id = ? AND (e.proposal_id IS NULL OR e.proposal_id = '')
    `).get('sys-import') as { id: string } | undefined;
    expect(row?.id).toBe('sys-import');
  });

  test('sync export respects conflict_policy=warn', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);
    const basePath = join(TMP_ROOT, 'export');
    mkdirSync(join(basePath, 'systems'), { recursive: true });

    insertMainEntity({
      id: 'sys-export',
      data: { id: 'sys-export', name: 'export' },
      contentHash: 'hash-export',
    });

    const filePath = join(basePath, 'systems', 'sys-export.yaml');
    writeFileSync(filePath, ['id: sys-export', 'type: system', 'name: old'].join('\n'), 'utf-8');

    const result = await sync(dataOpsCtx, {
      direction: 'export',
      path: basePath,
      conflict_policy: 'warn',
    });

    expect(result.stats.conflicted).toBe(1);
    expect(result.stats.created).toBe(0);
  });

  test('planSync covers upload/download/delete/conflict cases', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);
    const now = new Date().toISOString();

    insertMainEntity({ id: 'remote-only', contentHash: 'hash-remote-only' });
    insertMainEntity({ id: 'remote-deleted-local', contentHash: 'hash-remote-del' });
    insertMainEntity({ id: 'both-modified', contentHash: 'hash-remote' });

    const localManifest = {
      files: [
        {
          path: 'systems/local-only.yaml',
          entity_id: 'local-only',
          type: 'system',
          content_hash: 'hash-local-only',
          updated_at: now,
        },
        {
          path: 'systems/local-deleted-remote.yaml',
          entity_id: 'local-deleted-remote',
          type: 'system',
          content_hash: 'hash-local-del',
          updated_at: now,
        },
        {
          path: 'systems/both-modified.yaml',
          entity_id: 'both-modified',
          type: 'system',
          content_hash: 'hash-local',
          updated_at: now,
        },
      ],
    };

    const snapshot = {
      synced_at: now,
      entities: {
        'local-deleted-remote': { content_hash: 'hash-old' },
        'remote-deleted-local': { content_hash: 'hash-remote-del' },
        'both-modified': { content_hash: 'hash-base' },
      },
    };

    const result = await planSync(dataOpsCtx, {
      local_manifest: localManifest,
      snapshot,
      options: { status_filter: 'published' },
    });

    const uploadIds = result.plan.to_upload.map((item) => item.entity_id);
    const downloadIds = result.plan.to_download.map((item) => item.entity_id);
    const deleteLocalIds = result.plan.to_delete_local.map((item) => item.entity_id);
    const deleteRemoteIds = result.plan.to_delete_remote.map((item) => item.entity_id);
    const conflictIds = result.plan.conflicts.map((item) => item.entity_id);

    expect(uploadIds).toContain('local-only');
    expect(downloadIds).toContain('remote-only');
    expect(deleteLocalIds).toContain('local-deleted-remote');
    expect(deleteRemoteIds).toContain('remote-deleted-local');
    expect(conflictIds).toContain('both-modified');
  });
});
