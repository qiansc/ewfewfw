import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SQLiteStore } from '../sqlite-store.js';
import { InMemoryGraph } from '../in-memory-graph.js';
import { GraphQueryCache } from '../graph-query-cache.js';
import { saveRelations } from '../lite-adapter/relations.js';
import { expandEntityCacheKeys, toEntityCacheKey } from '../lite-adapter/cache-keys.js';
import type { AdapterContext } from '../lite-adapter/types.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'store-tests');
const DB_PATH = join(TMP_ROOT, `lite-adapter-relations-${Date.now()}.db`);

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
  db.exec('DELETE FROM relations;');
}

function insertRelation(params: {
  id: string;
  proposalId?: string | null;
  fromProject?: string | null;
  fromId: string;
  toProject?: string | null;
  toId: string;
  relType?: string;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const proposalId = params.proposalId ?? '';
  const fromProject = params.fromProject ?? '';
  const toProject = params.toProject ?? '';
  const relType = params.relType ?? 'DEPENDS_ON';

  db.prepare(`
    INSERT INTO relations (
      id, proposal_id, from_project, from_id, to_project, to_id,
      rel_type, status, properties, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    proposalId,
    fromProject,
    params.fromId,
    toProject,
    params.toId,
    relType,
    'active',
    null,
    now,
    now
  );
}

describe('LiteAdapter relations save', () => {
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

  test('saveRelations handles global source_project and invalidates cache', () => {
    insertRelation({
      id: 'rel-1',
      fromProject: null,
      fromId: 'global-system',
      toProject: 'alpha',
      toId: 'svc',
    });

    const ctx = createContext();
    ctx.graph.addRelation(null, 'global-system', 'alpha', 'svc', 'DEPENDS_ON');

    const cacheKey = `deps:${toEntityCacheKey(null, 'global-system')}:downstream:1:`;
    ctx.cache.set(cacheKey, [{ id: 'svc' }], expandEntityCacheKeys(null, 'global-system'));
    expect(ctx.cache.get(cacheKey)).not.toBeNull();

    saveRelations(ctx, null, 'global-system', null, []);

    const db = store.getDatabase();
    const remaining = db.prepare(`
      SELECT COUNT(*) as count FROM relations
      WHERE from_project = ? AND from_id = ?
    `).get('', 'global-system') as { count: number };
    expect(remaining.count).toBe(0);
    expect(ctx.cache.get(cacheKey)).toBeNull();
  });
});
