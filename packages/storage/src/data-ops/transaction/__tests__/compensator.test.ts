import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SQLiteStore } from '../../../sqlite-store.js';
import { InMemoryGraph } from '../../../in-memory-graph.js';
import { GraphQueryCache } from '../../../graph-query-cache.js';
import { createDataOpsContext } from '../../../lite-adapter/dataOpsContext.js';
import type { AdapterContext } from '../../../lite-adapter/types.js';
import { createCompensator } from '../compensator.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'data-ops-compensator-tests');
const DB_PATH = join(TMP_ROOT, `data-ops-comp-${randomUUID()}.db`);

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
}

describe('compensator', () => {
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

  test('recordCompensation persists log', () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    const compensator = createCompensator(dataOpsCtx, 'tx-1');
    compensator.recordCompensation('create_entity', 'delete_entity', {
      entity_id: 'svc-1',
    });

    const db = store.getDatabase();
    const row = db.prepare(`
      SELECT transaction_id, action, rollback_action, params_json, executed
      FROM compensation_logs WHERE transaction_id = ?
    `).get('tx-1') as
      | {
          transaction_id: string;
          action: string;
          rollback_action: string;
          params_json: string | null;
          executed: number;
        }
      | undefined;

    expect(row?.transaction_id).toBe('tx-1');
    expect(row?.action).toBe('create_entity');
    expect(row?.rollback_action).toBe('delete_entity');
    expect(row?.executed).toBe(0);
    expect(row?.params_json).toContain('svc-1');
  });

  test('executeCompensation runs rollback handlers in reverse order', async () => {
    const ctx = createContext();
    const dataOpsCtx = createDataOpsContext(ctx);

    const compensator = createCompensator(dataOpsCtx, 'tx-2');
    const first = compensator.recordCompensation('create_entity', 'delete_entity', {
      entity_id: 'svc-1',
    });
    const second = compensator.recordCompensation('link_relation', 'remove_relation', {
      relation_id: 'rel-1',
    });

    const db = store.getDatabase();
    db.prepare(`UPDATE compensation_logs SET created_at = ? WHERE id = ?`).run(
      '2026-01-01T00:00:00.000Z',
      first.id
    );
    db.prepare(`UPDATE compensation_logs SET created_at = ? WHERE id = ?`).run(
      '2026-01-02T00:00:00.000Z',
      second.id
    );

    const calls: string[] = [];
    await compensator.executeCompensation({
      delete_entity: (params) => {
        calls.push(`delete:${params?.entity_id as string}`);
      },
      remove_relation: (params) => {
        calls.push(`remove:${params?.relation_id as string}`);
      },
    });

    expect(calls).toEqual(['remove:rel-1', 'delete:svc-1']);

    const remaining = db.prepare(`
      SELECT COUNT(1) as count FROM compensation_logs
      WHERE transaction_id = ? AND executed = 0
    `).get('tx-2') as { count: number } | undefined;
    expect(remaining?.count).toBe(0);

    await compensator.executeCompensation({
      delete_entity: () => {
        calls.push('unexpected');
      },
    });
    expect(calls).toEqual(['remove:rel-1', 'delete:svc-1']);
  });
});
