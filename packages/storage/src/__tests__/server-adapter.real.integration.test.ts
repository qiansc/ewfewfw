import { afterAll, describe, expect, test } from 'bun:test';
import { ServerAdapter } from '../server-adapter.js';

const mongoUrl = process.env.C4A_TEST_MONGO_URL;
const neo4jUrl = process.env.C4A_TEST_NEO4J_URL;
const neo4jUser = process.env.C4A_TEST_NEO4J_USER;
const neo4jPassword = process.env.C4A_TEST_NEO4J_PASSWORD;
const milvusUrl = process.env.C4A_TEST_MILVUS_URL;
const milvusToken = process.env.C4A_TEST_MILVUS_TOKEN;
const ollamaUrl =
  process.env.C4A_TEST_OLLAMA_URL || process.env.STORAGE_OLLAMA_URL || process.env.OLLAMA_HOST;
const ollamaModel = process.env.C4A_TEST_OLLAMA_MODEL || process.env.OLLAMA_EMBEDDING_MODEL;

const enabled = Boolean(mongoUrl && neo4jUrl && milvusUrl && ollamaUrl);

const adapter = new ServerAdapter({
  url: 'http://localhost:8051',
  mongoUrl: mongoUrl ?? undefined,
  neo4jUrl: neo4jUrl ?? undefined,
  neo4jUser: neo4jUser ?? 'neo4j',
  neo4jPassword: neo4jPassword ?? 'password',
  milvusUrl: milvusUrl ?? undefined,
  milvusToken: milvusToken ?? undefined,
  embedding: {
    provider: 'ollama',
    baseUrl: ollamaUrl ?? undefined,
    model: ollamaModel ?? 'nomic-embed-text',
  },
});

afterAll(async () => {
  await adapter.close();
});

describe('ServerAdapter real backends', () => {
  test('crud/version/search/deps/impact against real services', async () => {
    if (!enabled) {
      expect(enabled).toBe(false);
      return;
    }
    await adapter.initialize();

    const a = await adapter.save({
      id: 'real-sys-a',
      type: 'system',
      root_id: '@acme/real',
      data: { id: 'real-sys-a', type: 'system', title: 'Real A' },
    });
    const b = await adapter.save({
      id: 'real-sys-b',
      type: 'system',
      root_id: '@acme/real',
      data: { id: 'real-sys-b', type: 'system', title: 'Real B' },
    });
    await adapter.save({
      id: 'real-sys-a',
      uuid: a.uuid,
      type: 'system',
      root_id: '@acme/real',
      versions: a.versions,
      data: {
        id: 'real-sys-a',
        type: 'system',
        title: 'Real A',
        relationships: [{ to_uuid: b.uuid, rel_type: 'DEPENDS_ON' }],
      },
    });

    const read = await adapter.read('@acme/real', 'real-sys-a');
    expect(read?.id).toBe('real-sys-a');
    const readByUuid = await adapter.readByUuid(a.uuid ?? '');
    expect(readByUuid?.uuid).toBe(a.uuid);

    const listed = await adapter.list({ root_id: '@acme/real', type: 'system' });
    expect(listed.length).toBeGreaterThanOrEqual(2);

    const added = await adapter.addVersion(a.uuid ?? '', '1.0.0');
    expect(added.versions?.includes('1.0.0')).toBe(true);

    const splitUuid = await adapter.splitEntity(a.uuid ?? '', '1.0.0', { title: 'Real A v1' });
    const split = await adapter.readByUuid(splitUuid);
    expect(split?.versions).toEqual(['1.0.0']);

    const addedSecond = await adapter.addVersion(a.uuid ?? '', '2.0.0');
    expect(addedSecond.versions?.includes('2.0.0')).toBe(true);
    const removedSecond = await adapter.removeVersion(a.uuid ?? '', '2.0.0');
    expect(removedSecond.versions?.includes('2.0.0')).toBe(false);

    const versionList = await adapter.listVersions('@acme/real');
    expect(versionList).toEqual(expect.arrayContaining(['0.0.0', '1.0.0']));

    const listByVersion = await adapter.list({ root_id: '@acme/real', version: '0.0.0' });
    expect(listByVersion.some((entity) => entity.id === 'real-sys-a')).toBe(true);

    const search = await adapter.search({
      query: 'Real A',
      root_id: '@acme/real',
      versions: ['0.0.0'],
      limit: 10,
    });
    expect(search.items.some((item) => item.id === 'real-sys-a')).toBe(true);

    const deps = await adapter.queryDeps({ uuid: a.uuid, direction: 'downstream', depth: 2 });
    expect(deps.nodes.some((node) => node.uuid === b.uuid)).toBe(true);

    const impact = await adapter.queryImpact({ uuid: a.uuid, depth: 2 });
    expect(impact.nodes.some((node) => node.uuid === b.uuid)).toBe(true);

    await adapter.delete(a.uuid ?? '');
    await adapter.delete(b.uuid ?? '');
    await adapter.delete(splitUuid);
  });
});
