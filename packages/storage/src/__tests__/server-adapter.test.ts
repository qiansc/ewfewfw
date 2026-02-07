import { afterEach, describe, expect, test } from 'bun:test';
import { ServerAdapter } from '../server-adapter.js';

const adapters: ServerAdapter[] = [];

afterEach(async () => {
  while (adapters.length > 0) {
    const adapter = adapters.pop();
    if (!adapter) continue;
    await adapter.close();
  }
});

describe('ServerAdapter legacy compatibility', () => {
  test('legacy save/read/list flow works with in-memory backend', async () => {
    const adapter = new ServerAdapter({
      url: 'http://localhost:8055',
      embedding: { provider: 'pseudo', vectorDim: 8 },
    });
    adapters.push(adapter);
    await adapter.initialize();

    const saveResult = await adapter.save({
      type: 'system',
      id: 'demo',
      root_id: '@acme/demo',
      content: 'id: demo\nname: Demo',
      format: 'yaml',
    });
    expect(saveResult.success).toBe(true);
    expect(saveResult.id).toBe('demo');

    const readResult = await adapter.read({
      id: 'demo',
      filter: { root_id: '@acme/demo' },
      format: 'object',
    });
    expect(readResult && 'entity' in readResult).toBe(true);
    if (readResult && 'entity' in readResult) {
      expect(readResult.entity?.id).toBe('demo');
    }

    const listResult = await adapter.list({
      root_id: '@acme/demo',
      type: 'system',
      limit: 10,
      offset: 0,
      filter: {},
    });
    const items = listResult.items ?? [];
    expect(items.length).toBe(1);
    expect(items[0]?.id).toBe('demo');
  });

  test('legacy read without id returns empty entity', async () => {
    const adapter = new ServerAdapter({
      url: 'http://localhost:8055',
      embedding: { provider: 'pseudo', vectorDim: 8 },
    });
    adapters.push(adapter);
    await adapter.initialize();

    const result = await adapter.read({ filter: { type: 'system' }, format: 'object' });
    expect(result && 'entity' in result).toBe(true);
    if (result && 'entity' in result) {
      expect(result.entity).toBeNull();
    }
  });
});
