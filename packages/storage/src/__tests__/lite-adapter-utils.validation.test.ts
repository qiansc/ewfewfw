import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { SQLiteStore } from '../sqlite-store.js';
import { InMemoryGraph } from '../in-memory-graph.js';
import { GraphQueryCache } from '../graph-query-cache.js';
import { validate } from '../lite-adapter/utilsValidate.js';
import type { AdapterContext } from '../lite-adapter/types.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'store-utils-tests');
const DB_PATH = join(TMP_ROOT, `lite-adapter-utils-${randomUUID()}.db`);

let store: SQLiteStore;

function resetStoreInstance(): void {
  const storeClass = SQLiteStore as unknown as { instance: SQLiteStore | null };
  storeClass.instance = null;
  store = undefined as unknown as SQLiteStore;
}

function createContext(overrides?: Partial<AdapterContext['config']>): AdapterContext {
  const baseFeat = { concurrent_warning: true, auto_notify: false };
  return {
    store,
    graph: new InMemoryGraph(),
    cache: new GraphQueryCache(),
    config: {
      dbPath: DB_PATH,
      defaultProject: 'alpha',
      enableVectorSearch: false,
      repoId: null,
      ...overrides,
      feat: {
        ...baseFeat,
        ...overrides?.feat,
      },
    },
  };
}

function resetDb(): void {
  const db = store.getDatabase();
  db.exec('DELETE FROM relations;');
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
  db.exec('DELETE FROM feats;');
}

function insertEntity(params: {
  id: string;
  proposalId?: string | null;
  type?: string;
  sourceProject?: string;
  status?: string;
  data?: Record<string, unknown>;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const proposalId = params.proposalId ?? '';
  const sourceProject = params.sourceProject ?? 'alpha';
  const type = params.type ?? 'system';
  const status = params.status ?? 'published';
  const data = params.data ?? { id: params.id, name: params.id };

  db.prepare(`
    INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(params.id, sourceProject, proposalId, type, null, null, null, JSON.stringify(data));

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

function insertRelation(params: {
  fromId: string;
  toId: string;
  proposalId?: string | null;
  relType?: string;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO relations (
      id, proposal_id, from_project, from_id, to_project, to_id,
      rel_type, status, properties, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    params.proposalId ?? '',
    'alpha',
    params.fromId,
    'alpha',
    params.toId,
    params.relType ?? 'DEPENDS_ON',
    'active',
    null,
    now,
    now
  );
}

function insertFeat(params: { id: string; status?: string; title?: string }): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO feats (id, status, title, description, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    params.status ?? 'draft',
    params.title ?? params.id,
    '',
    'tester',
    now,
    now
  );
}

describe('LiteAdapter utils validation', () => {
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

  test('adr completeness captures tech stack and depends_on changes', async () => {
    insertFeat({ id: 'feat-arch-change', status: 'draft' });
    insertEntity({
      id: 'svc',
      type: 'container',
      data: { id: 'svc', name: 'svc', technology: 'mysql' },
    });
    insertEntity({
      id: 'svc',
      proposalId: 'feat-arch-change',
      type: 'container',
      data: { id: 'svc', name: 'svc', technology: 'postgresql' },
    });
    insertEntity({
      id: 'dep',
      proposalId: 'feat-arch-change',
      type: 'container',
      data: { id: 'dep', name: 'dep' },
    });
    insertRelation({ fromId: 'svc', toId: 'dep', proposalId: 'feat-arch-change' });

    const result = await validate(createContext(), {
      proposal_id: 'feat-arch-change',
      checks: ['adr_completeness'],
    });

    expect(result.success).toBe(true);
    const adrCheck = result.checks?.adr_completeness;
    expect(adrCheck?.status).toBe('warning');
    const changes = adrCheck?.changes_detected ?? [];
    const techChange = changes.find((change) => change.detail.includes('技术栈变更'));
    const depChange = changes.find((change) => change.detail.includes('DEPENDS_ON'));
    expect(Boolean(techChange)).toBe(true);
    expect(Boolean(depChange)).toBe(true);
  });

  test('validate adr completeness reports architecture change without adr', async () => {
    insertEntity({ id: 'sys', data: { id: 'sys', name: 'v1' } });
    insertEntity({ id: 'sys', proposalId: 'feat-a', status: 'draft', data: { id: 'sys', name: 'v2' } });

    const result = await validate(createContext(), {
      proposal_id: 'feat-a',
      checks: ['adr_completeness'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.adr_completeness.status).toBe('warning');
    expect(result.checks?.adr_completeness.changes_detected?.length).toBeGreaterThan(0);
  });
});
