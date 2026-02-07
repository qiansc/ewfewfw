import { describe, expect, test } from 'bun:test';
import { MongoAdapter } from '../server-adapter/mongo.js';
import { Neo4jAdapter } from '../server-adapter/neo4j.js';
import { MilvusAdapter } from '../server-adapter/milvus.js';
import { SyncWorker } from '../server-adapter/syncWorker.js';

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number = 1000,
  intervalMs: number = 25
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('timeout waiting for condition');
}

describe('SyncWorker', () => {
  test('processes pending tasks and updates status', async () => {
    const config = {
      url: 'http://localhost:8051',
      embedding: { provider: 'pseudo' as const, vectorDim: 16 },
    };
    const mongo = new MongoAdapter(config);
    const neo4j = new Neo4jAdapter(config);
    const milvus = new MilvusAdapter(config);

    await mongo.initialize();
    await neo4j.initialize();
    await milvus.initialize();

    const entity = await mongo.save({
      id: 'sync-worker-service',
      type: 'system',
      root_id: '@acme/sync',
      data: { id: 'sync-worker-service', type: 'system', title: 'Sync Worker Service' },
    });

    await mongo.enqueueSyncTasks([
      {
        task_type: 'graph_sync',
        target_store: 'neo4j',
        entity_uuid: entity.uuid ?? '',
        version: '0.0.0',
        operation: 'update',
      },
      {
        task_type: 'vector_sync',
        target_store: 'milvus',
        entity_uuid: entity.uuid ?? '',
        version: '0.0.0',
        operation: 'update',
      },
    ]);

    const worker = new SyncWorker(mongo, neo4j, milvus, { pollIntervalMs: 50, batchSize: 10 });
    worker.start();

    await waitFor(async () => {
      const status = await mongo.getSyncStatus();
      return status.pending_count === 0 && status.processing_count === 0;
    });

    const status = await mongo.getSyncStatus();
    expect(status.pending_count).toBe(0);
    expect(status.failed_count).toBe(0);
    expect(status.last_sync_at).not.toBeNull();

    await worker.stop();
    await milvus.close();
    await neo4j.close();
    await mongo.close();
  });
});
