import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SQLiteStore } from '../../../sqlite-store.js';
import { InMemoryGraph } from '../../../in-memory-graph.js';
import { GraphQueryCache } from '../../../graph-query-cache.js';
import { createDataOpsContext } from '../../../lite-adapter/dataOpsContext.js';
import type { AdapterContext } from '../../../lite-adapter/types.js';
import { beginFeatTransaction, commitFeatTransaction } from '../featTransaction.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'data-ops-cross-project-tests');
const DB_PATH = join(TMP_ROOT, `data-ops-cross-${randomUUID()}.db`);

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

function insertFeat(featId: string): void {
  const now = new Date().toISOString();
  const db = store.getDatabase();
  db.prepare(`
    INSERT INTO feats (id, status, title, description, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(featId, 'approved', featId, '', 'tester', now, now);
}

function insertFeatEntity(params: {
  id: string;
  featId: string;
  sourceProject: string;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    params.sourceProject,
    params.featId,
    'system',
    null,
    null,
    null,
    JSON.stringify({ id: params.id })
  );

  db.prepare(`
    INSERT INTO metadata (
      entity_id, source_project, proposal_id, source_repo, external_url,
      status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    params.sourceProject,
    params.featId,
    null,
    null,
    'draft',
    `hash-${params.id}`,
    now,
    now,
    null,
    null
  );
}

describe('cross project feat', () => {
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

  test('commit merges entities across multiple projects', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    insertFeat('feat-cross');
    insertFeatEntity({ id: 'svc-1', featId: 'feat-cross', sourceProject: 'alpha' });
    insertFeatEntity({ id: 'svc-2', featId: 'feat-cross', sourceProject: 'beta' });

    const tx = beginFeatTransaction(dataOpsCtx, 'feat-cross');
    await commitFeatTransaction(dataOpsCtx, tx);

    const db = store.getDatabase();
    const alphaMain = db.prepare(`
      SELECT proposal_id FROM entities
      WHERE id = ? AND source_project = ? AND (proposal_id IS NULL OR proposal_id = '')
    `).get('svc-1', 'alpha') as { proposal_id: string | null } | undefined;

    const betaMain = db.prepare(`
      SELECT proposal_id FROM entities
      WHERE id = ? AND source_project = ? AND (proposal_id IS NULL OR proposal_id = '')
    `).get('svc-2', 'beta') as { proposal_id: string | null } | undefined;

    expect(alphaMain).toBeTruthy();
    expect(betaMain).toBeTruthy();

    const remainingFeat = db.prepare(`
      SELECT COUNT(1) as count FROM entities WHERE proposal_id = ?
    `).get('feat-cross') as { count: number } | undefined;
    expect(remainingFeat?.count).toBe(0);
  });
});
