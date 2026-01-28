import { describe, expect, test } from 'bun:test';
import { InMemoryGraph } from '../in-memory-graph.js';
import { GraphQueryCache } from '../graph-query-cache.js';
import { queryDeps } from '../lite-adapter/graph-operations.js';
import { toEntityCacheKey } from '../lite-adapter/cache-keys.js';
import type { AdapterContext } from '../lite-adapter/types.js';
import type { SQLiteStore } from '../sqlite-store.js';

function createContext(graph: InMemoryGraph, defaultProject = 'alpha'): AdapterContext {
  const store = {
    getDatabase: () => {
      throw new Error('Unexpected database access in graph-operations tests');
    },
  } as unknown as SQLiteStore;

  return {
    store,
    graph,
    cache: new GraphQueryCache(),
    config: {
      dbPath: 'memory',
      defaultProject,
      enableVectorSearch: false,
    },
  };
}

describe('graph-operations cache isolation', () => {
  test('queryDeps caches per source_project', async () => {
    const graph = new InMemoryGraph();
    graph.addRelation('alpha', 'svc', 'alpha', 'dep', 'depends_on');
    graph.addRelation('beta', 'svc', 'beta', 'other', 'depends_on');

    const ctx = createContext(graph);

    const alpha = await queryDeps(ctx, {
      id: 'svc',
      source_project: 'alpha',
      direction: 'downstream',
      depth: 1,
    });
    expect(alpha.map((node) => node.id)).toEqual(['dep']);

    const beta = await queryDeps(ctx, {
      id: 'svc',
      source_project: 'beta',
      direction: 'downstream',
      depth: 1,
    });
    expect(beta.map((node) => node.id)).toEqual(['other']);
  });

  test('project-scoped invalidation clears cached entry', async () => {
    const graph = new InMemoryGraph();
    graph.addRelation('alpha', 'svc', 'alpha', 'dep', 'depends_on');
    const ctx = createContext(graph);

    await queryDeps(ctx, {
      id: 'svc',
      source_project: 'alpha',
      direction: 'downstream',
      depth: 1,
    });

    const cacheKey = `deps:${toEntityCacheKey('alpha', 'svc')}:downstream:1:`;
    expect(ctx.cache.get(cacheKey)).not.toBeNull();

    ctx.cache.invalidate(toEntityCacheKey('alpha', 'svc'));
    expect(ctx.cache.get(cacheKey)).toBeNull();
  });
});
