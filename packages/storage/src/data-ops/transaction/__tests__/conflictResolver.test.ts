import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
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
  db.exec('DELETE FROM entity_versions;');
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
}

function insertEntity(params: {
  uuid?: string;
  id: string;
  rootId?: string;
  type?: string;
  requirementId?: string | null;
  status?: string;
  data?: Record<string, unknown>;
  contentHash?: string;
}): string {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const uuid = params.uuid ?? randomUUID();
  const rootId = params.rootId ?? 'alpha';
  const type = params.type ?? 'system';
  const requirementId = params.requirementId ?? null;
  const status = params.status ?? 'published';
  const data = params.data ?? { id: params.id, name: 'entity' };
  const contentHash = params.contentHash ?? 'hash';

  db.prepare(`
    INSERT INTO entities (
      uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id, orphaned, orphaned_at
    )
    VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, 0, NULL)
  `).run(uuid, rootId, params.id, type, JSON.stringify(data), requirementId);

  db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url,
      status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, NULL, NULL, ?, ?, ?, ?, NULL, NULL)
  `).run(
    uuid,
    status,
    contentHash,
    now,
    now
  );

  db.prepare(`
    INSERT INTO entity_versions (entity_uuid, version)
    VALUES (?, '0.0.0')
  `).run(uuid);

  return uuid;
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

    const featUuid = insertEntity({
      id: 'feat-1',
      rootId: '',
      type: 'feat',
      status: 'draft',
      contentHash: 'hash-feat-root',
      data: { id: 'feat-1', title: 'feat-1' },
    });
    insertEntity({
      id: 'sys-1',
      rootId: 'alpha',
      contentHash: 'hash-main',
      data: { id: 'sys-1', name: 'main' },
    });
    insertEntity({
      id: 'sys-1',
      rootId: 'alpha',
      requirementId: featUuid,
      status: 'draft',
      contentHash: 'hash-feat',
      data: { id: 'sys-1', name: 'feat' },
    });

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
