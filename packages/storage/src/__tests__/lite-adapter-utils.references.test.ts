// @ts-nocheck
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { SQLiteStore } from '../sqlite-store.js';
import { InMemoryGraph } from '../in-memory-graph.js';
import { GraphQueryCache } from '../graph-query-cache.js';
import { save } from '../lite-adapter/crud-save.js';
import { del } from '../lite-adapter/crud-read.js';
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
  updatedBy?: string | null;
  data?: Record<string, unknown>;
}): { uuid: string } {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const requirementId = resolveRequirementId(db, params.requirementId ?? null);
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
    params.updatedBy ?? null
  );

  db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(uuid, '0.0.0');

  return { uuid };
}

function resolveRequirementId(db: ReturnType<SQLiteStore['getDatabase']>, requirementId: string | null): string | null {
  if (!requirementId) return null;
  const row = db
    .prepare(
      `
      SELECT uuid FROM entities
      WHERE type = 'feat' AND root_id = '' AND (uuid = ? OR id = ?)
      LIMIT 1
    `
    )
    .get(requirementId, requirementId) as { uuid?: string } | undefined;
  return row?.uuid ?? requirementId;
}

function resolveEntityUuid(
  db: ReturnType<SQLiteStore['getDatabase']>,
  id: string,
  rootId: string,
  requirementId: string | null
): string | null {
  const requirementClause = requirementId
    ? 'e.requirement_id = ?'
    : "(e.requirement_id IS NULL OR e.requirement_id = '')";
  const row = db
    .prepare(
      `
      SELECT e.uuid FROM entities e
      WHERE e.id = ? AND e.root_id = ? AND ${requirementClause}
      LIMIT 1
    `
    )
    .get(id, rootId, ...(requirementId ? [requirementId] : [])) as { uuid?: string } | undefined;
  return row?.uuid ?? null;
}

function insertRelation(params: {
  fromId: string;
  toId: string;
  fromUuid?: string;
  toUuid?: string | null;
  fromRootId?: string;
  toRootId?: string;
  requirementId?: string | null;
  relType?: string;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const fromRootId = params.fromRootId ?? 'alpha';
  const toRootId = params.toRootId ?? 'alpha';
  const requirementId = resolveRequirementId(db, params.requirementId ?? null);
  const fromUuid =
    params.fromUuid ??
    resolveEntityUuid(db, params.fromId, fromRootId, requirementId);
  const toUuid =
    params.toUuid ??
    resolveEntityUuid(db, params.toId, toRootId, requirementId);

  db.prepare(`
    INSERT INTO relations (
      id, from_uuid, to_uuid, from_root_id, from_id, to_root_id, to_id,
      rel_type, status, properties, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    fromUuid,
    toUuid,
    fromRootId,
    params.fromId,
    toRootId,
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

describe('LiteAdapter utils references', () => {
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

  test('save warns on deprecated references', async () => {
    const { uuid: targetUuid } = insertEntity({ id: 'target' });
    const { uuid: consumerUuid } = insertEntity({ id: 'consumer' });
    insertRelation({ fromId: 'consumer', toId: 'target', fromUuid: consumerUuid, toUuid: targetUuid });

    const result = await save(createContext(), {
      type: 'system',
      data: { id: 'target', name: 'target' },
      metadata: { status: 'deprecated' },
    });

    expect(result.metadata.status).toBe('deprecated');
  });

  test('reference warning ignores non-dependency relations', async () => {
    const { uuid: targetUuid } = insertEntity({ id: 'target' });
    const { uuid: consumerUuid } = insertEntity({ id: 'consumer' });
    insertRelation({
      fromId: 'consumer',
      toId: 'target',
      fromUuid: consumerUuid,
      toUuid: targetUuid,
      relType: 'REFERENCES',
    });

    const result = await save(createContext(), {
      type: 'system',
      data: { id: 'target', name: 'target' },
      metadata: { status: 'deprecated' },
    });

    expect(result.metadata.status).toBe('deprecated');
  });

  test('delete removes entity with dependency relations', async () => {
    const { uuid: targetUuid } = insertEntity({ id: 'target' });
    const { uuid: consumerUuid } = insertEntity({ id: 'consumer' });
    insertRelation({
      fromId: 'consumer',
      toId: 'target',
      fromUuid: consumerUuid,
      toUuid: targetUuid,
      relType: 'DEPENDS_ON',
    });

    await del(createContext(), targetUuid);
    const db = store.getDatabase();
    const row = db.prepare(`SELECT id FROM entities WHERE uuid = ?`).get(targetUuid) as
      | { id: string }
      | undefined;
    expect(row).toBeNull();
  });

  test('delete removes entity with non-dependency relations', async () => {
    const { uuid: targetUuid } = insertEntity({ id: 'target' });
    const { uuid: consumerUuid } = insertEntity({ id: 'consumer' });
    insertRelation({
      fromId: 'consumer',
      toId: 'target',
      fromUuid: consumerUuid,
      toUuid: targetUuid,
      relType: 'REFERENCES',
    });

    await del(createContext(), targetUuid);
    const db = store.getDatabase();
    const row = db.prepare(`SELECT id FROM entities WHERE uuid = ?`).get(targetUuid) as
      | { id: string }
      | undefined;
    expect(row).toBeNull();
  });

  test('validate references include main branch targets', async () => {
    const { uuid: featUuid } = insertFeat({ id: 'feat-a', status: 'draft' });
    const { uuid: svcUuid } = insertEntity({ id: 'svc', requirementId: featUuid, status: 'draft' });
    const { uuid: authUuid } = insertEntity({ id: 'auth' });
    insertRelation({ fromId: 'svc', toId: 'auth', fromUuid: svcUuid, toUuid: authUuid });

    const result = await validate(createContext(), {
      requirement_id: 'feat-a',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('passed');
  });

  test('validate references warns for draft feat', async () => {
    const { uuid: featUuid } = insertFeat({ id: 'feat-draft-ref', status: 'draft' });
    const { uuid: svcUuid } = insertEntity({
      id: 'svc',
      requirementId: featUuid,
      type: 'container',
      status: 'draft',
    });
    insertRelation({ fromId: 'svc', toId: 'missing', fromUuid: svcUuid });

    const result = await validate(createContext(), {
      requirement_id: 'feat-draft-ref',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors for published feat', async () => {
    const { uuid: featUuid } = insertFeat({ id: 'feat-pub-ref', status: 'published' });
    const { uuid: svcUuid } = insertEntity({
      id: 'svc',
      requirementId: featUuid,
      type: 'container',
      status: 'published',
    });
    insertRelation({ fromId: 'svc', toId: 'missing', fromUuid: svcUuid });

    const result = await validate(createContext(), {
      requirement_id: 'feat-pub-ref',
      checks: ['references'],
    });

    expect(result.success).toBe(false);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on type mismatch for draft feat', async () => {
    insertFeat({ id: 'feat-draft-type', status: 'draft' });
    insertEntity({ id: 'svc', requirementId: 'feat-draft-type', type: 'container', status: 'draft' });
    insertEntity({ id: 'auth', requirementId: 'feat-draft-type', type: 'system', status: 'draft' });
    insertRelation({
      fromId: 'svc',
      toId: 'auth',
      requirementId: 'feat-draft-type',
      relType: 'CONTAINS',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-draft-type',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on type mismatch for published feat', async () => {
    insertFeat({ id: 'feat-pub-type', status: 'published' });
    insertEntity({ id: 'svc', requirementId: 'feat-pub-type', type: 'container', status: 'published' });
    insertEntity({ id: 'auth', requirementId: 'feat-pub-type', type: 'system', status: 'published' });
    insertRelation({
      fromId: 'svc',
      toId: 'auth',
      requirementId: 'feat-pub-type',
      relType: 'CONTAINS',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-pub-type',
      checks: ['references'],
    });

    expect(result.success).toBe(false);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on system depends_on container mismatch', async () => {
    insertFeat({ id: 'feat-draft-sys-dep', status: 'draft' });
    insertEntity({ id: 'sys', requirementId: 'feat-draft-sys-dep', type: 'system', status: 'draft' });
    insertEntity({ id: 'svc', requirementId: 'feat-draft-sys-dep', type: 'container', status: 'draft' });
    insertRelation({
      fromId: 'sys',
      toId: 'svc',
      requirementId: 'feat-draft-sys-dep',
      relType: 'DEPENDS_ON',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-draft-sys-dep',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on component references system mismatch', async () => {
    insertFeat({ id: 'feat-pub-comp-ref', status: 'published' });
    insertEntity({ id: 'comp', requirementId: 'feat-pub-comp-ref', type: 'component', status: 'published' });
    insertEntity({ id: 'sys', requirementId: 'feat-pub-comp-ref', type: 'system', status: 'published' });
    insertRelation({
      fromId: 'comp',
      toId: 'sys',
      requirementId: 'feat-pub-comp-ref',
      relType: 'REFERENCES',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-pub-comp-ref',
      checks: ['references'],
    });

    expect(result.success).toBe(false);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on component depends_on container mismatch', async () => {
    insertFeat({ id: 'feat-draft-comp-dep', status: 'draft' });
    insertEntity({ id: 'comp', requirementId: 'feat-draft-comp-dep', type: 'component', status: 'draft' });
    insertEntity({ id: 'svc', requirementId: 'feat-draft-comp-dep', type: 'container', status: 'draft' });
    insertRelation({
      fromId: 'comp',
      toId: 'svc',
      requirementId: 'feat-draft-comp-dep',
      relType: 'DEPENDS_ON',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-draft-comp-dep',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on system contains component mismatch', async () => {
    insertFeat({ id: 'feat-pub-sys-cont', status: 'published' });
    insertEntity({ id: 'sys', requirementId: 'feat-pub-sys-cont', type: 'system', status: 'published' });
    insertEntity({ id: 'comp', requirementId: 'feat-pub-sys-cont', type: 'component', status: 'published' });
    insertRelation({
      fromId: 'sys',
      toId: 'comp',
      requirementId: 'feat-pub-sys-cont',
      relType: 'CONTAINS',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-pub-sys-cont',
      checks: ['references'],
    });

    expect(result.success).toBe(false);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on container implements system mismatch', async () => {
    insertFeat({ id: 'feat-draft-impl', status: 'draft' });
    insertEntity({ id: 'svc', requirementId: 'feat-draft-impl', type: 'container', status: 'draft' });
    insertEntity({ id: 'sys', requirementId: 'feat-draft-impl', type: 'system', status: 'draft' });
    insertRelation({
      fromId: 'svc',
      toId: 'sys',
      requirementId: 'feat-draft-impl',
      relType: 'IMPLEMENTS',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-draft-impl',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on component implements container mismatch', async () => {
    insertFeat({ id: 'feat-pub-impl', status: 'published' });
    insertEntity({ id: 'comp', requirementId: 'feat-pub-impl', type: 'component', status: 'published' });
    insertEntity({ id: 'svc', requirementId: 'feat-pub-impl', type: 'container', status: 'published' });
    insertRelation({
      fromId: 'comp',
      toId: 'svc',
      requirementId: 'feat-pub-impl',
      relType: 'IMPLEMENTS',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-pub-impl',
      checks: ['references'],
    });

    expect(result.success).toBe(false);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on container contains contract mismatch', async () => {
    insertFeat({ id: 'feat-draft-cont-contract', status: 'draft' });
    insertEntity({ id: 'svc', requirementId: 'feat-draft-cont-contract', type: 'container', status: 'draft' });
    insertEntity({ id: 'api', requirementId: 'feat-draft-cont-contract', type: 'contract', status: 'draft' });
    insertRelation({
      fromId: 'svc',
      toId: 'api',
      requirementId: 'feat-draft-cont-contract',
      relType: 'CONTAINS',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-draft-cont-contract',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on component implements system mismatch', async () => {
    insertFeat({ id: 'feat-pub-comp-impl', status: 'published' });
    insertEntity({ id: 'comp', requirementId: 'feat-pub-comp-impl', type: 'component', status: 'published' });
    insertEntity({ id: 'sys', requirementId: 'feat-pub-comp-impl', type: 'system', status: 'published' });
    insertRelation({
      fromId: 'comp',
      toId: 'sys',
      requirementId: 'feat-pub-comp-impl',
      relType: 'IMPLEMENTS',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-pub-comp-impl',
      checks: ['references'],
    });

    expect(result.success).toBe(false);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on system depends_on component mismatch', async () => {
    insertFeat({ id: 'feat-pub-sys-dep-comp', status: 'published' });
    insertEntity({ id: 'sys', requirementId: 'feat-pub-sys-dep-comp', type: 'system', status: 'published' });
    insertEntity({ id: 'comp', requirementId: 'feat-pub-sys-dep-comp', type: 'component', status: 'published' });
    insertRelation({
      fromId: 'sys',
      toId: 'comp',
      requirementId: 'feat-pub-sys-dep-comp',
      relType: 'DEPENDS_ON',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-pub-sys-dep-comp',
      checks: ['references'],
    });

    expect(result.success).toBe(false);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on component references main system mismatch', async () => {
    insertFeat({ id: 'feat-draft-comp-ref-main', status: 'draft' });
    insertEntity({ id: 'sys', type: 'system', status: 'published' });
    insertEntity({ id: 'comp', requirementId: 'feat-draft-comp-ref-main', type: 'component', status: 'draft' });
    insertRelation({
      fromId: 'comp',
      toId: 'sys',
      requirementId: 'feat-draft-comp-ref-main',
      relType: 'REFERENCES',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-draft-comp-ref-main',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on container depends_on system mismatch', async () => {
    insertFeat({ id: 'feat-draft-cont-dep-sys', status: 'draft' });
    insertEntity({ id: 'svc', requirementId: 'feat-draft-cont-dep-sys', type: 'container', status: 'draft' });
    insertEntity({ id: 'sys', requirementId: 'feat-draft-cont-dep-sys', type: 'system', status: 'draft' });
    insertRelation({
      fromId: 'svc',
      toId: 'sys',
      requirementId: 'feat-draft-cont-dep-sys',
      relType: 'DEPENDS_ON',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-draft-cont-dep-sys',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on container contains system mismatch', async () => {
    insertFeat({ id: 'feat-pub-cont-cont-sys', status: 'published' });
    insertEntity({ id: 'svc', requirementId: 'feat-pub-cont-cont-sys', type: 'container', status: 'published' });
    insertEntity({ id: 'sys', requirementId: 'feat-pub-cont-cont-sys', type: 'system', status: 'published' });
    insertRelation({
      fromId: 'svc',
      toId: 'sys',
      requirementId: 'feat-pub-cont-cont-sys',
      relType: 'CONTAINS',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-pub-cont-cont-sys',
      checks: ['references'],
    });

    expect(result.success).toBe(false);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on container implements component mismatch', async () => {
    insertFeat({ id: 'feat-draft-cont-impl-comp', status: 'draft' });
    insertEntity({ id: 'svc', requirementId: 'feat-draft-cont-impl-comp', type: 'container', status: 'draft' });
    insertEntity({ id: 'comp', requirementId: 'feat-draft-cont-impl-comp', type: 'component', status: 'draft' });
    insertRelation({
      fromId: 'svc',
      toId: 'comp',
      requirementId: 'feat-draft-cont-impl-comp',
      relType: 'IMPLEMENTS',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-draft-cont-impl-comp',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on component references contract mismatch', async () => {
    insertFeat({ id: 'feat-pub-comp-ref-contract', status: 'published' });
    insertEntity({ id: 'comp', requirementId: 'feat-pub-comp-ref-contract', type: 'component', status: 'published' });
    insertEntity({ id: 'api', requirementId: 'feat-pub-comp-ref-contract', type: 'contract', status: 'published' });
    insertRelation({
      fromId: 'comp',
      toId: 'api',
      requirementId: 'feat-pub-comp-ref-contract',
      relType: 'REFERENCES',
    });

    const result = await validate(createContext(), {
      requirement_id: 'feat-pub-comp-ref-contract',
      checks: ['references'],
    });

    expect(result.success).toBe(false);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });
});
