/**
 * 数据完整性校验/修复测试
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SQLiteStore } from '../sqlite-store.js';
import { DataValidator } from '../validate.js';
import { DataRepair } from '../repair.js';

type InsertParams = {
  id: string;
  type?: string;
  scope?: string | null;
  sourceProject?: string;
  sourceRepo?: string | null;
  externalUrl?: string | null;
  data?: Record<string, unknown>;
  proposalId?: string | null;
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
  db.exec('DELETE FROM entities;');
}

function insertEntity(params: InsertParams) {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const id = params.id;
  const type = params.type ?? 'system';
  const scope = params.scope ?? null;
  const sourceProject = params.sourceProject ?? 'my-project';
  const proposalId = params.proposalId ?? '';
  const data = params.data ?? {};

  db.prepare(`
    INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    sourceProject,
    proposalId,
    type,
    null,
    scope,
    null,
    JSON.stringify(data)
  );

  db.prepare(`
    INSERT INTO metadata (
      entity_id, source_project, proposal_id, source_repo, external_url,
      status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    sourceProject,
    proposalId,
    params.sourceRepo ?? null,
    params.externalUrl ?? null,
    'published',
    'hash',
    now,
    now,
    null,
    null
  );
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
      sourceProject: '',
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
      sourceProject: '',
      sourceRepo: null,
      externalUrl: null,
      data: { external: true },
    });

    const validator = new DataValidator(store);
    const result = validator.validate();

    expect(result.warnings.map(item => item.code)).toContain('C4A-MIGRATE-008');
  });

  test('warns on non-project scopes with source_project/source_repo', () => {
    insertEntity({
      id: 'domain-1',
      type: 'system',
      scope: 'domain',
      sourceProject: 'proj-x',
      sourceRepo: 'owner/repo',
      data: { name: 'domain' },
    });

    const validator = new DataValidator(store);
    const result = validator.validate();

    const warningCodes = result.warnings.map(item => item.code);
    expect(warningCodes).toContain('C4A-MIGRATE-005');
    expect(warningCodes).toContain('C4A-MIGRATE-006');
  });

  test('errors on missing source_project/source_repo', () => {
    insertEntity({
      id: 'proj-1',
      type: 'system',
      sourceProject: '',
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
      sourceProject: 'my-project',
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
      sourceProject: '',
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
      'project_id: test-project\nrepo_id: company/test\n',
      'utf-8'
    );

    const originalCwd = process.cwd;
    (process as unknown as { cwd: () => string }).cwd = () => configRoot;

    let result: { success: boolean } | null = null;
    let metadata: { source_project: string; source_repo: string | null } | null = null;

    try {
      insertEntity({
        id: 'proj-2',
        type: 'system',
        sourceProject: '',
        sourceRepo: null,
        data: { name: 'project' },
      });

      const repair = new DataRepair({}, store);
      result = repair.repair({ entityIds: ['proj-2'] });

      const db = store.getDatabase();
      metadata = db.prepare(`
        SELECT source_project, source_repo FROM metadata WHERE entity_id = ?
      `).get('proj-2') as { source_project: string; source_repo: string | null };
    } finally {
      (process as unknown as { cwd: () => string }).cwd = originalCwd;
      rmSync(configRoot, { recursive: true, force: true });
    }

    expect(result?.success).toBe(true);
    expect(metadata?.source_project).toBe('test-project');
    expect(metadata?.source_repo).toBe('company/test');
  });
});
