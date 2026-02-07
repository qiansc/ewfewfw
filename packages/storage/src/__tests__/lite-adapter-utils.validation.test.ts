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
  db.exec('DELETE FROM entity_versions;');
  db.exec('DELETE FROM entities;');
}

function insertEntity(params: {
  id: string;
  type?: string;
  rootId?: string;
  requirementId?: string | null;
  status?: string;
  data?: Record<string, unknown>;
}): { uuid: string } {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const requirementId = params.requirementId ?? null;
  const rootId = params.rootId ?? 'alpha';
  const type = params.type ?? 'system';
  const status = params.status ?? 'published';
  const data = params.data ?? { id: params.id, name: params.id };
  const uuid = randomUUID();

  db.prepare(`
    INSERT INTO entities (uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(uuid, rootId, params.id, type, null, null, null, JSON.stringify(data), requirementId);

  db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url,
      status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuid,
    null,
    null,
    status,
    'hash',
    now,
    now,
    null,
    null
  );

  db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(uuid, '0.0.0');

  return { uuid };
}

function insertRelation(params: {
  fromId: string;
  toId: string;
  fromUuid: string;
  toUuid?: string | null;
  fromRootId?: string;
  toRootId?: string;
  relType?: string;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO relations (
      id, from_uuid, to_uuid, from_root_id, from_id, to_root_id, to_id,
      rel_type, status, properties, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    params.fromUuid,
    params.toUuid ?? null,
    params.fromRootId ?? 'alpha',
    params.fromId,
    params.toRootId ?? 'alpha',
    params.toId,
    params.relType ?? 'DEPENDS_ON',
    'active',
    null,
    now,
    now
  );
}

function insertFeat(params: { id: string; status?: string; title?: string }): { uuid: string } {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const uuid = randomUUID();
  db.prepare(`
    INSERT INTO entities (
      uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id
    )
    VALUES (?, '', ?, 'feat', NULL, NULL, NULL, ?, NULL, NULL)
  `).run(uuid, params.id, JSON.stringify({ id: params.id, title: params.title ?? params.id }));
  db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, NULL, NULL, ?, NULL, ?, ?, ?, NULL)
  `).run(uuid, params.status ?? 'draft', now, now, 'tester');
  db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(uuid, '0.0.0');
  return { uuid };
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
    const { uuid: featUuid } = insertFeat({ id: 'feat-arch-change', status: 'draft' });
    insertEntity({
      id: 'svc',
      type: 'container',
      data: { id: 'svc', name: 'svc', technology: 'mysql' },
    });
    const { uuid: svcUuid } = insertEntity({
      id: 'svc',
      requirementId: featUuid,
      type: 'container',
      data: { id: 'svc', name: 'svc', technology: 'postgresql' },
    });
    const { uuid: depUuid } = insertEntity({
      id: 'dep',
      requirementId: featUuid,
      type: 'container',
      data: { id: 'dep', name: 'dep' },
    });
    insertRelation({ fromId: 'svc', toId: 'dep', fromUuid: svcUuid, toUuid: depUuid });

    const result = await validate(createContext(), {
      requirement_id: 'feat-arch-change',
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
    const { uuid: featUuid } = insertFeat({ id: 'feat-a', status: 'draft' });
    insertEntity({
      id: 'sys',
      requirementId: featUuid,
      status: 'draft',
      data: { id: 'sys', name: 'v2' },
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-a',
      checks: ['adr_completeness'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.adr_completeness.status).toBe('warning');
    expect(result.checks?.adr_completeness.changes_detected?.length).toBeGreaterThan(0);
  });
});
