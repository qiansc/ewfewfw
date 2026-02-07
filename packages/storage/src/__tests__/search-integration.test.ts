import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FeatureExtractionPipeline } from '@xenova/transformers';
import { GraphQueryCache } from '../graph-query-cache.js';
import { InMemoryGraph } from '../in-memory-graph.js';
import { SQLiteStore } from '../sqlite-store.js';
import { search } from '../lite-adapter/search-operations.js';
import { generateVectorKey, semanticSearch, setEmbedderForTest } from '../vector-search.js';
import type { AdapterContext } from '../lite-adapter/types.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'search-tests');
const DB_PATH = join(TMP_ROOT, `search-${Date.now()}.db`);

let store: SQLiteStore;
let ctx: AdapterContext;

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
  type?: string;
  versions?: string[];
  data?: Record<string, unknown>;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const id = params.id;
  const type = params.type ?? 'system';
  const rootId = params.rootId ?? 'default';
  const data = params.data ?? {};
  const versions = params.versions ?? ['0.0.0'];

  db.prepare(`
    INSERT INTO entities (uuid, root_id, id, type, kind, scope, perspective, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(params.uuid, rootId, id, type, null, null, null, JSON.stringify(data));

  db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.uuid,
    null,
    null,
    'published',
    'hash',
    now,
    now,
    null,
    null
  );

  const insertVersion = db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`);
  for (const v of versions) {
    insertVersion.run(params.uuid, v);
  }
}

beforeAll(() => {
  mkdirSync(TMP_ROOT, { recursive: true });
  store = SQLiteStore.getInstance({ dbPath: DB_PATH });
  ctx = {
    store,
    graph: new InMemoryGraph(),
    cache: new GraphQueryCache(),
    config: {
      dbPath: DB_PATH,
      defaultProject: 'default',
      enableVectorSearch: true,
      repoId: null,
      feat: {
        concurrent_warning: true,
        auto_notify: false,
      },
    },
  };

  const stubEmbedder = (async () => ({ data: makeEmbedding(1) })) as unknown as FeatureExtractionPipeline;
  setEmbedderForTest(stubEmbedder);
});

beforeEach(() => {
  const db = store.getDatabase();
  db.exec('DELETE FROM entity_versions;');
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
  store.getVectorStore()?.rebuild([]);
});

afterAll(() => {
  store.close();
  resetStoreInstance();
  setEmbedderForTest(null);
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('Search Integration', () => {
  test('vector search returns ranked results', async () => {
    const vectorStore = store.getVectorStore();
    expect(vectorStore).not.toBeNull();

    insertEntity({ uuid: 'u1', id: 'entity-a', data: { name: 'alpha' } });
    insertEntity({ uuid: 'u2', id: 'entity-b', data: { name: 'beta' } });

    vectorStore?.add(generateVectorKey('u1'), makeEmbedding(1));
    vectorStore?.add(generateVectorKey('u2'), makeEmbedding(0));
    vectorStore?.save();

    const results = await semanticSearch(
      store.getDatabase(),
      vectorStore as NonNullable<typeof vectorStore>,
      'query',
      {},
      2
    );

    expect(results[0]?.id).toBe('entity-a');
  });

  test('vector search supports version filter', async () => {
    const vectorStore = store.getVectorStore();
    expect(vectorStore).not.toBeNull();

    insertEntity({ uuid: 'u-main', id: 'entity-x', versions: ['0.0.0'], data: { name: 'main' } });
    insertEntity({ uuid: 'u-v1', id: 'entity-x', versions: ['1.0.0'], data: { name: 'v1' } });

    vectorStore?.add(generateVectorKey('u-main'), makeEmbedding(1));
    vectorStore?.add(generateVectorKey('u-v1'), makeEmbedding(1));
    vectorStore?.save();

    const results = await semanticSearch(
      store.getDatabase(),
      vectorStore as NonNullable<typeof vectorStore>,
      'query',
      { versions: ['1.0.0'] },
      5
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.uuid).toBe('u-v1');
  });

  test('fallback to LIKE when vector search has no results', async () => {
    insertEntity({
      uuid: 'u-like',
      id: 'entity-like',
      data: { name: 'hello world', description: 'match me' },
    });

    const result = await search(ctx, {
      query: 'hello',
      limit: 5,
      scope: 'all',
    });

    const expectedFulltext = store.isFtsEnabled();
    const expectedMode = expectedFulltext ? 'fulltext' : 'like';
    const expectedReason = expectedFulltext ? 'NO_VECTOR_RESULTS' : 'FULLTEXT_SEARCH_UNAVAILABLE';
    expect(result.search_mode).toBe(expectedMode);
    expect(result.degraded).toBe(true);
    expect(result.degraded_reason).toBe(expectedReason);
    expect(result.items.length).toBeGreaterThan(0);
  });
});
