import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SQLiteStore } from '../../../sqlite-store.js';
import { InMemoryGraph } from '../../../in-memory-graph.js';
import { GraphQueryCache } from '../../../graph-query-cache.js';
import { createDataOpsContext } from '../../../lite-adapter/dataOpsContext.js';
import { exportToFiles } from '../exportEngine.js';
import type { AdapterContext } from '../../../lite-adapter/types.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'data-ops-export-tests');
const DB_PATH = join(TMP_ROOT, `data-ops-export-${Date.now()}.db`);
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
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
  db.exec('DELETE FROM feats;');
}

function computeHash(data: Record<string, unknown>): string {
  const content = JSON.stringify(data, Object.keys(data).sort());
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function insertEntity(params: {
  ctx: ReturnType<typeof createDataOpsContext>;
  data: Record<string, unknown>;
  proposalId?: string | null;
}): void {
  const contentHash = computeHash(params.data);
  const now = new Date().toISOString();
  params.ctx.storage.insertEntity({
    entityId: params.data.id as string,
    sourceProject: params.ctx.config.defaultProject,
    entityType: params.data.type as 'system',
    data: params.data,
    contentHash,
    proposalId: params.proposalId ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

describe('export engine', () => {
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

  test('exports yaml to technical directory', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);
    insertEntity({
      ctx: dataOpsCtx,
      data: { id: 'sys-export', type: 'system', name: 'Export' },
    });

    const projectRoot = join(FILES_ROOT, 'yaml');
    const result = await exportToFiles(dataOpsCtx, {
      path: projectRoot,
      format: 'yaml',
      mode: 'full',
    });

    const expectedPath = join(
      projectRoot,
      '.context',
      'technical',
      'systems',
      'sys-export.c4a.yaml'
    );
    expect(result.success).toBe(true);
    expect(existsSync(expectedPath)).toBe(true);

    const content = readFileSync(expectedPath, 'utf-8');
    expect(content.includes('id: sys-export')).toBe(true);
  });

  test('exports json under feat directory', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);
    insertEntity({
      ctx: dataOpsCtx,
      data: { id: 'sys-feat', type: 'system', name: 'Feat Export' },
      proposalId: 'feat-a001',
    });

    const projectRoot = join(FILES_ROOT, 'feat');
    const result = await exportToFiles(dataOpsCtx, {
      path: projectRoot,
      format: 'json',
      mode: 'full',
      feat_id: 'feat-a001',
    });

    const expectedPath = join(
      projectRoot,
      '.context',
      'feat',
      'feat-a001',
      'technical',
      'systems',
      'sys-feat.c4a.json'
    );
    expect(result.success).toBe(true);
    expect(existsSync(expectedPath)).toBe(true);

    const content = readFileSync(expectedPath, 'utf-8');
    expect(content.includes('"id": "sys-feat"')).toBe(true);
  });
});
