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

describe('Server mode integration (in-memory)', () => {
  test('sync/planSync/validate return stable results without backend services', async () => {
    const adapter = new ServerAdapter({
      url: 'http://localhost:8055',
      embedding: { provider: 'pseudo', vectorDim: 8 },
    });
    adapters.push(adapter);
    await adapter.initialize();

    const syncResult = await adapter.sync({ direction: 'export', path: '/tmp' });
    expect(syncResult.success).toBe(false);
    expect(syncResult.stats.failed).toBe(1);

    const plan = await adapter.planSync({ local_manifest: { files: [] } });
    expect(plan.plan.to_upload).toHaveLength(0);
    expect(plan.plan.to_download).toHaveLength(0);
    expect(plan.plan.conflicts).toHaveLength(0);

    const validateResult = await adapter.validate({});
    expect(validateResult.success).toBe(true);
  });
});
