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

describe('ServerAdapter integration', () => {
  test('health check returns ok with in-memory backends', async () => {
    const adapter = new ServerAdapter({
      url: 'http://localhost:8055',
      embedding: { provider: 'pseudo', vectorDim: 8 },
    });
    adapters.push(adapter);
    await adapter.initialize();
    const result = await adapter.healthCheck();
    expect(result).toBe(true);
  });
});
