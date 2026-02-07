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

describe('ServerAdapter direct adapters', () => {
  test('supports CRUD/version/search/deps/impact without extra backend', async () => {
    const adapter = new ServerAdapter({
      url: 'http://localhost:8051',
      embedding: { provider: 'pseudo', vectorDim: 16 },
    });
    adapters.push(adapter);
    await adapter.initialize();

    const service = await adapter.save({
      id: 'payment-service',
      type: 'system',
      root_id: '@acme/payments',
      data: {
        id: 'payment-service',
        type: 'system',
        title: 'Payment Service',
      },
    });

    const contract = await adapter.save({
      id: 'payment-contract',
      type: 'contract',
      root_id: '@acme/payments',
      data: {
        id: 'payment-contract',
        type: 'contract',
        title: 'Payment Contract',
      },
    });

    await adapter.save({
      id: 'payment-service',
      type: 'system',
      uuid: service.uuid,
      root_id: '@acme/payments',
      versions: service.versions,
      data: {
        id: 'payment-service',
        type: 'system',
        title: 'Payment Service',
        relationships: [{ to_uuid: contract.uuid, rel_type: 'DEPENDS_ON' }],
      },
    });

    const read = await adapter.read('@acme/payments', 'payment-service');
    expect(read?.uuid).toBe(service.uuid);

    const addedVersion = await adapter.addVersion(service.uuid ?? '', '1.0.0');
    expect(addedVersion.versions?.includes('1.0.0')).toBe(true);

    const splitUuid = await adapter.splitEntity(service.uuid ?? '', '1.0.0', {
      title: 'Payment Service V1',
    });
    const split = await adapter.readByUuid(splitUuid);
    expect(split?.versions).toEqual(['1.0.0']);

    const search = await adapter.search({
      query: 'payment',
      root_id: '@acme/payments',
    });
    expect(search.degraded).toBe(false);
    expect(search.items.length).toBeGreaterThan(0);

    const deps = await adapter.queryDeps({
      uuid: service.uuid,
      direction: 'downstream',
      depth: 2,
    });
    expect(deps.degraded).toBe(false);
    expect(deps.nodes.some((node) => node.uuid === contract.uuid)).toBe(true);

    const impact = await adapter.queryImpact({
      uuid: service.uuid,
      depth: 2,
    });
    expect(impact.degraded).toBe(false);
    expect(impact.nodes.some((node) => node.uuid === contract.uuid)).toBe(true);
  });

  test('migrateLegacyDataset migrates rows to v0.3.1 model', async () => {
    const adapter = new ServerAdapter({
      url: 'http://localhost:8051',
      embedding: { provider: 'pseudo', vectorDim: 16 },
    });
    adapter['config'].embedding = { provider: 'pseudo', vectorDim: 16 };
    adapters.push(adapter);
    await adapter.initialize();

    const result = await adapter.migrateLegacyDataset([
      {
        id: 'svc-a',
        type: 'system',
        root_id: 'alpha',
        requirement_id: null,
        version: '0.9.0',
        data: { id: 'svc-a', type: 'system', title: 'Legacy Service' },
      },
      {
        id: 'feat-login',
        type: 'feat',
        root_id: '',
        requirement_id: null,
        data: { id: 'feat-login', type: 'feat' },
      },
    ]);

    expect(result.migrated).toBe(2);
    expect(result.skipped).toBe(0);

    const list = await adapter.list({});
    expect(list.length).toBe(2);
    const svc = list.find((entity) => entity.id === 'svc-a');
    const feat = list.find((entity) => entity.id === 'feat-login');
    expect(svc?.root_id).toBe('alpha');
    expect(svc?.versions).toEqual(['0.9.0']);
    expect(feat?.root_id).toBe('');
    expect(feat?.versions).toEqual(['0.0.0']);
  });
});
