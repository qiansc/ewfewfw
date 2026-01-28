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
  id: string;
  type?: string;
  sourceProject?: string;
  proposalId?: string | null;
  data?: Record<string, unknown>;
}): void {
  const db = store.getDatabase();
  const now = new Date().toISOString();
  const id = params.id;
  const type = params.type ?? 'system';
  const sourceProject = params.sourceProject ?? 'default';
  const proposalId = params.proposalId ?? null;
  const data = params.data ?? {};

  db.prepare(`
    INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    sourceProject,
    proposalId ?? '',
    type,
    null,
    null,
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
    proposalId ?? '',
    null,
    null,
    'published',
    'hash',
    now,
    now,
    null,
    null
  );
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
    },
  };

  const stubEmbedder = (async () => ({ data: makeEmbedding(1) })) as FeatureExtractionPipeline;
  setEmbedderForTest(stubEmbedder);
});

beforeEach(() => {
  const db = store.getDatabase();
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

    insertEntity({ id: 'entity-a', sourceProject: 'default', data: { name: 'alpha' } });
    insertEntity({ id: 'entity-b', sourceProject: 'default', data: { name: 'beta' } });

    vectorStore?.add(generateVectorKey('default', 'entity-a', ''), makeEmbedding(1));
    vectorStore?.add(generateVectorKey('default', 'entity-b', ''), makeEmbedding(0));
    vectorStore?.save();

    const results = await semanticSearch(
      store.getDatabase(),
      vectorStore as NonNullable<typeof vectorStore>,
      'query',
      null,
      2
    );

    expect(results[0]?.id).toBe('entity-a');
  });

  test('fallback to LIKE when vector search has no results', async () => {
    insertEntity({
      id: 'entity-like',
      sourceProject: 'default',
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
