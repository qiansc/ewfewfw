import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { InMemoryGraph } from '../../../in-memory-graph.js';
import { GraphQueryCache } from '../../../graph-query-cache.js';
import { createDataOpsContext } from '../../../lite-adapter/dataOpsContext.js';
import type { AdapterContext } from '../../../lite-adapter/types.js';
import { SQLiteStore } from '../../../sqlite-store.js';
import { getFeatConflicts, resolveConflict } from '../conflictResolver.js';
import type { FeatConflict } from '../../../adapter.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'data-ops-transaction-tests');
const DB_PATH = join(TMP_ROOT, `conflict-${Date.now()}.db`);

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

function insertMainEntity(params: {
  id: string;
  sourceProject?: string;
  data?: Record<string, unknown>;
  contentHash?: string;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const sourceProject = params.sourceProject ?? 'alpha';
  const data = params.data ?? { id: params.id, name: 'main' };
  const contentHash = params.contentHash ?? 'hash-main';

  db.prepare(`
    INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
    VALUES (?, ?, '', ?, ?, ?, ?, ?)
  `).run(params.id, sourceProject, 'system', null, null, null, JSON.stringify(data));

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
  const data = params.data ?? { id: params.id, name: 'feat' };
  const contentHash = params.contentHash ?? 'hash-feat';

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

describe('conflictResolver', () => {
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

  test('getFeatConflicts returns conflict when main and feat diverge', () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    insertMainEntity({ id: 'sys-1', contentHash: 'hash-main' });
    insertFeatEntity({ id: 'sys-1', featId: 'feat-1', contentHash: 'hash-feat' });

    const conflicts = getFeatConflicts(dataOpsCtx, 'feat-1');
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]?.entity_id).toBe('sys-1');
    expect(conflicts[0]?.conflict_type).toBe('both_modified');
  });

  test('resolveConflict produces resolution report', () => {
    const conflict: FeatConflict = {
      entity_id: 'sys-1',
      conflict_type: 'both_modified',
      main_branch: { id: 'sys-1', name: 'main' },
      feat_branch: { id: 'sys-1', name: 'feat' },
      suggested_resolution: 'keep_feat',
    };

    const report = resolveConflict(conflict, 'ours');
    expect(report.action).toBe('keep_feat');
    expect(report.manual_required).toBe(true);
    expect(report.conflict.entity_id).toBe('sys-1');
  });
});
