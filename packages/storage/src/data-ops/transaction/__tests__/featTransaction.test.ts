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
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
  db.exec('DELETE FROM feats;');
}

function insertFeat(featId: string, status: string = 'approved'): void {
  const now = new Date().toISOString();
  const db = store.getDatabase();
  db.prepare(`
    INSERT INTO feats (id, status, title, description, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(featId, status, featId, '', 'tester', now, now);
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
  data?: Record<string, unknown>;
  contentHash?: string;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const sourceProject = params.sourceProject ?? 'alpha';
  const data = params.data ?? { id: params.id };
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

    insertFeat('feat-1');
    insertFeatEntity({ id: 'sys-1', featId: 'feat-1', sourceProject: 'alpha' });
    insertFeatEntity({ id: 'svc-1', featId: 'feat-1', sourceProject: 'beta' });

    const tx = beginFeatTransaction(dataOpsCtx, 'feat-1');
    expect(tx.status).toBe('pending');
    expect(tx.feat_ids).toEqual(['feat-1']);
    expect(tx.project_ids.sort()).toEqual(['alpha', 'beta']);
  });

  test('commitFeatTransaction publishes feat and merges entities', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    insertFeat('feat-2', 'approved');
    insertMainEntity({ id: 'svc-1', sourceProject: 'alpha' });
    insertFeatEntity({ id: 'svc-1', featId: 'feat-2', sourceProject: 'alpha' });
    insertFeatEntity({ id: 'sys-2', featId: 'feat-2', sourceProject: 'beta' });

    const tx = beginFeatTransaction(dataOpsCtx, 'feat-2');
    await commitFeatTransaction(dataOpsCtx, tx);

    const db = store.getDatabase();
    const feat = db.prepare(`SELECT status FROM feats WHERE id = ?`).get('feat-2') as
      | { status: string }
      | undefined;
    expect(feat?.status).toBe('published');

    const remainingFeat = db.prepare(`
      SELECT COUNT(1) as count FROM entities WHERE proposal_id = ?
    `).get('feat-2') as { count: number } | undefined;
    expect(remainingFeat?.count).toBe(0);

    const mainEntityAlpha = db.prepare(`
      SELECT proposal_id FROM entities
      WHERE id = ? AND source_project = ? AND (proposal_id IS NULL OR proposal_id = '')
    `).get('svc-1', 'alpha') as { proposal_id: string | null } | undefined;
    expect(mainEntityAlpha).toBeTruthy();

    const mainEntityBeta = db.prepare(`
      SELECT proposal_id FROM entities
      WHERE id = ? AND source_project = ? AND (proposal_id IS NULL OR proposal_id = '')
    `).get('sys-2', 'beta') as { proposal_id: string | null } | undefined;
    expect(mainEntityBeta).toBeTruthy();
    expect(tx.status).toBe('committed');
  });

  test('rollbackFeatTransaction keeps feat entities untouched', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    insertFeat('feat-3', 'approved');
    insertFeatEntity({ id: 'svc-3', featId: 'feat-3', sourceProject: 'alpha' });

    const tx = beginFeatTransaction(dataOpsCtx, 'feat-3');
    await rollbackFeatTransaction(dataOpsCtx, tx);

    const db = store.getDatabase();
    const remainingFeat = db.prepare(`
      SELECT COUNT(1) as count FROM entities WHERE proposal_id = ?
    `).get('feat-3') as { count: number } | undefined;
    expect(remainingFeat?.count).toBe(1);

    const feat = db.prepare(`SELECT status FROM feats WHERE id = ?`).get('feat-3') as
      | { status: string }
      | undefined;
    expect(feat?.status).toBe('approved');
    expect(tx.status).toBe('rolled_back');
  });
});
