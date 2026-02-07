import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { SQLiteStore } from '../../../sqlite-store.js';
import { InMemoryGraph } from '../../../in-memory-graph.js';
import { GraphQueryCache } from '../../../graph-query-cache.js';
import { createDataOpsContext } from '../../../lite-adapter/dataOpsContext.js';
import { computeContentHash } from '../../../utils/contentHash.js';
import { sync } from '../syncEngine.js';
import type { AdapterContext } from '../../../lite-adapter/types.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'data-ops-sync-tests');
const DB_PATH = join(TMP_ROOT, `data-ops-sync-${Date.now()}.db`);
const FILES_ROOT = join(TMP_ROOT, 'files');

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

function computeHash(data: Record<string, unknown>): string {
  return computeContentHash(data);
}

function insertMainEntity(params: {
  ctx: ReturnType<typeof createDataOpsContext>;
  data: Record<string, unknown>;
  updatedAt: string;
}): void {
  const contentHash = computeHash(params.data);
  const id = params.data.id as string;
  const type = params.data.type as 'system';
  params.ctx.storage.insertEntity({
    entityId: id,
    rootId: params.ctx.config.defaultProject,
    entityType: type,
    data: params.data,
    contentHash,
    createdAt: params.updatedAt,
    updatedAt: params.updatedAt,
  });
}

describe('Data Ops sync engine (new)', () => {
  beforeAll(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
    mkdirSync(FILES_ROOT, { recursive: true });
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
    rmSync(FILES_ROOT, { recursive: true, force: true });
    mkdirSync(FILES_ROOT, { recursive: true });
  });

  test('bidirectional sync reports conflict when db/file content diverge', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    const projectRoot = join(FILES_ROOT, 'bidirectional');
    const filePath = join(
      projectRoot,
      '.context',
      'technical',
      'systems',
      'sys-bidir.c4a.yaml'
    );
    mkdirSync(dirname(filePath), { recursive: true });

    const fileData = {
      id: 'sys-bidir',
      type: 'system',
      name: 'from-file',
    };
    writeFileSync(
      filePath,
      ['id: sys-bidir', 'type: system', 'name: from-file'].join('\n'),
      'utf-8'
    );

    const fileTime = new Date('2026-01-02T00:00:00Z');
    utimesSync(filePath, fileTime, fileTime);

    insertMainEntity({
      ctx: dataOpsCtx,
      data: { id: 'sys-bidir', type: 'system', name: 'from-db' },
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const result = await sync(dataOpsCtx, {
      direction: 'bidirectional',
      path: projectRoot,
      mode: 'incremental',
      format: 'yaml',
    });

    expect(result.success).toBe(false);
    expect(result.stats.conflicted).toBe(1);

    const row = store
      .getDatabase()
      .prepare(
        `SELECT data FROM entities WHERE id = ? AND (requirement_id IS NULL OR requirement_id = '')`
      )
      .get('sys-bidir') as { data: string } | undefined;
    const parsed = row ? (JSON.parse(row.data) as { name?: string }) : {};
    expect(parsed.name).toBe('from-db');
  });

  test('incremental db-to-file skips when hashes match', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    const projectRoot = join(FILES_ROOT, 'incremental');
    const filePath = join(
      projectRoot,
      '.context',
      'technical',
      'systems',
      'sys-skip.c4a.yaml'
    );
    mkdirSync(dirname(filePath), { recursive: true });

    writeFileSync(
      filePath,
      ['id: sys-skip', 'type: system', 'name: same'].join('\n'),
      'utf-8'
    );

    const fileTime = new Date('2026-01-02T00:00:00Z');
    utimesSync(filePath, fileTime, fileTime);

    insertMainEntity({
      ctx: dataOpsCtx,
      data: { id: 'sys-skip', type: 'system', name: 'same' },
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const result = await sync(dataOpsCtx, {
      direction: 'db-to-file',
      path: projectRoot,
      mode: 'incremental',
      format: 'yaml',
    });

    expect(result.success).toBe(true);
    expect(result.stats.skipped).toBe(1);
    expect(result.stats.updated).toBe(0);
  });
});
