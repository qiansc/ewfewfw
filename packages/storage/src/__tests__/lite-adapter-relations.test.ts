// @ts-nocheck
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entity_versions;');
  db.exec('DELETE FROM entities;');
}

function insertEntity(params: { id: string; rootId?: string }): { uuid: string } {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const uuid = randomUUID();
  db.prepare(`
    INSERT INTO entities (uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id)
    VALUES (?, ?, ?, 'system', NULL, NULL, NULL, ?, NULL, NULL)
  `).run(uuid, params.rootId ?? 'alpha', params.id, JSON.stringify({ id: params.id }));
  db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, NULL, NULL, 'published', 'hash', ?, ?, NULL, NULL)
  `).run(uuid, now, now);
  db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(uuid, '0.0.0');
  return { uuid };
}

function insertRelation(params: {
  id: string;
  fromRootId?: string | null;
  fromId: string;
  toRootId?: string | null;
  toId: string;
  fromUuid: string;
  toUuid?: string | null;
  relType?: string;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const fromRootId = params.fromRootId ?? '';
  const toRootId = params.toRootId ?? '';
  const relType = params.relType ?? 'DEPENDS_ON';

  db.prepare(`
    INSERT INTO relations (
      id, from_uuid, to_uuid, from_root_id, from_id, to_root_id, to_id,
      rel_type, status, properties, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    params.fromUuid,
    params.toUuid ?? null,
    fromRootId,
    params.fromId,
    toRootId,
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

  test('saveRelations handles global root_id and invalidates cache', () => {
    const { uuid: fromUuid } = insertEntity({ id: 'global-system', rootId: '' });
    insertRelation({
      id: 'rel-1',
      fromRootId: null,
      fromId: 'global-system',
      toRootId: 'alpha',
      toId: 'svc',
      fromUuid,
    });

    const ctx = createContext();
    ctx.graph.addRelation(null, 'global-system', 'alpha', 'svc', 'DEPENDS_ON');

    const cacheKey = `deps:${toEntityCacheKey(null, 'global-system')}:downstream:1:`;
    ctx.cache.set(cacheKey, [{ id: 'svc' }], expandEntityCacheKeys(null, 'global-system'));
    expect(ctx.cache.get(cacheKey)).not.toBeNull();

    saveRelations(ctx, null, 'global-system', fromUuid, []);

    const db = store.getDatabase();
    const remaining = db.prepare(`
      SELECT COUNT(*) as count FROM relations
      WHERE from_root_id = ? AND from_id = ?
    `).get('', 'global-system') as { count: number };
    expect(remaining.count).toBe(0);
    expect(ctx.cache.get(cacheKey)).toBeNull();
  });
});
