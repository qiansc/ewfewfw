import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { SQLiteStore } from '../sqlite-store.js';
import { InMemoryGraph } from '../in-memory-graph.js';
import { GraphQueryCache } from '../graph-query-cache.js';
import { save } from '../lite-adapter/crud-save.js';
import { del } from '../lite-adapter/crud-read.js';
import { backup } from '../lite-adapter/utilsBackup.js';
import { restore } from '../lite-adapter/utilsRestore.js';
import { readHistory } from '../lite-adapter/utilsHistory.js';
import { repair } from '../lite-adapter/utilsRepair.js';
import { validate } from '../lite-adapter/utilsValidate.js';
import type { AdapterContext } from '../lite-adapter/types.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'store-utils-tests');
const DB_PATH = join(TMP_ROOT, `lite-adapter-utils-${Date.now()}.db`);

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

function insertHistory(params: { entityId: string; action: string }): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO entity_history (
      entity_id, source_project, proposal_id, entity_type, feat_id,
      action, changed_fields, changed_by, changed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.entityId,
    'alpha',
    '',
    'system',
    '',
    params.action,
    null,
    'tester',
    now
  );
}

function extractTarPayload(buffer: Buffer): string | null {
  if (buffer.length < 512) return null;
  const magic = buffer.subarray(257, 262).toString('utf-8');
  if (magic !== 'ustar') return null;
  const sizeText = buffer.subarray(124, 136).toString('utf-8').replace(/\0/g, '').trim();
  const size = parseInt(sizeText || '0', 8);
  const start = 512;
  const end = start + size;
  if (end > buffer.length) return null;
  return buffer.subarray(start, end).toString('utf-8');
}

describe('LiteAdapter utils fixes', () => {
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

  test('concurrent warning respects config and force_save', async () => {
    insertEntity({ id: 'svc' });
    insertEntity({ id: 'svc', proposalId: 'feat-b', status: 'draft', updatedBy: 'bob' });
    insertFeat({ id: 'feat-b', status: 'approved', title: 'Upgrade to v2' });

    const resultWarn = await save(createContext(), {
      type: 'system',
      data: { id: 'svc', name: 'svc' },
      proposal_id: 'feat-a',
    });

    expect(resultWarn.warnings?.[0].code).toBe('CONCURRENT_MODIFICATION');
    const summary = (resultWarn.warnings?.[0].details as { concurrent_feats?: Array<{ changes_summary?: string }> })
      ?.concurrent_feats?.[0]?.changes_summary;
    expect(summary).toBe('Upgrade to v2');

    const resultDisabled = await save(
      createContext({ feat: { concurrent_warning: false, auto_notify: false } }),
      {
      type: 'system',
      data: { id: 'svc', name: 'svc' },
      proposal_id: 'feat-a',
      }
    );
    expect(resultDisabled.warnings).toBeUndefined();

    const resultForced = await save(createContext(), {
      type: 'system',
      data: { id: 'svc', name: 'svc' },
      proposal_id: 'feat-a',
      force_save: true,
    });
    expect(resultForced.warnings).toBeUndefined();
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

  test('backup tar.gz includes repo metadata', async () => {
    insertEntity({ id: 'svc' });
    const backupFile = join(TMP_ROOT, `backup-${Date.now()}.tar.gz`);

    const result = await backup(createContext({ repoId: 'acme/repo' }), {
      output: backupFile,
      format: 'tar.gz',
    });

    expect(result.success).toBe(true);
    const gz = readFileSync(backupFile);
    const decompressed = gunzipSync(gz);
    const payload = extractTarPayload(decompressed) ?? decompressed.toString('utf-8');
    const data = JSON.parse(payload) as {
      exported_by: string;
      source: { repo_id?: string };
    };
    expect(data.exported_by).toBe('unknown');
    expect(data.source.repo_id).toBe('acme/repo');
  });

  test('restore validates relation checksum', async () => {
    insertEntity({ id: 'svc' });
    insertRelation({ fromId: 'svc', toId: 'svc' });
    const backupFile = join(TMP_ROOT, `backup-${Date.now()}.json`);

    await backup(createContext(), { output: backupFile, format: 'json' });
    const raw = JSON.parse(readFileSync(backupFile, 'utf-8')) as {
      relations: Array<Record<string, unknown>>;
      checksums: { entities: string; relations: string };
    };
    raw.relations.push({ id: 'tamper', from_id: 'x', to_id: 'y', rel_type: 'DEPENDS_ON' });
    writeFileSync(backupFile, JSON.stringify(raw, null, 2), 'utf-8');

    const result = await restore(createContext(), { input: backupFile, validate_checksums: true });
    expect(result.success).toBe(false);
    expect(result.error).toBe('关系数据校验和不匹配');
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

  test('repair neo4j scope returns local mode message', async () => {
    insertEntity({ id: 'svc' });
    const result = await repair(createContext(), { scope: 'neo4j' });
    expect(result.success).toBe(true);
    expect(result.message).toBe('Local 模式不使用 Neo4j，无需修复');
  });

  test('readHistory preserves archive action', async () => {
    insertHistory({ entityId: 'svc', action: 'archive' });
    const result = await readHistory(createContext(), { entity_id: 'svc' });
    expect(result.items[0]?.action).toBe('archive');
  });
});
