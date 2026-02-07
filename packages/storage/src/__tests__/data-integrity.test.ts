/**
 * 数据完整性校验/修复测试
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SQLiteStore } from '../sqlite-store.js';
import { DataValidator } from '../validate.js';
import { DataRepair } from '../repair.js';

type InsertParams = {
  id: string;
  type?: string;
  scope?: string | null;
  rootId?: string;
  sourceRepo?: string | null;
  externalUrl?: string | null;
  data?: Record<string, unknown>;
};

const TMP_ROOT = join(process.cwd(), '.tmp', 'store-tests');
const DB_PATH = join(TMP_ROOT, `data-integrity-${Date.now()}.db`);

let store: SQLiteStore;

function resetStoreInstance(): void {
  const storeClass = SQLiteStore as unknown as { instance: SQLiteStore | null };
  storeClass.instance = null;
  store = undefined as unknown as SQLiteStore;
}

function resetDb() {
  const db = store.getDatabase();
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entity_versions;');
  db.exec('DELETE FROM entities;');
}

function insertEntity(params: InsertParams) {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const id = params.id;
  const type = params.type ?? 'system';
  const scope = params.scope ?? null;
  const rootId = params.rootId ?? 'my-project';
  const data = params.data ?? {};
  const uuid = randomUUID();

  db.prepare(`
    INSERT INTO entities (uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `).run(uuid, rootId, id, type, null, scope, null, JSON.stringify(data));

  db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url,
      status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuid,
    params.sourceRepo ?? null,
    params.externalUrl ?? null,
    'published',
    'hash',
    now,
    now,
    null,
    null
  );

  db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(uuid, '0.0.0');
}

describe('DataValidator', () => {
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

  test('uses metadata external_url for external entities', () => {
    insertEntity({
      id: 'ext-1',
      type: 'system',
      rootId: '',
      sourceRepo: null,
      externalUrl: 'https://example.com',
      data: { external: true },
    });

    const validator = new DataValidator(store);
    const result = validator.validate();

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('warns on external entities missing external_url', () => {
    insertEntity({
      id: 'ext-2',
      type: 'system',
      rootId: '',
      sourceRepo: null,
      externalUrl: null,
      data: { external: true },
    });

    const validator = new DataValidator(store);
    const result = validator.validate();

    expect(result.warnings.map(item => item.code)).toContain('C4A-MIGRATE-008');
  });

  test('warns on non-project scopes with root_id/source_repo', () => {
    insertEntity({
      id: 'domain-1',
      type: 'system',
      scope: 'domain',
      rootId: '@acme/project-x',
      sourceRepo: 'owner/repo',
      data: { name: 'domain' },
    });

    const validator = new DataValidator(store);
    const result = validator.validate();

    const warningCodes = result.warnings.map(item => item.code);
    expect(warningCodes).toContain('C4A-MIGRATE-005');
    expect(warningCodes).toContain('C4A-MIGRATE-006');
  });

  test('errors on missing root_id/source_repo', () => {
    insertEntity({
      id: 'proj-1',
      type: 'system',
      rootId: '',
      sourceRepo: null,
      data: { name: 'project' },
    });

    const validator = new DataValidator(store);
    const result = validator.validate();

    const errorCodes = result.errors.map(item => item.code);
    expect(errorCodes).toContain('C4A-MIGRATE-001');
    expect(errorCodes).toContain('C4A-MIGRATE-002');
  });

  test('warns on source_repo format', () => {
    insertEntity({
      id: 'repo-1',
      type: 'system',
      rootId: '@acme/project',
      sourceRepo: 'invalid-format',
      data: { name: 'repo' },
    });

    const validator = new DataValidator(store);
    const result = validator.validate();

    expect(result.warnings.map(item => item.code)).toContain('C4A-MIGRATE-004');
  });

  test('formatResult supports json output', () => {
    insertEntity({
      id: 'json-1',
      type: 'system',
      rootId: '',
      sourceRepo: null,
      externalUrl: null,
      data: { external: true },
    });

    const validator = new DataValidator(store);
    const result = validator.validate();
    const json = DataValidator.formatResult(result, 'json');
    const parsed = JSON.parse(json) as { success: boolean; scanned: number };

    expect(parsed.success).toBe(result.success);
    expect(parsed.scanned).toBe(result.scanned);
  });
});

describe('DataRepair', () => {
  beforeAll(() => {
    if (!store) {
      mkdirSync(TMP_ROOT, { recursive: true });
      store = SQLiteStore.getInstance({ dbPath: DB_PATH });
    }
  });

  afterAll(() => {
    if (store) {
      store.close();
      rmSync(DB_PATH, { force: true });
      rmSync(`${DB_PATH}-wal`, { force: true });
      rmSync(`${DB_PATH}-shm`, { force: true });
      resetStoreInstance();
    }
  });

  beforeEach(() => {
    resetDb();
  });

  test('loads project config from .context/.c4a.yaml when not provided', () => {
    const configRoot = join(TMP_ROOT, `repair-config-${Date.now()}`);
    const contextDir = join(configRoot, '.context');
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(
      join(contextDir, '.c4a.yaml'),
      'root_id: \"@acme/test-project\"\nrepo_id: company/test\n',
      'utf-8'
    );

    const originalCwd = process.cwd();
    process.chdir(configRoot);

    let result: { success: boolean } | null = null;
    let entityRow: { root_id: string; source_repo: string | null } | null = null;

    try {
      insertEntity({
        id: 'proj-2',
        type: 'system',
        rootId: '',
        sourceRepo: null,
        data: { name: 'project' },
      });

      const repair = new DataRepair({}, store);
      result = repair.repair({ entityIds: ['proj-2'] });

      const db = store.getDatabase();
      entityRow = db.prepare(`
        SELECT e.root_id, m.source_repo
        FROM entities e
        JOIN metadata m ON e.uuid = m.entity_uuid
        WHERE e.id = ?
      `).get('proj-2') as { root_id: string; source_repo: string | null };
    } finally {
      process.chdir(originalCwd);
      rmSync(configRoot, { recursive: true, force: true });
    }

    expect(result?.success).toBe(true);
    expect(entityRow?.root_id).toBe('@acme/test-project');
    expect(entityRow?.source_repo).toBe('company/test');
  });
});
