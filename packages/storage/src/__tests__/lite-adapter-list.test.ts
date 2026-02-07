import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SQLiteStore } from '../sqlite-store.js';
import { InMemoryGraph } from '../in-memory-graph.js';
import { GraphQueryCache } from '../graph-query-cache.js';
import { list } from '../lite-adapter/crud-read.js';
import type { AdapterContext } from '../lite-adapter/types.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'store-tests');
const DB_PATH = join(TMP_ROOT, `lite-adapter-list-${Date.now()}.db`);

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
  db.exec('DELETE FROM entity_versions;');
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
}

function insertEntity(params: {
  uuid: string;
  id: string;
  rootId?: string;
  type?: string;
  versions: string[];
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const rootId = params.rootId ?? 'alpha';
  const type = params.type ?? 'system';
  const data = { id: params.id, name: params.id };

  db.prepare(`
    INSERT INTO entities (uuid, root_id, id, type, kind, scope, perspective, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(params.uuid, rootId, params.id, type, null, null, null, JSON.stringify(data));

  db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(params.uuid, null, null, 'published', 'hash', now, now, null, null);

  const insertVersion = db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`);
  for (const v of params.versions) {
    insertVersion.run(params.uuid, v);
  }
}

describe('LiteAdapter list', () => {
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

  test('list filters by root_id and type', async () => {
    insertEntity({ uuid: 'u1', id: 'svc-a', rootId: 'alpha', type: 'system', versions: ['0.0.0'] });
    insertEntity({ uuid: 'u2', id: 'svc-b', rootId: 'beta', type: 'system', versions: ['0.0.0'] });
    insertEntity({ uuid: 'u3', id: 'comp-a', rootId: 'alpha', type: 'component', versions: ['0.0.0'] });

    const ctx = createContext();
    const items = await list(ctx, { root_id: 'alpha', type: 'system' });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('svc-a');
  });

  test('list filters by version', async () => {
    insertEntity({ uuid: 'u1', id: 'svc-a', versions: ['0.0.0'] });
    insertEntity({ uuid: 'u2', id: 'svc-a', versions: ['1.0.0'] });

    const ctx = createContext();
    const items = await list(ctx, { root_id: 'alpha', id: 'svc-a', version: '1.0.0' });
    expect(items).toHaveLength(1);
    expect(items[0].uuid).toBe('u2');
  });
});
