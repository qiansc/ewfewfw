import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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

function insertFeat(params: { id: string; status?: string }): { uuid: string } {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const uuid = randomUUID();
  db.prepare(`
    INSERT INTO entities (
      uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id
    )
    VALUES (?, '', ?, 'feat', NULL, NULL, NULL, ?, NULL, NULL)
  `).run(uuid, params.id, JSON.stringify({ id: params.id, title: params.id }));
  db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, NULL, NULL, ?, NULL, ?, ?, ?, NULL)
  `).run(uuid, params.status ?? 'draft', now, now, 'tester');
  db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(uuid, '0.0.0');
  return { uuid };
}

function insertChecklist(params: {
  featId: string;
  featUuid: string;
  payload: string;
  updatedAt?: string;
}): void {
  const db = store.getDatabase();
  const now = params.updatedAt ?? new Date().toISOString();
  try {
    JSON.parse(params.payload);
  } catch {
    // Disable FTS triggers to allow malformed JSON payload for regression tests.
    db.exec('DROP TRIGGER IF EXISTS entities_fts_insert;');
    db.exec('DROP TRIGGER IF EXISTS entities_fts_update;');
  }
  const checklistUuid = randomUUID();
  db.prepare(`
    INSERT INTO entities (
      uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id
    )
    VALUES (?, '', ?, 'checklist', NULL, NULL, NULL, ?, ?, NULL)
  `).run(checklistUuid, params.featId, params.payload, params.featUuid);
  db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, NULL, NULL, 'draft', NULL, ?, ?, NULL, NULL)
  `).run(checklistUuid, now, now);
  db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(
    checklistUuid,
    '0.0.0'
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
    db.exec('DELETE FROM entity_versions;');
    db.exec('DELETE FROM metadata;');
    db.exec('DELETE FROM entities;');
  });

  test('returns parse error when checklist is corrupted on get', async () => {
    const { uuid: featUuid } = insertFeat({ id: 'feat-parse-get' });
    insertChecklist({ featId: 'feat-parse-get', featUuid, payload: '{ invalid-json' });
    const ctx = createContext();
    const result = await featChecklist(ctx, { action: 'get', feat_id: 'feat-parse-get' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('CHECKLIST_PARSE_FAILED');
  });

  test('returns parse error when checklist is corrupted on patch', async () => {
    const { uuid: featUuid } = insertFeat({ id: 'feat-parse-patch' });
    insertChecklist({ featId: 'feat-parse-patch', featUuid, payload: '{ invalid-json' });
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
    const { uuid: featUuid } = insertFeat({ id: featId });
    const checklistVersion = new Date().toISOString();
    insertChecklist({
      featId,
      featUuid,
      payload: JSON.stringify({
        version: '1.0',
        metadata: { feat_id: featId, generated_at: checklistVersion, source: 'entities' },
        updated_at: checklistVersion,
        items: [{ id: 'task-001', title: 'Task 1', status: 'pending', type: 'dsl' }],
      }),
      updatedAt: checklistVersion,
    });

    const ctx = createContext();
    const result = await featChecklist(ctx, {
      action: 'patch',
      feat_id: featId,
      expected_version: '2000-01-01T00:00:00.000Z',
      patches: [
        {
          task_id: 'task-001',
          updates: { status: 'completed' },
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('CHECKLIST_CONFLICT');
  });
});
