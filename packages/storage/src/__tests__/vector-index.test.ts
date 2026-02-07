import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FeatureExtractionPipeline } from '@xenova/transformers';
import { SQLiteStore } from '../sqlite-store.js';
import { generateVectorKey, setEmbedderForTest } from '../vector-search.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'vector-index-tests');
const DB_PATH = join(TMP_ROOT, `vector-index-${Date.now()}.db`);

let store: SQLiteStore;

function resetStoreInstance(): void {
  const storeClass = SQLiteStore as unknown as { instance: SQLiteStore | null };
  storeClass.instance = null;
}

function makeEmbedding(seed: number): Float32Array {
  const vector = new Float32Array(384);
  vector[0] = seed;
  return vector;
}

function insertEntity(params: {
  uuid: string;
  id: string;
  rootId?: string;
  versions?: string[];
  data?: string;
  status?: 'published' | 'archived' | 'deprecated';
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const rootId = params.rootId ?? 'default';
  const data = params.data ?? JSON.stringify({ name: 'hello world' });
  const status = params.status ?? 'published';

  db.prepare(`
    INSERT INTO entities (uuid, root_id, id, type, kind, scope, perspective, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(params.uuid, rootId, params.id, 'system', null, null, null, data);

  db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url,
      status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.uuid,
    null,
    null,
    status,
    'hash',
    now,
    now,
    null,
    null
  );

  const versions = params.versions ?? ['0.0.0'];
  const insertVersion = db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`);
  for (const v of versions) {
    insertVersion.run(params.uuid, v);
  }
}

beforeAll(() => {
  mkdirSync(TMP_ROOT, { recursive: true });
  store = SQLiteStore.getInstance({ dbPath: DB_PATH });

  const stubEmbedder = (async () => ({ data: makeEmbedding(1) })) as unknown as FeatureExtractionPipeline;
  setEmbedderForTest(stubEmbedder);
});

afterAll(() => {
  store.close();
  resetStoreInstance();
  setEmbedderForTest(null);
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('Vector Index Maintenance', () => {
  test('rebuildVectorIndex skips archived and invalid data', async () => {
    const db = store.getDatabase();
    db.exec('DELETE FROM entity_versions;');
    db.exec('DELETE FROM metadata;');
    db.exec('DELETE FROM entities;');
    store.getVectorStore()?.rebuild([]);

    insertEntity({ uuid: 'u-ok', id: 'entity-ok', data: JSON.stringify({ name: 'alpha' }) });
    insertEntity({ uuid: 'u-archived', id: 'entity-archived', status: 'archived' });
    insertEntity({ uuid: 'u-empty', id: 'entity-empty', data: JSON.stringify({}) });

    const result = await store.rebuildVectorIndex();
    expect(result.total).toBe(2);
    expect(result.indexed).toBe(1);
    expect(result.skipped).toBe(1);

    const vectorStore = store.getVectorStore();
    expect(vectorStore).not.toBeNull();
    const key = generateVectorKey('u-ok');
    expect(vectorStore?.has(key)).toBe(true);
  });
});
