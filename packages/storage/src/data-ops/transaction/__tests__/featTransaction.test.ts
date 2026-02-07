import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SQLiteStore } from '../../../sqlite-store.js';
import { InMemoryGraph } from '../../../in-memory-graph.js';
import { GraphQueryCache } from '../../../graph-query-cache.js';
import { createDataOpsContext } from '../../../lite-adapter/dataOpsContext.js';
import type { AdapterContext } from '../../../lite-adapter/types.js';
import {
  beginFeatTransaction,
  commitFeatTransaction,
  rollbackFeatTransaction,
} from '../featTransaction.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'data-ops-transaction-tests');
const DB_PATH = join(TMP_ROOT, `data-ops-tx-${randomUUID()}.db`);

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
  db.exec('DELETE FROM compensation_logs;');
  db.exec('DELETE FROM feat_history;');
  db.exec('DELETE FROM relations;');
  db.exec('DELETE FROM entity_versions;');
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
}

function insertFeat(featId: string, status: string = 'approved'): string {
  const now = new Date().toISOString();
  const featUuid = randomUUID();
  const db = store.getDatabase();
  db.prepare(`
    INSERT INTO entities (
      uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id, orphaned, orphaned_at
    )
    VALUES (?, '', ?, 'feat', NULL, NULL, NULL, ?, NULL, NULL, 0, NULL)
  `).run(featUuid, featId, JSON.stringify({ id: featId, title: featId, description: '' }));
  db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, NULL, NULL, ?, NULL, ?, ?, 'tester', NULL)
  `).run(featUuid, status, now, now);
  db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, '0.0.0')`).run(featUuid);
  return featUuid;
}

function insertFeatEntity(params: {
  id: string;
  featUuid: string;
  rootId?: string;
  data?: Record<string, unknown>;
  contentHash?: string;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const uuid = randomUUID();
  const rootId = params.rootId ?? 'alpha';
  const data = params.data ?? { id: params.id };
  const contentHash = params.contentHash ?? 'hash';

  db.prepare(`
    INSERT INTO entities (
      uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id, orphaned, orphaned_at
    )
    VALUES (?, ?, ?, 'system', NULL, NULL, NULL, ?, ?, NULL, 0, NULL)
  `).run(uuid, rootId, params.id, JSON.stringify(data), params.featUuid);

  db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url,
      status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, NULL, NULL, 'draft', ?, ?, ?, NULL, NULL)
  `).run(
    uuid,
    contentHash,
    now,
    now
  );
  db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, '0.0.0')`).run(uuid);
}

function insertMainEntity(params: {
  id: string;
  rootId?: string;
  data?: Record<string, unknown>;
  contentHash?: string;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const uuid = randomUUID();
  const rootId = params.rootId ?? 'alpha';
  const data = params.data ?? { id: params.id };
  const contentHash = params.contentHash ?? 'hash-main';

  db.prepare(`
    INSERT INTO entities (
      uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id, orphaned, orphaned_at
    )
    VALUES (?, ?, ?, 'system', NULL, NULL, NULL, ?, NULL, NULL, 0, NULL)
  `).run(uuid, rootId, params.id, JSON.stringify(data));

  db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url,
      status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, NULL, NULL, 'published', ?, ?, ?, NULL, NULL)
  `).run(
    uuid,
    contentHash,
    now,
    now
  );
  db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, '0.0.0')`).run(uuid);
}

describe('featTransaction', () => {
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

  test('beginFeatTransaction collects project ids', () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    const featUuid = insertFeat('feat-1');
    insertFeatEntity({ id: 'sys-1', featUuid, rootId: 'alpha' });
    insertFeatEntity({ id: 'svc-1', featUuid, rootId: 'beta' });

    const tx = beginFeatTransaction(dataOpsCtx, 'feat-1');
    expect(tx.status).toBe('pending');
    expect(tx.feat_ids).toEqual(['feat-1']);
    expect(tx.project_ids.sort()).toEqual(['alpha', 'beta']);
  });

  test('commitFeatTransaction publishes feat', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    const featUuid = insertFeat('feat-2', 'approved');
    insertMainEntity({ id: 'svc-1', rootId: 'alpha' });
    insertFeatEntity({ id: 'svc-1', featUuid, rootId: 'alpha' });
    insertFeatEntity({ id: 'sys-2', featUuid, rootId: 'beta' });

    const tx = beginFeatTransaction(dataOpsCtx, 'feat-2');
    await commitFeatTransaction(dataOpsCtx, tx);

    const db = store.getDatabase();
    const feat = db.prepare(`
      SELECT m.status
      FROM entities e
      JOIN metadata m ON m.entity_uuid = e.uuid
      WHERE e.type = 'feat' AND e.id = ? AND e.root_id = ''
      LIMIT 1
    `).get('feat-2') as
      | { status: string }
      | undefined;
    expect(feat?.status).toBe('published');

    const remainingFeat = db.prepare(`
      SELECT COUNT(1) as count FROM entities WHERE requirement_id = ?
    `).get(featUuid) as { count: number } | undefined;
    expect(remainingFeat?.count).toBe(0);

    const mainEntityAlpha = db.prepare(`
      SELECT requirement_id FROM entities
      WHERE id = ? AND root_id = ? AND (requirement_id IS NULL OR requirement_id = '')
    `).get('svc-1', 'alpha') as { requirement_id: string | null } | undefined;
    expect(mainEntityAlpha).toBeTruthy();

    expect(tx.status).toBe('committed');
  });

  test('rollbackFeatTransaction keeps feat entities untouched', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    const featUuid = insertFeat('feat-3', 'approved');
    insertFeatEntity({ id: 'svc-3', featUuid, rootId: 'alpha' });

    const tx = beginFeatTransaction(dataOpsCtx, 'feat-3');
    await rollbackFeatTransaction(dataOpsCtx, tx);

    const db = store.getDatabase();
    const remainingFeat = db.prepare(`
      SELECT COUNT(1) as count FROM entities WHERE requirement_id = ?
    `).get(featUuid) as { count: number } | undefined;
    expect(remainingFeat?.count).toBe(1);

    const feat = db.prepare(`
      SELECT m.status
      FROM entities e
      JOIN metadata m ON m.entity_uuid = e.uuid
      WHERE e.type = 'feat' AND e.id = ? AND e.root_id = ''
      LIMIT 1
    `).get('feat-3') as
      | { status: string }
      | undefined;
    expect(feat?.status).toBe('approved');
    expect(tx.status).toBe('rolled_back');
  });
});
