import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SQLiteStore } from '../../../sqlite-store.js';
import { createStorageOperationsFromDatabase } from '../../../lite-adapter/dataOpsContext.js';
import { copyOnWrite } from '../resolver.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'data-ops-reference-tests');
const DB_PATH = join(TMP_ROOT, `copy-on-write-${Date.now()}.db`);

let store: SQLiteStore;

function resetStoreInstance(): void {
  const storeClass = SQLiteStore as unknown as { instance: SQLiteStore | null };
  storeClass.instance = null;
  store = undefined as unknown as SQLiteStore;
}

function resetDb(): void {
  const db = store.getDatabase();
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entity_versions;');
  db.exec('DELETE FROM entities;');
}

function insertMainEntity(params: { id: string; rootId?: string; sourceRepo?: string }): { uuid: string } {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const uuid = randomUUID();
  db.prepare(
    `
      INSERT INTO entities (
        uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id
      ) VALUES (?, ?, ?, 'system', NULL, 'project', NULL, ?, NULL, NULL)
    `
  ).run(uuid, params.rootId ?? 'alpha', params.id, JSON.stringify({ id: params.id, type: 'system' }));
  db.prepare(
    `
      INSERT INTO metadata (
        entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, NULL, 'published', 'hash-1', ?, ?, 'alice', 'alice')
    `
  ).run(uuid, params.sourceRepo ?? 'company/backend', now, now);
  db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(uuid, '0.0.0');
  return { uuid };
}

function insertFeatEntity(params: { featId: string; status?: string }): { uuid: string } {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const uuid = randomUUID();
  db.prepare(
    `
      INSERT INTO entities (
        uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id
      ) VALUES (?, '', ?, 'feat', NULL, NULL, NULL, ?, NULL, NULL)
    `
  ).run(uuid, params.featId, JSON.stringify({ id: params.featId, type: 'feat' }));
  db.prepare(
    `
      INSERT INTO metadata (
        entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
      ) VALUES (?, NULL, NULL, ?, NULL, ?, ?, 'alice', 'alice')
    `
  ).run(uuid, params.status ?? 'draft', now, now);
  db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(uuid, '0.0.0');
  return { uuid };
}

describe('copyOnWrite', () => {
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

  test('copies main entity to feat branch', () => {
    const db = store.getDatabase();
    const storage = createStorageOperationsFromDatabase(db);
    insertMainEntity({ id: 'svc', rootId: 'alpha', sourceRepo: 'company/backend' });
    const { uuid: featUuid } = insertFeatEntity({ featId: 'feat-1' });

    const copied = copyOnWrite(storage, 'svc', 'feat-1');

    expect(copied.requirement_id).toBe(featUuid);
    expect(copied.root_id).toBe('alpha');
    expect(copied.metadata.source_repo).toBe('company/backend');
    expect(copied.metadata.status).toBe('draft');

    const rows = db
      .prepare(`SELECT requirement_id FROM entities WHERE id = ? ORDER BY requirement_id`)
      .all('svc') as Array<{ requirement_id: string | null }>;
    expect(rows.length).toBe(2);
    expect(rows.map(r => r.requirement_id ?? '')).toContain('');
    expect(rows.map(r => r.requirement_id ?? '')).toContain(featUuid);
  });

  test('returns existing feat copy when already present', () => {
    const db = store.getDatabase();
    const storage = createStorageOperationsFromDatabase(db);
    const { uuid: featUuid } = insertFeatEntity({ featId: 'feat-1' });
    const dbUuid = randomUUID();
    db.prepare(
      `
        INSERT INTO entities (
          uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id
        ) VALUES (?, 'alpha', 'svc', 'system', NULL, 'project', NULL, ?, ?, NULL)
      `
    ).run(dbUuid, JSON.stringify({ id: 'svc', type: 'system' }), featUuid);
    db.prepare(
      `
        INSERT INTO metadata (
          entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
        ) VALUES (?, 'company/backend', NULL, 'draft', 'hash-1', ?, ?, 'alice', 'alice')
      `
    ).run(dbUuid, new Date().toISOString(), new Date().toISOString());
    db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(dbUuid, '0.0.0');

    const copied = copyOnWrite(storage, 'svc', 'feat-1');
    expect(copied.requirement_id).toBe(featUuid);

    const rows = db
      .prepare(`SELECT COUNT(1) as count FROM entities WHERE id = ? AND requirement_id = ?`)
      .get('svc', featUuid) as { count: number };
    expect(rows.count).toBe(1);
  });
});
