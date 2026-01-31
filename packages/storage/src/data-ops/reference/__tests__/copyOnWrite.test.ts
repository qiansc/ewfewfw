import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
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
  db.exec('DELETE FROM entities;');
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
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('svc', 'alpha', '', 'system', null, 'project', null, JSON.stringify({ id: 'svc', type: 'system' }));

    db.prepare(`
      INSERT INTO metadata (
        entity_id, source_project, proposal_id, source_repo, external_url,
        status, content_hash, created_at, updated_at, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'svc',
      'alpha',
      '',
      'company/backend',
      null,
      'published',
      'hash-1',
      now,
      now,
      'alice',
      'alice'
    );

    const copied = copyOnWrite(storage, 'svc', 'feat-1');

    expect(copied.proposal_id).toBe('feat-1');
    expect(copied.metadata.source_project).toBe('alpha');
    expect(copied.metadata.source_repo).toBe('company/backend');
    expect(copied.metadata.status).toBe('draft');

    const rows = db
      .prepare(`SELECT proposal_id FROM entities WHERE id = ? ORDER BY proposal_id`)
      .all('svc') as Array<{ proposal_id: string }>;
    expect(rows.length).toBe(2);
    expect(rows.map(r => r.proposal_id)).toContain('');
    expect(rows.map(r => r.proposal_id)).toContain('feat-1');
  });

  test('returns existing feat copy when already present', () => {
    const db = store.getDatabase();
    const storage = createStorageOperationsFromDatabase(db);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('svc', 'alpha', 'feat-1', 'system', null, 'project', null, JSON.stringify({ id: 'svc', type: 'system' }));

    db.prepare(`
      INSERT INTO metadata (
        entity_id, source_project, proposal_id, source_repo, external_url,
        status, content_hash, created_at, updated_at, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'svc',
      'alpha',
      'feat-1',
      'company/backend',
      null,
      'draft',
      'hash-1',
      now,
      now,
      'alice',
      'alice'
    );

    const copied = copyOnWrite(storage, 'svc', 'feat-1');
    expect(copied.proposal_id).toBe('feat-1');

    const rows = db
      .prepare(`SELECT COUNT(1) as count FROM entities WHERE id = ? AND proposal_id = ?`)
      .get('svc', 'feat-1') as { count: number };
    expect(rows.count).toBe(1);
  });
});
