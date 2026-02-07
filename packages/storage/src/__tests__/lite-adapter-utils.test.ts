// @ts-nocheck
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { SQLiteStore } from '../sqlite-store.js';
import { InMemoryGraph } from '../in-memory-graph.js';
import { GraphQueryCache } from '../graph-query-cache.js';
import type { FeatureExtractionPipeline } from '@xenova/transformers';
import { backup } from '../lite-adapter/utilsBackup.js';
import { restore } from '../lite-adapter/utilsRestore.js';
import { readHistory } from '../lite-adapter/utilsHistory.js';
import { repair } from '../lite-adapter/utilsRepair.js';
import type { AdapterContext } from '../lite-adapter/types.js';
import { generateVectorKey, setEmbedderForTest } from '../vector-search.js';

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
  db.exec('DELETE FROM entity_versions;');
  db.exec('DELETE FROM entities;');
}

function insertEntity(params: {
  id: string;
  type?: string;
  rootId?: string;
  status?: string;
  updatedBy?: string | null;
  data?: Record<string, unknown>;
  versions?: string[];
}): { uuid: string } {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const rootId = params.rootId ?? 'alpha';
  const type = params.type ?? 'system';
  const status = params.status ?? 'published';
  const data = params.data ?? { id: params.id, name: params.id };
  const uuid = randomUUID();
  const versions = params.versions && params.versions.length > 0 ? params.versions : ['0.0.0'];

  db.prepare(`
    INSERT INTO entities (uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `).run(uuid, rootId, params.id, type, null, null, null, JSON.stringify(data));

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

  const insertVersion = db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`);
  for (const version of versions) {
    insertVersion.run(uuid, version);
  }

  return { uuid };
}

function insertRelation(params: {
  fromId: string;
  toId: string;
  relType?: string;
  fromUuid: string;
  toUuid?: string | null;
  fromRootId?: string;
  toRootId?: string;
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

function insertHistory(params: { entityId: string; action: string }): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const uuid = randomUUID();
  db.prepare(`
    INSERT INTO entity_history (
      entity_uuid, root_id, entity_id, entity_type,
      action, changed_fields, snapshot_after, changed_by, changed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuid,
    'alpha',
    params.entityId,
    'system',
    params.action,
    null,
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

function makeEmbedding(seed: number): Float32Array {
  const vector = new Float32Array(384);
  vector[0] = seed;
  return vector;
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

  test('backup includes versions and root_id', async () => {
    insertEntity({ id: 'svc', versions: ['0.0.0', '1.0.0'] });
    const backupFile = join(TMP_ROOT, `backup-${Date.now()}.json`);

    const result = await backup(createContext({ repoId: 'acme/repo' }), {
      output: backupFile,
      format: 'json',
    });

    expect(result.success).toBe(true);
    const payload = JSON.parse(readFileSync(backupFile, 'utf-8')) as {
      entities: Array<{ id: string; root_id: string; versions: string[] }>;
      source: { root_id: string };
    };
    expect(payload.source.root_id).toBe('alpha');
    const entity = payload.entities.find((item) => item.id === 'svc');
    expect(entity?.versions).toEqual(['0.0.0', '1.0.0']);
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
    const { uuid } = insertEntity({ id: 'svc' });
    insertRelation({ fromId: 'svc', toId: 'svc', fromUuid: uuid, toUuid: uuid });
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

  test('restore rebuilds vector index when enabled', async () => {
    const vectorStore = store.getVectorStore();
    expect(vectorStore).not.toBeNull();
    if (!vectorStore) return;

    const stubEmbedder = (async () => ({ data: makeEmbedding(1) })) as unknown as FeatureExtractionPipeline;
    setEmbedderForTest(stubEmbedder);

    const { uuid } = insertEntity({ id: 'svc', data: { id: 'svc', name: 'svc' } });
    const backupFile = join(TMP_ROOT, `backup-${Date.now()}.json`);
    await backup(createContext(), { output: backupFile, format: 'json' });

    resetDb();
    vectorStore.rebuild([]);

    const result = await restore(createContext({ enableVectorSearch: true }), {
      input: backupFile,
      validate_checksums: true,
    });

    expect(result.success).toBe(true);
    expect(result.stats?.vectors).toBe(1);
    const key = generateVectorKey(uuid);
    expect(vectorStore.has(key)).toBe(true);
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
