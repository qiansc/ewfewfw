/**
 * SyncWorker - Server 模式异步同步任务执行器
 *
 * 负责轮询 sync_tasks，将实体变更同步到 Neo4j / Milvus。
 */

import type { MongoAdapter } from './mongo.js';
import type { Neo4jAdapter } from './neo4j.js';
import type { MilvusAdapter } from './milvus.js';

export type SyncTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type SyncTaskType = 'graph_sync' | 'vector_sync';
export type SyncTargetStore = 'neo4j' | 'milvus';
export type SyncOperation = 'create' | 'update' | 'delete';

export type SyncTask = {
  id: string;
  task_type: SyncTaskType;
  target_store: SyncTargetStore;
  entity_uuid: string;
  version: string;
  operation: SyncOperation;
  status: SyncTaskStatus;
  retry_count: number;
  max_retries: number;
  error_message?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
};

export type SyncStatus = {
  pending_count: number;
  failed_count: number;
  processing_count: number;
  last_sync_at: string | null;
  lag_seconds: number;
};

type WorkerOptions = {
  pollIntervalMs?: number;
  batchSize?: number;
};

export class SyncWorker {
  private readonly mongo: MongoAdapter;
  private readonly neo4j: Neo4jAdapter;
  private readonly milvus: MilvusAdapter;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private processing = false;

  constructor(
    mongo: MongoAdapter,
    neo4j: Neo4jAdapter,
    milvus: MilvusAdapter,
    options: WorkerOptions = {}
  ) {
    this.mongo = mongo;
    this.neo4j = neo4j;
    this.milvus = milvus;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.batchSize = options.batchSize ?? 100;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.waitForIdle();
  }

  isRunning(): boolean {
    return this.running;
  }

  private async waitForIdle(): Promise<void> {
    if (!this.processing) return;
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (!this.processing) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
    });
  }

  private async tick(): Promise<void> {
    if (!this.running || this.processing) return;
    this.processing = true;
    try {
      const tasks = await this.mongo.listSyncTasks(this.batchSize);
      for (const task of tasks) {
        await this.processTask(task);
      }
      await this.mongo.cleanupCompletedSyncTasks(7);
    } finally {
      this.processing = false;
    }
  }

  private async processTask(task: SyncTask): Promise<void> {
    const now = new Date().toISOString();
    await this.mongo.updateSyncTask(task.id, {
      status: 'processing',
      updated_at: now,
    });

    try {
      if (task.operation === 'delete') {
        await this.applyDelete(task);
      } else {
        await this.applyUpsert(task);
      }
      await this.mongo.updateSyncTask(task.id, {
        status: 'completed',
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.mongo.updateSyncTask(task.id, {
        status: 'failed',
        updated_at: new Date().toISOString(),
        error_message: message,
        retry_count: task.retry_count + 1,
      });
    }
  }

  private async applyDelete(task: SyncTask): Promise<void> {
    if (task.target_store === 'neo4j') {
      await this.neo4j.deleteEntity(task.entity_uuid);
      return;
    }
    if (task.target_store === 'milvus') {
      await this.milvus.deleteEntity(task.entity_uuid);
    }
  }

  private async applyUpsert(task: SyncTask): Promise<void> {
    const entity = await this.mongo.readByUuid(task.entity_uuid);
    if (!entity) {
      throw new Error(`C4A-SYNC-404: entity ${task.entity_uuid} not found`);
    }
    if (task.target_store === 'neo4j') {
      await this.neo4j.upsertEntity(entity);
      return;
    }
    if (task.target_store === 'milvus') {
      await this.milvus.upsertEntity(entity);
    }
  }
}
