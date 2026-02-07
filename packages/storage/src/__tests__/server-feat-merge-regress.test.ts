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

describe('Server feat lifecycle guard', () => {
  test('featLifecycle returns not implemented in server adapter', async () => {
    const adapter = new ServerAdapter({
      url: 'http://localhost:8055',
      embedding: { provider: 'pseudo', vectorDim: 8 },
    });
    adapters.push(adapter);
    await adapter.initialize();

    const result = await adapter.featLifecycle({
      action: 'create',
      feat_id: 'feat-regress',
      metadata: { title: 'feat-regress', description: '', created_by: 'tester' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('feat lifecycle not implemented');
  });
});
