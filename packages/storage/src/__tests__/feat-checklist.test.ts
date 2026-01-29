import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SQLiteStore } from '../sqlite-store.js';
import { InMemoryGraph } from '../in-memory-graph.js';
import { GraphQueryCache } from '../graph-query-cache.js';
import { featChecklist } from '../lite-adapter/featChecklist.js';
import type { AdapterContext } from '../lite-adapter/types.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'feat-checklist-tests');
const DB_PATH = join(TMP_ROOT, `feat-checklist-${Date.now()}.db`);

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

function insertFeat(params: { id: string; checklist?: string | null }): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO feats (id, status, title, description, created_by, checklist, created_at, updated_at)
    VALUES (?, 'draft', ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    params.id,
    '',
    'tester',
    params.checklist ?? null,
    now,
    now
  );
}

describe('featChecklist', () => {
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
    const db = store.getDatabase();
    db.exec('DELETE FROM feats;');
  });

  test('returns parse error when checklist is corrupted on get', async () => {
    insertFeat({ id: 'feat-parse-get', checklist: '{ invalid-json' });
    const ctx = createContext();
    const result = await featChecklist(ctx, { action: 'get', feat_id: 'feat-parse-get' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('CHECKLIST_PARSE_FAILED');
  });

  test('returns parse error when checklist is corrupted on patch', async () => {
    insertFeat({ id: 'feat-parse-patch', checklist: '{ invalid-json' });
    const ctx = createContext();
    const result = await featChecklist(ctx, {
      action: 'patch',
      feat_id: 'feat-parse-patch',
      patches: [
        {
          task_id: 'task-001',
          updates: { title: 'Task 1', status: 'completed' },
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('CHECKLIST_PARSE_FAILED');
  });

  test('returns conflict when checklist updated concurrently', async () => {
    const featId = 'feat-conflict';
    insertFeat({
      id: featId,
      checklist: JSON.stringify({
        version: '1.0',
        metadata: { feat_id: featId, generated_at: new Date().toISOString(), source: 'entities' },
        updated_at: new Date().toISOString(),
        items: [
          { id: 'task-001', title: 'Task 1', status: 'pending', type: 'dsl' },
        ],
      }),
    });

    const db = store.getDatabase();
    const originalPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes('UPDATE feats SET checklist')) {
        return {
          ...stmt,
          run: (...args: unknown[]) => {
            const newUpdatedAt = new Date(Date.now() + 1000).toISOString();
            originalPrepare('UPDATE feats SET updated_at = ? WHERE id = ?').run(
              newUpdatedAt,
              featId
            );
            return (stmt as { run: (...runArgs: unknown[]) => unknown }).run(...args);
          },
        } as typeof stmt;
      }
      return stmt;
    }) as typeof db.prepare;

    try {
      const ctx = createContext();
      const result = await featChecklist(ctx, {
        action: 'patch',
        feat_id: featId,
        patches: [
          {
            task_id: 'task-001',
            updates: { status: 'completed' },
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('CHECKLIST_CONFLICT');
    } finally {
      db.prepare = originalPrepare;
    }
  });
});
