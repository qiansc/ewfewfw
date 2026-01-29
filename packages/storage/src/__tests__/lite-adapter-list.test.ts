import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SQLiteStore } from '../sqlite-store.js';
import { InMemoryGraph } from '../in-memory-graph.js';
import { GraphQueryCache } from '../graph-query-cache.js';
import { list } from '../lite-adapter/crud-read.js';
import type { AdapterContext } from '../lite-adapter/types.js';
import type { EntityStatus } from '../adapterCrudTypes.js';

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
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
}

function insertEntity(params: {
  id: string;
  proposalId?: string | null;
  type?: string;
  sourceProject?: string;
  status?: EntityStatus;
  updatedAt?: string;
}): void {
  const db = store.getDatabase();
  const now = params.updatedAt ?? new Date().toISOString();
  const proposalId = params.proposalId ?? '';
  const sourceProject = params.sourceProject ?? 'alpha';
  const type = params.type ?? 'system';
  const status = params.status ?? 'published';

  db.prepare(`
    INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(params.id, sourceProject, proposalId, type, null, null, null, JSON.stringify({ id: params.id }));

  db.prepare(`
    INSERT INTO metadata (
      entity_id, source_project, proposal_id, source_repo, external_url,
      status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    sourceProject,
    proposalId,
    null,
    null,
    status,
    'hash',
    now,
    now,
    null,
    null
  );
}

describe('LiteAdapter list merge view', () => {
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

  test('list uses feat version when proposal_id is provided', async () => {
    insertEntity({ id: 'svc', proposalId: null, updatedAt: '2026-01-01T00:00:00.000Z' });
    insertEntity({ id: 'svc', proposalId: 'feat-1', status: 'draft', updatedAt: '2026-01-02T00:00:00.000Z' });

    const ctx = createContext();
    const result = await list(ctx, { proposal_id: 'feat-1' });

    expect(result.items?.length).toBe(1);
    expect(result.items?.[0].proposal_id).toBe('feat-1');
  });

  test('count_only respects merge view', async () => {
    insertEntity({ id: 'svc', proposalId: null, updatedAt: '2026-01-01T00:00:00.000Z' });
    insertEntity({ id: 'svc', proposalId: 'feat-1', status: 'draft', updatedAt: '2026-01-02T00:00:00.000Z' });

    const ctx = createContext();
    const result = await list(ctx, { proposal_id: 'feat-1', count_only: true });

    expect(result.total).toBe(1);
  });
});
