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
  db.exec('DELETE FROM entities;');
  db.exec('DELETE FROM feats;');
}

function insertEntity(params: {
  id: string;
  proposalId?: string | null;
  type?: string;
  sourceProject?: string;
  status?: string;
  updatedBy?: string | null;
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
    params.updatedBy ?? null
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
    insertEntity({ id: 'target' });
    insertEntity({ id: 'consumer' });
    insertRelation({ fromId: 'consumer', toId: 'target' });

    const result = await save(createContext(), {
      type: 'system',
      data: { id: 'target', name: 'target', status: 'deprecated' },
    });

    expect(result.status).toBe('deprecated');
    expect(result.warnings?.[0].code).toBe('DANGLING_REFERENCE');
  });

  test('reference warning ignores non-dependency relations', async () => {
    insertEntity({ id: 'target' });
    insertEntity({ id: 'consumer' });
    insertRelation({ fromId: 'consumer', toId: 'target', relType: 'REFERENCES' });

    const result = await save(createContext(), {
      type: 'system',
      data: { id: 'target', name: 'target', status: 'deprecated' },
    });

    expect(result.warnings).toBeUndefined();
  });

  test('delete warns on dependency relations only', async () => {
    insertEntity({ id: 'target' });
    insertEntity({ id: 'consumer' });
    insertRelation({ fromId: 'consumer', toId: 'target', relType: 'DEPENDS_ON' });

    const result = await del(createContext(), { id: 'target' });
    expect(result.warnings?.[0].code).toBe('DANGLING_REFERENCE');
  });

  test('delete keeps HAS_RELATIONS for non-dependency relations', async () => {
    insertEntity({ id: 'target' });
    insertEntity({ id: 'consumer' });
    insertRelation({ fromId: 'consumer', toId: 'target', relType: 'REFERENCES' });

    const result = await del(createContext(), { id: 'target' });
    expect(result.warnings?.[0].code).toBe('HAS_RELATIONS');
  });

  test('validate references include main branch targets', async () => {
    insertEntity({ id: 'auth' });
    insertEntity({ id: 'svc', proposalId: 'feat-a', status: 'draft' });
    insertRelation({ fromId: 'svc', toId: 'auth', proposalId: 'feat-a' });

    const result = await validate(createContext(), {
      proposal_id: 'feat-a',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('passed');
  });

  test('validate references warns for draft feat', async () => {
    insertFeat({ id: 'feat-draft-ref', status: 'draft' });
    insertEntity({ id: 'svc', proposalId: 'feat-draft-ref', type: 'container', status: 'draft' });
    insertRelation({ fromId: 'svc', toId: 'missing', proposalId: 'feat-draft-ref' });

    const result = await validate(createContext(), {
      proposal_id: 'feat-draft-ref',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors for published feat', async () => {
    insertFeat({ id: 'feat-pub-ref', status: 'published' });
    insertEntity({ id: 'svc', proposalId: 'feat-pub-ref', type: 'container', status: 'published' });
    insertRelation({ fromId: 'svc', toId: 'missing', proposalId: 'feat-pub-ref' });

    const result = await validate(createContext(), {
      proposal_id: 'feat-pub-ref',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on type mismatch for draft feat', async () => {
    insertFeat({ id: 'feat-draft-type', status: 'draft' });
    insertEntity({ id: 'svc', proposalId: 'feat-draft-type', type: 'container', status: 'draft' });
    insertEntity({ id: 'auth', proposalId: 'feat-draft-type', type: 'system', status: 'draft' });
    insertRelation({
      fromId: 'svc',
      toId: 'auth',
      proposalId: 'feat-draft-type',
      relType: 'CONTAINS',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-draft-type',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on type mismatch for published feat', async () => {
    insertFeat({ id: 'feat-pub-type', status: 'published' });
    insertEntity({ id: 'svc', proposalId: 'feat-pub-type', type: 'container', status: 'published' });
    insertEntity({ id: 'auth', proposalId: 'feat-pub-type', type: 'system', status: 'published' });
    insertRelation({
      fromId: 'svc',
      toId: 'auth',
      proposalId: 'feat-pub-type',
      relType: 'CONTAINS',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-pub-type',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on system depends_on container mismatch', async () => {
    insertFeat({ id: 'feat-draft-sys-dep', status: 'draft' });
    insertEntity({ id: 'sys', proposalId: 'feat-draft-sys-dep', type: 'system', status: 'draft' });
    insertEntity({ id: 'svc', proposalId: 'feat-draft-sys-dep', type: 'container', status: 'draft' });
    insertRelation({
      fromId: 'sys',
      toId: 'svc',
      proposalId: 'feat-draft-sys-dep',
      relType: 'DEPENDS_ON',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-draft-sys-dep',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on component references system mismatch', async () => {
    insertFeat({ id: 'feat-pub-comp-ref', status: 'published' });
    insertEntity({ id: 'comp', proposalId: 'feat-pub-comp-ref', type: 'component', status: 'published' });
    insertEntity({ id: 'sys', proposalId: 'feat-pub-comp-ref', type: 'system', status: 'published' });
    insertRelation({
      fromId: 'comp',
      toId: 'sys',
      proposalId: 'feat-pub-comp-ref',
      relType: 'REFERENCES',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-pub-comp-ref',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on component depends_on container mismatch', async () => {
    insertFeat({ id: 'feat-draft-comp-dep', status: 'draft' });
    insertEntity({ id: 'comp', proposalId: 'feat-draft-comp-dep', type: 'component', status: 'draft' });
    insertEntity({ id: 'svc', proposalId: 'feat-draft-comp-dep', type: 'container', status: 'draft' });
    insertRelation({
      fromId: 'comp',
      toId: 'svc',
      proposalId: 'feat-draft-comp-dep',
      relType: 'DEPENDS_ON',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-draft-comp-dep',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on system contains component mismatch', async () => {
    insertFeat({ id: 'feat-pub-sys-cont', status: 'published' });
    insertEntity({ id: 'sys', proposalId: 'feat-pub-sys-cont', type: 'system', status: 'published' });
    insertEntity({ id: 'comp', proposalId: 'feat-pub-sys-cont', type: 'component', status: 'published' });
    insertRelation({
      fromId: 'sys',
      toId: 'comp',
      proposalId: 'feat-pub-sys-cont',
      relType: 'CONTAINS',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-pub-sys-cont',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on container implements system mismatch', async () => {
    insertFeat({ id: 'feat-draft-impl', status: 'draft' });
    insertEntity({ id: 'svc', proposalId: 'feat-draft-impl', type: 'container', status: 'draft' });
    insertEntity({ id: 'sys', proposalId: 'feat-draft-impl', type: 'system', status: 'draft' });
    insertRelation({
      fromId: 'svc',
      toId: 'sys',
      proposalId: 'feat-draft-impl',
      relType: 'IMPLEMENTS',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-draft-impl',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on component implements container mismatch', async () => {
    insertFeat({ id: 'feat-pub-impl', status: 'published' });
    insertEntity({ id: 'comp', proposalId: 'feat-pub-impl', type: 'component', status: 'published' });
    insertEntity({ id: 'svc', proposalId: 'feat-pub-impl', type: 'container', status: 'published' });
    insertRelation({
      fromId: 'comp',
      toId: 'svc',
      proposalId: 'feat-pub-impl',
      relType: 'IMPLEMENTS',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-pub-impl',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on container contains contract mismatch', async () => {
    insertFeat({ id: 'feat-draft-cont-contract', status: 'draft' });
    insertEntity({ id: 'svc', proposalId: 'feat-draft-cont-contract', type: 'container', status: 'draft' });
    insertEntity({ id: 'api', proposalId: 'feat-draft-cont-contract', type: 'contract', status: 'draft' });
    insertRelation({
      fromId: 'svc',
      toId: 'api',
      proposalId: 'feat-draft-cont-contract',
      relType: 'CONTAINS',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-draft-cont-contract',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on component implements system mismatch', async () => {
    insertFeat({ id: 'feat-pub-comp-impl', status: 'published' });
    insertEntity({ id: 'comp', proposalId: 'feat-pub-comp-impl', type: 'component', status: 'published' });
    insertEntity({ id: 'sys', proposalId: 'feat-pub-comp-impl', type: 'system', status: 'published' });
    insertRelation({
      fromId: 'comp',
      toId: 'sys',
      proposalId: 'feat-pub-comp-impl',
      relType: 'IMPLEMENTS',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-pub-comp-impl',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on system depends_on component mismatch', async () => {
    insertFeat({ id: 'feat-pub-sys-dep-comp', status: 'published' });
    insertEntity({ id: 'sys', proposalId: 'feat-pub-sys-dep-comp', type: 'system', status: 'published' });
    insertEntity({ id: 'comp', proposalId: 'feat-pub-sys-dep-comp', type: 'component', status: 'published' });
    insertRelation({
      fromId: 'sys',
      toId: 'comp',
      proposalId: 'feat-pub-sys-dep-comp',
      relType: 'DEPENDS_ON',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-pub-sys-dep-comp',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on component references main system mismatch', async () => {
    insertFeat({ id: 'feat-draft-comp-ref-main', status: 'draft' });
    insertEntity({ id: 'sys', type: 'system', status: 'published' });
    insertEntity({ id: 'comp', proposalId: 'feat-draft-comp-ref-main', type: 'component', status: 'draft' });
    insertRelation({
      fromId: 'comp',
      toId: 'sys',
      proposalId: 'feat-draft-comp-ref-main',
      relType: 'REFERENCES',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-draft-comp-ref-main',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on container depends_on system mismatch', async () => {
    insertFeat({ id: 'feat-draft-cont-dep-sys', status: 'draft' });
    insertEntity({ id: 'svc', proposalId: 'feat-draft-cont-dep-sys', type: 'container', status: 'draft' });
    insertEntity({ id: 'sys', proposalId: 'feat-draft-cont-dep-sys', type: 'system', status: 'draft' });
    insertRelation({
      fromId: 'svc',
      toId: 'sys',
      proposalId: 'feat-draft-cont-dep-sys',
      relType: 'DEPENDS_ON',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-draft-cont-dep-sys',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on container contains system mismatch', async () => {
    insertFeat({ id: 'feat-pub-cont-cont-sys', status: 'published' });
    insertEntity({ id: 'svc', proposalId: 'feat-pub-cont-cont-sys', type: 'container', status: 'published' });
    insertEntity({ id: 'sys', proposalId: 'feat-pub-cont-cont-sys', type: 'system', status: 'published' });
    insertRelation({
      fromId: 'svc',
      toId: 'sys',
      proposalId: 'feat-pub-cont-cont-sys',
      relType: 'CONTAINS',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-pub-cont-cont-sys',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references warns on container implements component mismatch', async () => {
    insertFeat({ id: 'feat-draft-cont-impl-comp', status: 'draft' });
    insertEntity({ id: 'svc', proposalId: 'feat-draft-cont-impl-comp', type: 'container', status: 'draft' });
    insertEntity({ id: 'comp', proposalId: 'feat-draft-cont-impl-comp', type: 'component', status: 'draft' });
    insertRelation({
      fromId: 'svc',
      toId: 'comp',
      proposalId: 'feat-draft-cont-impl-comp',
      relType: 'IMPLEMENTS',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-draft-cont-impl-comp',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('warning');
    expect(result.checks?.references.warnings?.[0]?.code).toBe('DANGLING_REFERENCE');
  });

  test('validate references errors on component references contract mismatch', async () => {
    insertFeat({ id: 'feat-pub-comp-ref-contract', status: 'published' });
    insertEntity({ id: 'comp', proposalId: 'feat-pub-comp-ref-contract', type: 'component', status: 'published' });
    insertEntity({ id: 'api', proposalId: 'feat-pub-comp-ref-contract', type: 'contract', status: 'published' });
    insertRelation({
      fromId: 'comp',
      toId: 'api',
      proposalId: 'feat-pub-comp-ref-contract',
      relType: 'REFERENCES',
    });

    const result = await validate(createContext(), {
      proposal_id: 'feat-pub-comp-ref-contract',
      checks: ['references'],
    });

    expect(result.success).toBe(true);
    expect(result.checks?.references.status).toBe('error');
    expect(result.checks?.references.errors?.[0]?.code).toBe('DANGLING_REFERENCE');
  });
});
