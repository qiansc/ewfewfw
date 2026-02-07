/**
 * MongoAdapter (v0.3.1)
 *
 * - 配置 mongoUrl 时：使用 MongoDB 官方驱动直连
 * - 未配置 mongoUrl 时：使用内存存储（用于本地测试）
 */

import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { Collection } from 'mongodb';
import type {
  BackupParams,
  BackupResult,
  ChecklistParams,
  ChecklistResult,
  Entity,
  EntityFilter,
  EntityInput,
  FeatLifecycleParams,
  FeatLifecycleResult,
  FeatMergeParams,
  FeatMergeResult,
  SyncStatus,
  PlanSyncParams,
  PlanSyncResult,
  ReadHistoryParams,
  ReadHistoryResult,
  RepairParams,
  RepairResult,
  RestoreParams,
  RestoreResult,
  SaveOptions,
  SyncParams,
  SyncResult,
  UpdateWorkflowStepParams,
  UpdateWorkflowStepResult,
  ValidateParams,
  ValidateResult,
} from '../adapter.js';
import type { ServerConfig } from '../get-adapter.js';
import type { LegacyEntityRecord } from '../migrations/serverMigrate.js';
import { migrateLegacyEntities } from '../migrations/serverMigrate.js';
import { computeContentHash } from '@c4a/core';
import type { SyncTask } from './syncWorker.js';
import type { SyncOperation, SyncTargetStore, SyncTaskType } from './syncWorker.js';

type Stored = {
  entity: Entity;
};

type MongoEntityDocument = Entity & { _id?: string };
type MongoSyncTaskDocument = SyncTask & { _id?: string };

export type SyncTaskSeed = {
  task_type: SyncTaskType;
  target_store: SyncTargetStore;
  entity_uuid: string;
  version: string;
  operation: SyncOperation;
};

function ensureEntity(input: EntityInput): Entity {
  const now = new Date().toISOString();
  const versions = input.versions && input.versions.length > 0 ? input.versions : ['0.0.0'];
  const computedHash =
    input.metadata?.content_hash ?? (input.data ? computeContentHash(input.data) : undefined);
  return {
    ...input,
    uuid: input.uuid ?? randomUUID(),
    root_id: input.root_id ?? '',
    versions,
    metadata: {
      status: input.metadata?.status ?? 'published',
      content_hash: computedHash,
      created_at: input.metadata?.created_at ?? now,
      updated_at: now,
      created_by: input.metadata?.created_by,
      updated_by: input.metadata?.updated_by,
      source_repo: input.metadata?.source_repo,
      external_url: input.metadata?.external_url,
    },
  };
}

function toMongoFilter(filter: EntityFilter): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (filter.root_id !== undefined) query.root_id = filter.root_id;
  if (filter.id) query.id = filter.id;
  if (filter.requirement_id) query.requirement_id = filter.requirement_id;
  if (filter.type) query.type = Array.isArray(filter.type) ? { $in: filter.type } : filter.type;
  if (filter.version) query.versions = filter.version;
  return query;
}

function fromMongoDoc(doc: MongoEntityDocument | null): Entity | null {
  if (!doc) return null;
  const { _id, ...entity } = doc;
  void _id;
  return entity;
}

function isStandaloneTransactionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { code?: number; message?: string };
  if (maybe.code === 20) return true;
  return typeof maybe.message === 'string' && maybe.message.includes('Transaction numbers are only allowed');
}

export class MongoAdapter {
  private config: ServerConfig;
  private memoryStore: Map<string, Stored> = new Map();
  private memorySyncTasks: Map<string, SyncTask> = new Map();
  private client: MongoClient | null = null;
  private entitiesCollection: Collection<MongoEntityDocument> | null = null;
  private syncTasksCollection: Collection<MongoSyncTaskDocument> | null = null;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (!this.config.mongoUrl) {
      return;
    }

    if (this.client) {
      return;
    }

    this.client = new MongoClient(this.config.mongoUrl);
    await this.client.connect();

    const dbName = this.resolveDbName(this.config.mongoUrl);
    const db = this.client.db(dbName);

    const entitiesExists = await db
      .listCollections({ name: 'entities' }, { nameOnly: true })
      .hasNext();
    if (!entitiesExists) {
      await db.createCollection('entities');
    }

    this.entitiesCollection = db.collection<MongoEntityDocument>('entities');
    const syncTasksExists = await db
      .listCollections({ name: 'sync_tasks' }, { nameOnly: true })
      .hasNext();
    if (!syncTasksExists) {
      await db.createCollection('sync_tasks');
    }
    this.syncTasksCollection = db.collection<MongoSyncTaskDocument>('sync_tasks');

    await this.normalizeLegacyDocuments();
    await this.dropLegacyIndexes();
    await this.entitiesCollection.createIndex(
      { uuid: 1 },
      { unique: true, partialFilterExpression: { uuid: { $type: 'string' } } }
    );
    await this.entitiesCollection.createIndex({ root_id: 1, id: 1 });
    await this.entitiesCollection.createIndex({ requirement_id: 1 });
    await this.entitiesCollection.createIndex({ versions: 1 });

    await this.syncTasksCollection.createIndex({ status: 1, created_at: 1 });
    await this.syncTasksCollection.createIndex({ entity_uuid: 1 });
  }

  async close(): Promise<void> {
    this.memoryStore.clear();
    this.memorySyncTasks.clear();
    this.entitiesCollection = null;
    this.syncTasksCollection = null;
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.client || !this.entitiesCollection) {
      return true;
    }
    try {
      await this.client.db().command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async save(entity: EntityInput, _options?: SaveOptions): Promise<Entity> {
    const saved = ensureEntity(entity);

    if (!this.entitiesCollection) {
      this.memoryStore.set(saved.uuid ?? randomUUID(), { entity: saved });
      return saved;
    }

    await this.entitiesCollection.deleteMany({
      id: saved.id,
      root_id: saved.root_id,
      requirement_id: saved.requirement_id ?? null,
      uuid: { $ne: saved.uuid },
    } as Record<string, unknown>);

    await this.entitiesCollection.updateOne(
      { uuid: saved.uuid },
      { $set: saved },
      { upsert: true }
    );
    return saved;
  }

  async read(rootId: string, id: string, version?: string): Promise<Entity | null> {
    if (!this.entitiesCollection) {
      const targetVersion = version ?? '0.0.0';
      for (const stored of this.memoryStore.values()) {
        if (stored.entity.root_id === rootId && stored.entity.id === id) {
          if ((stored.entity.versions ?? []).includes(targetVersion)) {
            return stored.entity;
          }
        }
      }
      return null;
    }

    const query: Record<string, unknown> = { root_id: rootId, id };
    if (version) {
      query.versions = version;
    }
    const doc = await this.entitiesCollection.findOne(query);
    return fromMongoDoc(doc);
  }

  async readByUuid(uuid: string): Promise<Entity | null> {
    if (!this.entitiesCollection) {
      return this.memoryStore.get(uuid)?.entity ?? null;
    }
    return fromMongoDoc(await this.entitiesCollection.findOne({ uuid }));
  }

  async list(filter: EntityFilter): Promise<Entity[]> {
    if (!this.entitiesCollection) {
      const items: Entity[] = [];
      for (const stored of this.memoryStore.values()) {
        const entity = stored.entity;
        if (filter.root_id !== undefined && entity.root_id !== filter.root_id) continue;
        if (filter.id && entity.id !== filter.id) continue;
        if (filter.requirement_id && entity.requirement_id !== filter.requirement_id) continue;
        if (filter.type) {
          if (Array.isArray(filter.type)) {
            if (!filter.type.includes(entity.type)) continue;
          } else if (entity.type !== filter.type) {
            continue;
          }
        }
        if (filter.version && !(entity.versions ?? []).includes(filter.version)) continue;
        items.push(entity);
      }
      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? items.length;
      return items.slice(offset, offset + limit);
    }

    const cursor = this.entitiesCollection
      .find(toMongoFilter(filter))
      .skip(filter.offset ?? 0)
      .limit(filter.limit ?? 1000);
    const docs = await cursor.toArray();
    return docs
      .map((doc: MongoEntityDocument) => fromMongoDoc(doc))
      .filter((entity: Entity | null): entity is Entity => !!entity);
  }

  async listByUuids(
    uuids: string[],
    filter?: {
      root_id?: string;
      requirement_id?: string;
      type?: string;
      versions?: string[];
    }
  ): Promise<Entity[]> {
    if (uuids.length === 0) return [];
    if (!this.entitiesCollection) {
      const items: Entity[] = [];
      for (const stored of this.memoryStore.values()) {
        const entity = stored.entity;
        if (!uuids.includes(entity.uuid ?? '')) continue;
        if (filter?.root_id && entity.root_id !== filter.root_id) continue;
        if (filter?.requirement_id && entity.requirement_id !== filter.requirement_id) continue;
        if (filter?.type && entity.type !== filter.type) continue;
        if (filter?.versions && filter.versions.length > 0) {
          const versions = entity.versions ?? [];
          if (!filter.versions.some((version) => versions.includes(version))) continue;
        }
        items.push(entity);
      }
      return items;
    }

    const query: Record<string, unknown> = { uuid: { $in: uuids } };
    if (filter?.root_id !== undefined) query.root_id = filter.root_id;
    if (filter?.requirement_id !== undefined) query.requirement_id = filter.requirement_id;
    if (filter?.type) query.type = filter.type;
    if (filter?.versions && filter.versions.length > 0) {
      query.versions = { $in: filter.versions };
    }
    const docs = await this.entitiesCollection.find(query).toArray();
    return docs
      .map((doc: MongoEntityDocument) => fromMongoDoc(doc))
      .filter((entity: Entity | null): entity is Entity => !!entity);
  }

  async delete(uuid: string): Promise<void> {
    if (!this.entitiesCollection) {
      this.memoryStore.delete(uuid);
      return;
    }
    await this.entitiesCollection.deleteOne({ uuid });
  }

  async addVersion(uuid: string, version: string): Promise<Entity> {
    if (!this.entitiesCollection) {
      const stored = this.memoryStore.get(uuid);
      if (!stored) throw new Error('C4A-ENTITY-404');
      const versions = new Set(stored.entity.versions ?? []);
      versions.add(version);
      stored.entity.versions = Array.from(versions);
      return stored.entity;
    }

    const updated = await this.entitiesCollection.findOneAndUpdate(
      { uuid },
      { $addToSet: { versions: version }, $set: { 'metadata.updated_at': new Date().toISOString() } },
      { returnDocument: 'after' }
    );
    const entity = fromMongoDoc(updated);
    if (!entity) throw new Error('C4A-ENTITY-404');
    return entity;
  }

  async removeVersion(uuid: string, version: string): Promise<Entity> {
    if (!this.entitiesCollection) {
      const stored = this.memoryStore.get(uuid);
      if (!stored) throw new Error('C4A-ENTITY-404');
      stored.entity.versions = (stored.entity.versions ?? []).filter((item) => item !== version);
      if ((stored.entity.versions ?? []).length === 0) {
        this.memoryStore.delete(uuid);
        throw new Error('C4A-ENTITY-404');
      }
      return stored.entity;
    }

    const updated = await this.entitiesCollection.findOneAndUpdate(
      { uuid },
      { $pull: { versions: version }, $set: { 'metadata.updated_at': new Date().toISOString() } },
      { returnDocument: 'after' }
    );
    const entity = fromMongoDoc(updated);
    if (!entity) throw new Error('C4A-ENTITY-404');
    if ((entity.versions ?? []).length === 0) {
      await this.entitiesCollection.deleteOne({ uuid });
      throw new Error('C4A-ENTITY-404');
    }
    return entity;
  }

  async splitEntity(uuid: string, version: string, newData: Record<string, unknown>): Promise<string> {
    if (!this.entitiesCollection) {
      const stored = this.memoryStore.get(uuid);
      if (!stored) throw new Error('C4A-ENTITY-404');
      if (!(stored.entity.versions ?? []).includes(version)) {
        throw new Error('C4A-VERSION-003');
      }
      const newUuid = randomUUID();
      stored.entity.versions = (stored.entity.versions ?? []).filter((item) => item !== version);
      const newEntity: Entity = {
        ...stored.entity,
        uuid: newUuid,
        versions: [version],
        data: { ...(stored.entity.data ?? {}), ...(newData ?? {}) },
        metadata: { ...stored.entity.metadata, updated_at: new Date().toISOString() },
      };
      this.memoryStore.set(newUuid, { entity: newEntity });
      return newUuid;
    }

    const session = this.client?.startSession();
    const collection = this.entitiesCollection;
    if (!session) {
      throw new Error('C4A-TX-001');
    }
    if (!collection) {
      throw new Error('C4A-TX-001');
    }

    let newUuid = '';
    try {
      await session.withTransaction(async () => {
        const current = fromMongoDoc(await collection.findOne({ uuid }, { session }));
        if (!current) throw new Error('C4A-ENTITY-404');
        if (!(current.versions ?? []).includes(version)) {
          throw new Error('C4A-VERSION-003');
        }

        await collection.updateOne(
          { uuid },
          { $pull: { versions: version }, $set: { 'metadata.updated_at': new Date().toISOString() } },
          { session }
        );

        newUuid = randomUUID();
        const next: Entity = {
          ...current,
          uuid: newUuid,
          versions: [version],
          data: { ...(current.data ?? {}), ...(newData ?? {}) },
          metadata: { ...current.metadata, updated_at: new Date().toISOString() },
        };
        await collection.insertOne(next, { session });
      });
    } catch (error) {
      if (!isStandaloneTransactionError(error)) {
        throw error;
      }
      const current = fromMongoDoc(await collection.findOne({ uuid }));
      if (!current) throw new Error('C4A-ENTITY-404');
      if (!(current.versions ?? []).includes(version)) {
        throw new Error('C4A-VERSION-003');
      }

      await collection.updateOne(
        { uuid },
        { $pull: { versions: version }, $set: { 'metadata.updated_at': new Date().toISOString() } }
      );

      newUuid = randomUUID();
      const next: Entity = {
        ...current,
        uuid: newUuid,
        versions: [version],
        data: { ...(current.data ?? {}), ...(newData ?? {}) },
        metadata: { ...current.metadata, updated_at: new Date().toISOString() },
      };
      await collection.insertOne(next);
    }
    await session.endSession();
    return newUuid;
  }

  async listVersions(rootId: string): Promise<string[]> {
    if (!this.entitiesCollection) {
      const versions = new Set<string>();
      for (const stored of this.memoryStore.values()) {
        if (stored.entity.root_id !== rootId) continue;
        for (const v of stored.entity.versions ?? []) {
          versions.add(v);
        }
      }
      return Array.from(versions).sort();
    }

    const versions = new Set<string>();
    const cursor = this.entitiesCollection.find({ root_id: rootId }, { projection: { versions: 1 } });
    const docs = await cursor.toArray();
    for (const doc of docs) {
      for (const v of doc.versions ?? []) {
        versions.add(v);
      }
    }
    return Array.from(versions).sort();
  }

  async enqueueSyncTasks(seeds: SyncTaskSeed[], maxRetries: number = 3): Promise<SyncTask[]> {
    const now = new Date().toISOString();
    const tasks: SyncTask[] = seeds.map((seed) => ({
      id: randomUUID(),
      task_type: seed.task_type,
      target_store: seed.target_store,
      entity_uuid: seed.entity_uuid,
      version: seed.version,
      operation: seed.operation,
      status: 'pending',
      retry_count: 0,
      max_retries: maxRetries,
      created_at: now,
      updated_at: now,
      completed_at: null,
    }));

    if (!this.syncTasksCollection) {
      for (const task of tasks) {
        this.memorySyncTasks.set(task.id, task);
      }
      return tasks;
    }

    if (tasks.length > 0) {
      await this.syncTasksCollection.insertMany(tasks);
    }
    return tasks;
  }

  async listSyncTasks(limit: number): Promise<SyncTask[]> {
    const maxRetries = 3;
    if (!this.syncTasksCollection) {
      const tasks = Array.from(this.memorySyncTasks.values())
        .filter((task) =>
          (task.status === 'pending' || task.status === 'failed') &&
          task.retry_count < task.max_retries
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      return tasks.slice(0, limit);
    }

    const cursor = this.syncTasksCollection
      .find({
        status: { $in: ['pending', 'failed'] },
        retry_count: { $lt: maxRetries },
      })
      .sort({ created_at: 1 })
      .limit(limit);
    const docs = await cursor.toArray();
    return docs.map((doc) => {
      const { _id, ...task } = doc;
      void _id;
      return task;
    });
  }

  async updateSyncTask(id: string, updates: Partial<SyncTask>): Promise<void> {
    if (!this.syncTasksCollection) {
      const task = this.memorySyncTasks.get(id);
      if (!task) return;
      this.memorySyncTasks.set(id, { ...task, ...updates });
      return;
    }
    await this.syncTasksCollection.updateOne({ id }, { $set: updates });
  }

  async cleanupCompletedSyncTasks(retentionDays: number): Promise<void> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    if (!this.syncTasksCollection) {
      for (const [id, task] of this.memorySyncTasks.entries()) {
        if (task.status === 'completed' && (task.completed_at ?? '') < cutoff) {
          this.memorySyncTasks.delete(id);
        }
      }
      return;
    }
    await this.syncTasksCollection.deleteMany({
      status: 'completed',
      completed_at: { $lt: cutoff },
    });
  }

  async getSyncStatus(): Promise<SyncStatus> {
    if (!this.syncTasksCollection) {
      const tasks = Array.from(this.memorySyncTasks.values());
      return buildSyncStatusFromTasks(tasks);
    }

    const [pendingCount, failedCount, processingCount] = await Promise.all([
      this.syncTasksCollection.countDocuments({ status: 'pending' }),
      this.syncTasksCollection.countDocuments({ status: 'failed' }),
      this.syncTasksCollection.countDocuments({ status: 'processing' }),
    ]);

    const lastCompleted = await this.syncTasksCollection
      .find({ status: 'completed', completed_at: { $ne: null } })
      .sort({ completed_at: -1 })
      .limit(1)
      .toArray();
    const lastSyncAt = lastCompleted[0]?.completed_at ?? null;

    const oldestPending = await this.syncTasksCollection
      .find({ status: 'pending' })
      .sort({ created_at: 1 })
      .limit(1)
      .toArray();
    const oldestFailed = await this.syncTasksCollection
      .find({ status: 'failed' })
      .sort({ updated_at: 1 })
      .limit(1)
      .toArray();

    const lagSeconds = computeLagSeconds({
      pending: oldestPending[0]?.created_at,
      failed: oldestFailed[0]?.updated_at,
    });

    return {
      pending_count: pendingCount,
      failed_count: failedCount,
      processing_count: processingCount,
      last_sync_at: lastSyncAt,
      lag_seconds: lagSeconds,
    };
  }

  async sync(_params: SyncParams): Promise<SyncResult> {
    return {
      success: false,
      stats: { scanned: 0, created: 0, updated: 0, skipped: 0, conflicted: 0, failed: 1 },
      details: [],
      conflicts: [],
    };
  }

  async planSync(_params: PlanSyncParams): Promise<PlanSyncResult> {
    return {
      plan: {
        to_upload: [],
        to_download: [],
        to_delete_local: [],
        to_delete_remote: [],
        conflicts: [],
        unchanged: [],
      },
    };
  }

  async featLifecycle(_params: FeatLifecycleParams): Promise<FeatLifecycleResult> {
    return { success: false, feat_id: '', error: 'feat lifecycle not implemented' };
  }

  async featMerge(_params: FeatMergeParams): Promise<FeatMergeResult> {
    return { success: false, merged: [], conflicts: [] };
  }

  async featChecklist(_params: ChecklistParams): Promise<ChecklistResult> {
    return { success: false, feat_id: '' };
  }

  async updateWorkflowStep(_params: UpdateWorkflowStepParams): Promise<UpdateWorkflowStepResult> {
    return { success: false, feat_id: _params.feat_id, step_id: _params.step_id };
  }

  async readHistory(_params: ReadHistoryParams): Promise<ReadHistoryResult> {
    return { success: true, items: [], total: 0 };
  }

  async backup(_params: BackupParams): Promise<BackupResult> {
    return { success: false, error: 'backup not implemented' };
  }

  async restore(_params: RestoreParams): Promise<RestoreResult> {
    return { success: false, error: 'restore not implemented' };
  }

  async repair(_params: RepairParams): Promise<RepairResult> {
    return { success: false, scanned: 0, inconsistencies: [] };
  }

  async validate(_params: ValidateParams): Promise<ValidateResult> {
    return { success: true };
  }

  async transaction<T>(fn: (adapter: MongoAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async migrateLegacyDataset(
    rows: LegacyEntityRecord[]
  ): Promise<{ migrated: number; skipped: number; uuids: Map<string, string> }> {
    const result = migrateLegacyEntities(rows);
    for (const entity of result.entities) {
      await this.save(entity);
    }
    return {
      migrated: result.entities.length,
      skipped: result.skipped,
      uuids: result.legacyKeyToUuid,
    };
  }

  private resolveDbName(url: string): string {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.replace(/^\//, '');
      return pathname.length > 0 ? pathname : 'c4a';
    } catch {
      return 'c4a';
    }
  }

  private async normalizeLegacyDocuments(): Promise<void> {
    if (!this.entitiesCollection) {
      return;
    }

    const cursor = this.entitiesCollection.find(
      { $or: [{ uuid: { $exists: false } }, { uuid: { $type: 'null' } }] } as Record<string, unknown>,
      { projection: { _id: 1 } }
    );
    const ops: Array<Parameters<typeof this.entitiesCollection.bulkWrite>[0][number]> = [];
    for await (const doc of cursor) {
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { uuid: randomUUID() } },
        },
      });
    }
    if (ops.length > 0) {
      await this.entitiesCollection.bulkWrite(ops);
    }

    const legacyCursor = this.entitiesCollection.find(
      {
        $or: [
          { root_id: { $exists: false } },
          { root_id: { $type: 'null' } },
          { versions: { $exists: false } },
          { versions: { $type: 'null' } },
        ],
      } as Record<string, unknown>,
      { projection: { _id: 1, type: 1, root_id: 1, version: 1 } }
    );
    const normalizeOps: Array<Parameters<typeof this.entitiesCollection.bulkWrite>[0][number]> = [];
    for await (const doc of legacyCursor) {
      const legacyDoc = doc as Record<string, unknown>;
      const entityType = String(legacyDoc.type ?? '');
      const rootId =
        entityType === 'feat' || entityType === 'checklist'
          ? ''
          : String(legacyDoc.root_id ?? '');
      const versions =
        typeof legacyDoc.version === 'string' && legacyDoc.version.length > 0
          ? [legacyDoc.version]
          : ['0.0.0'];
      normalizeOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: { root_id: rootId, versions },
            $unset: { root_id: '', version: '' },
          },
        },
      });
    }
    if (normalizeOps.length > 0) {
      await this.entitiesCollection.bulkWrite(normalizeOps);
    }
  }

  private async dropLegacyIndexes(): Promise<void> {
    if (!this.entitiesCollection) {
      return;
    }
    const indexes = await this.entitiesCollection.indexes();
    for (const index of indexes) {
      if (!index.name || index.name === '_id_') continue;
      const keys = Object.keys(index.key ?? {});
      if (keys.includes('root_id') || keys.includes('requirement_id')) {
        try {
          await this.entitiesCollection.dropIndex(index.name);
        } catch {
          // ignore legacy index drop failure
        }
      }
    }
  }
}

function computeLagSeconds(input: { pending?: string; failed?: string }): number {
  const now = Date.now();
  const candidate = input.pending ?? input.failed;
  if (!candidate) return 0;
  const parsed = Date.parse(candidate);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.floor((now - parsed) / 1000));
}

function buildSyncStatusFromTasks(tasks: SyncTask[]): SyncStatus {
  const pending = tasks.filter((task) => task.status === 'pending');
  const failed = tasks.filter((task) => task.status === 'failed');
  const processing = tasks.filter((task) => task.status === 'processing');
  const completed = tasks
    .filter((task) => task.status === 'completed' && task.completed_at)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const lastSyncAt = completed[0]?.completed_at ?? null;
  const oldestPending = pending.sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  const oldestFailed = failed.sort((a, b) => a.updated_at.localeCompare(b.updated_at))[0];
  return {
    pending_count: pending.length,
    failed_count: failed.length,
    processing_count: processing.length,
    last_sync_at: lastSyncAt,
    lag_seconds: computeLagSeconds({
      pending: oldestPending?.created_at,
      failed: oldestFailed?.updated_at,
    }),
  };
}
