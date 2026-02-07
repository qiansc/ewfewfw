import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { InMemoryGraph } from '../../../in-memory-graph.js';
import { GraphQueryCache } from '../../../graph-query-cache.js';
import { createDataOpsContext } from '../../../lite-adapter/dataOpsContext.js';
import type { AdapterContext } from '../../../lite-adapter/types.js';
import { SQLiteStore } from '../../../sqlite-store.js';
import { createRollbackFeat, executeRollback } from '../rollback.js';
import type { Entity } from '../../../adapter.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'data-ops-transaction-tests');
const DB_PATH = join(TMP_ROOT, `rollback-${Date.now()}.db`);

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

describe('rollback', () => {
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

  test('createRollbackFeat creates a rollback feat record', () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);
    const now = new Date().toISOString();

    dataOpsCtx.storage.createFeat({
      id: 'feat-1',
      status: 'published',
      title: 'feat-1',
      description: 'target feat',
      created_by: 'tester',
      created_at: now,
      updated_at: now,
    });

    const rollback = createRollbackFeat(dataOpsCtx, 'feat-1', 'rollback reason');
    const row = store.getDatabase().prepare(`
      SELECT e.id, m.status, e.data
      FROM entities e
      JOIN metadata m ON m.entity_uuid = e.uuid
      WHERE e.type = 'feat' AND e.id = ? AND e.root_id = ''
      LIMIT 1
    `).get(rollback.id) as { id: string; status: string; data: string } | undefined;

    const data = row?.data ? (JSON.parse(row.data) as { description?: string }) : null;

    expect(row?.id).toBe(rollback.id);
    expect(row?.status).toBe('draft');
    expect(data?.description).toContain('rollback reason');
  });

  test('executeRollback restores latest snapshot into rollback feat', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);
    const now = new Date().toISOString();

    dataOpsCtx.storage.createFeat({
      id: 'feat-2',
      status: 'published',
      title: 'feat-2',
      description: 'target feat',
      created_by: 'tester',
      created_at: now,
      updated_at: now,
    });

    const snapshot: Entity[] = [
      {
        uuid: 'snapshot-sys-1',
        root_id: 'alpha',
        id: 'sys-1',
        type: 'system',
        data: { id: 'sys-1', name: 'system' },
        requirement_id: undefined,
        versions: ['0.0.0'],
        metadata: {
          status: 'published',
          content_hash: 'hash-1',
          created_at: now,
          updated_at: now,
        },
      },
    ];

    dataOpsCtx.storage.insertFeatHistory({
      featId: 'feat-2',
      publishedAt: now,
      publishedBy: 'tester',
      snapshot,
    });

    const rollback = createRollbackFeat(dataOpsCtx, 'feat-2', 'rollback issue');
    await executeRollback(dataOpsCtx, rollback.id);
    const rollbackFeat = dataOpsCtx.storage.getFeat(rollback.id);
    const rollbackFeatUuid = rollbackFeat?.uuid;
    expect(rollbackFeatUuid).toBeString();
    if (!rollbackFeatUuid) {
      throw new Error('rollback feat uuid not found');
    }

    const row = store.getDatabase().prepare(`
      SELECT requirement_id
      FROM entities
      WHERE id = ? AND requirement_id = ?
      LIMIT 1
    `).get('sys-1', rollbackFeatUuid) as { requirement_id: string } | undefined;

    expect(row?.requirement_id).toBe(rollbackFeatUuid);
  });
});
