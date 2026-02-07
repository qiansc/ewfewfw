/**
 * ServerAdapter - Server 模式存储适配器 (v0.3.1)
 *
 * 直连 MongoDB / Neo4j / Milvus 的占位实现。
 * 若未配置连接信息，将抛出错误提示。
 */

import type {
  StorageAdapter,
  Entity,
  EntityFilter,
  EntityInput,
  SaveOptions,
  SyncParams,
  SyncResult,
  PlanSyncParams,
  PlanSyncResult,
  SyncStatus,
  SearchParams,
  SearchResult,
  DepsParams,
  DepsResult,
  ImpactParams,
  ImpactResult,
  FeatLifecycleParams,
  FeatLifecycleResult,
  FeatMergeParams,
  FeatMergeResult,
  ChecklistParams,
  ChecklistResult,
  UpdateWorkflowStepParams,
  UpdateWorkflowStepResult,
  ReadHistoryParams,
  ReadHistoryResult,
  BackupParams,
  BackupResult,
  RestoreParams,
  RestoreResult,
  RepairParams,
  RepairResult,
  ValidateParams,
  ValidateResult,
  SaveParams,
  LegacySaveResult,
  ReadParams,
  ReadResultObject,
  ReadResultString,
  ListParams,
  LegacyListResult,
  DeleteParams,
} from './adapter.js';
import type { ServerConfig } from './get-adapter.js';
import { MongoAdapter } from './server-adapter/mongo.js';
import { Neo4jAdapter } from './server-adapter/neo4j.js';
import { MilvusAdapter } from './server-adapter/milvus.js';
import { SyncWorker } from './server-adapter/syncWorker.js';
import { formatContent, normalizeRequirementId, parseContent } from './lite-adapter/helpers.js';
import type { LegacyEntityRecord } from './migrations/serverMigrate.js';
import type { SyncOperation } from './server-adapter/syncWorker.js';

function isLegacySaveParams(input: EntityInput | SaveParams): input is SaveParams {
  return (
    typeof (input as SaveParams).type === 'string' &&
    ('content' in input || 'format' in input || 'force_save' in input || 'enforce_adr' in input || 'skip_adr_check' in input)
  );
}

function isLegacyReadParams(input: string | ReadParams): input is ReadParams {
  return typeof input === 'object' && input !== null;
}

function isLegacyListParams(input: EntityFilter | ListParams): input is ListParams {
  return (
    (input as ListParams).status !== undefined ||
    (input as ListParams).group_by !== undefined ||
    (input as ListParams).count_only !== undefined ||
    (input as ListParams).filter !== undefined ||
    (input as ListParams).updated_after !== undefined
  );
}

function toEntityInputFromLegacy(params: SaveParams): EntityInput {
  let data: Record<string, unknown> = {};
  if (params.content) {
    data = parseContent(params.content, params.format ?? 'yaml');
  } else if (params.data && typeof params.data === 'object') {
    data = params.data;
  }
  const id = params.id ?? (typeof data.id === 'string' ? data.id : undefined);
  if (!id) {
    throw new Error('C4A-STORE-INPUT-001: missing id');
  }
  return {
    id,
    type: params.type,
    data,
    root_id: params.root_id ?? '',
    requirement_id: params.requirement_id ?? undefined,
  };
}

function buildLegacySaveResult(entity: Entity): LegacySaveResult {
  return {
    success: true,
    id: entity.id,
    status: entity.metadata.status,
    content_hash: entity.metadata.content_hash ?? '',
  };
}

export class ServerAdapter implements StorageAdapter {
  private config: ServerConfig;
  private mongo: MongoAdapter;
  private neo4j: Neo4jAdapter;
  private milvus: MilvusAdapter;
  private syncWorker: SyncWorker | null = null;
  private initialized = false;

  constructor(config: ServerConfig) {
    this.config = config;
    this.mongo = new MongoAdapter(config);
    this.neo4j = new Neo4jAdapter(config);
    this.milvus = new MilvusAdapter(config);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.mongo.initialize();
    await this.neo4j.initialize();
    await this.milvus.initialize();
    this.startSyncWorker();
    this.initialized = true;
  }

  async close(): Promise<void> {
    await this.stopSyncWorker();
    await this.mongo.close();
    await this.neo4j.close();
    await this.milvus.close();
    this.initialized = false;
  }

  async healthCheck(): Promise<boolean> {
    const mongo = await this.mongo.healthCheck();
    const neo4j = await this.neo4j.healthCheck();
    const milvus = await this.milvus.healthCheck();
    return mongo && neo4j && milvus;
  }

  async save(entity: EntityInput, options?: SaveOptions): Promise<Entity>;
  async save(params: SaveParams): Promise<LegacySaveResult>;
  async save(
    entityOrParams: EntityInput | SaveParams,
    options?: SaveOptions
  ): Promise<Entity | LegacySaveResult> {
    if (isLegacySaveParams(entityOrParams)) {
      try {
        const input = toEntityInputFromLegacy(entityOrParams);
        const saved = await this.mongo.save(input, { force: entityOrParams.force_save ?? false });
        await this.neo4j.upsertEntity(saved);
        await this.milvus.upsertEntity(saved);
        await this.enqueueSyncTasksForEntity(saved, 'update');
        return buildLegacySaveResult(saved);
      } catch (error) {
        return {
          success: false,
          id: entityOrParams.id ?? '',
          status: 'draft',
          content_hash: '',
          error: {
            code: 'C4A-STORE-SAVE-LEGACY',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
    const saved = await this.mongo.save(entityOrParams, options);
    await this.neo4j.upsertEntity(saved);
    await this.milvus.upsertEntity(saved);
    await this.enqueueSyncTasksForEntity(saved, 'update');
    return saved;
  }

  async read(rootId: string, id: string, version?: string): Promise<Entity | null>;
  async read(params: ReadParams): Promise<ReadResultObject | ReadResultString | null>;
  async read(
    rootIdOrParams: string | ReadParams,
    id?: string,
    version?: string
  ): Promise<Entity | ReadResultObject | ReadResultString | null> {
    if (isLegacyReadParams(rootIdOrParams)) {
      const params = rootIdOrParams;
      if (!params.id) {
        return params.format === 'object' || !params.format ? { entity: null } : null;
      }
      const requirementId = normalizeRequirementId(params.requirement_id);
      const rootId = (params.filter as { root_id?: string } | undefined)?.root_id;
      const candidates = await this.mongo.list({
        id: params.id,
        root_id: rootId,
        requirement_id: requirementId ?? undefined,
        version: (params.filter as { version?: string } | undefined)?.version,
        limit: 1,
      });
      const entity = candidates[0] ?? null;
      if (!entity) {
        return { entity: null };
      }
      if (params.format && params.format !== 'object') {
        return {
          id: entity.id,
          type: entity.type,
          status: entity.metadata.status,
          content: formatContent(entity.data, params.format),
          format: params.format,
        };
      }
      return { entity, relations: [] };
    }
    if (!id) return null;
    return this.mongo.read(rootIdOrParams, id, version);
  }

  async readByUuid(uuid: string): Promise<Entity | null> {
    return this.mongo.readByUuid(uuid);
  }

  async list(filter: EntityFilter): Promise<Entity[]>;
  async list(params: ListParams): Promise<LegacyListResult>;
  async list(filterOrParams: EntityFilter | ListParams): Promise<Entity[] | LegacyListResult> {
    if (isLegacyListParams(filterOrParams)) {
      const params = filterOrParams;
      const entities = await this.mongo.list({
        root_id: params.root_id,
        type: params.type && params.type !== 'all' ? params.type : undefined,
        requirement_id: params.requirement_id ?? undefined,
        limit: params.limit,
        offset: params.offset,
      });
      let filtered = entities;
      if (params.status) {
        filtered = filtered.filter((entity) => entity.metadata.status === params.status);
      }
      const updatedAfter = params.updated_after;
      if (updatedAfter) {
        filtered = filtered.filter((entity) => entity.metadata.updated_at > updatedAfter);
      }
      const items = filtered.map((entity) => ({
        id: entity.id,
        type: entity.type,
        status: entity.metadata.status,
        updated_at: entity.metadata.updated_at,
        content_hash: entity.metadata.content_hash ?? '',
        root_id: entity.root_id ?? '',
        requirement_id: entity.requirement_id ?? null,
      }));
      const offset = params.offset ?? 0;
      const limit = params.limit ?? items.length;
      return {
        items,
        pagination: {
          total: items.length,
          offset,
          limit,
          has_more: offset + limit < items.length,
        },
        total: items.length,
      };
    }
    return this.mongo.list(filterOrParams);
  }

  async delete(uuid: string): Promise<void>;
  async delete(params: DeleteParams): Promise<void>;
  async delete(uuidOrParams: string | DeleteParams): Promise<void> {
    if (typeof uuidOrParams === 'string') {
      await this.mongo.delete(uuidOrParams);
      await this.neo4j.deleteEntity(uuidOrParams);
      await this.milvus.deleteEntity(uuidOrParams);
      await this.enqueueSyncTasksForDeletion(uuidOrParams);
      return;
    }
    const candidates = await this.mongo.list({
      id: uuidOrParams.id,
      requirement_id: uuidOrParams.requirement_id ?? undefined,
      limit: 1,
    });
    if (candidates[0]?.uuid) {
      await this.mongo.delete(candidates[0].uuid);
      await this.neo4j.deleteEntity(candidates[0].uuid);
      await this.milvus.deleteEntity(candidates[0].uuid);
      await this.enqueueSyncTasksForDeletion(candidates[0].uuid);
    }
  }

  async addVersion(uuid: string, version: string): Promise<Entity> {
    const entity = await this.mongo.addVersion(uuid, version);
    await this.neo4j.upsertEntity(entity);
    await this.milvus.upsertEntity(entity);
    await this.enqueueSyncTasksForEntity(entity, 'update', version);
    return entity;
  }

  async removeVersion(uuid: string, version: string): Promise<Entity> {
    try {
      const entity = await this.mongo.removeVersion(uuid, version);
      await this.neo4j.upsertEntity(entity);
      await this.milvus.upsertEntity(entity);
      await this.enqueueSyncTasksForEntity(entity, 'update', version);
      return entity;
    } catch (error) {
      await this.neo4j.deleteEntity(uuid);
      await this.milvus.deleteEntity(uuid);
      await this.enqueueSyncTasksForDeletion(uuid);
      throw error;
    }
  }

  async splitEntity(uuid: string, version: string, newData: Record<string, unknown>): Promise<string> {
    const newUuid = await this.mongo.splitEntity(uuid, version, newData);
    const oldEntity = await this.mongo.readByUuid(uuid);
    if (oldEntity) {
      await this.neo4j.upsertEntity(oldEntity);
      await this.milvus.upsertEntity(oldEntity);
      await this.enqueueSyncTasksForEntity(oldEntity, 'update', version);
    } else {
      await this.neo4j.deleteEntity(uuid);
      await this.milvus.deleteEntity(uuid);
      await this.enqueueSyncTasksForDeletion(uuid);
    }
    const newEntity = await this.mongo.readByUuid(newUuid);
    if (newEntity) {
      await this.neo4j.upsertEntity(newEntity);
      await this.milvus.upsertEntity(newEntity);
      await this.enqueueSyncTasksForEntity(newEntity, 'create', version);
    }
    return newUuid;
  }

  async listVersions(rootId: string): Promise<string[]> {
    return this.mongo.listVersions(rootId);
  }

  async sync(params: SyncParams): Promise<SyncResult> {
    return this.mongo.sync(params);
  }

  async planSync(params: PlanSyncParams): Promise<PlanSyncResult> {
    return this.mongo.planSync(params);
  }

  async syncStatus(): Promise<SyncStatus> {
    return this.mongo.getSyncStatus();
  }

  async search(params: SearchParams): Promise<SearchResult> {
    const candidateLimit = Math.max(20, (params.offset ?? 0) + (params.limit ?? 20) * 3);
    const candidates = await this.milvus.searchCandidates({ ...params, candidateLimit });
    const candidateUuids = candidates.items.map((item) => item.uuid);
    if (candidateUuids.length === 0) {
      return {
        items: [],
        degraded: candidates.degraded,
        degraded_reason: candidates.degraded ? candidates.degraded_reason : 'NO_VECTOR_RESULTS',
        degraded_message: candidates.degraded ? candidates.degraded_message : '向量检索无结果',
        search_mode: candidates.search_mode,
        total: 0,
        has_more: false,
      };
    }

    const scope = params.scope && params.scope !== 'all' ? params.scope : undefined;
    const entities = await this.mongo.listByUuids(candidateUuids, {
      root_id: params.root_id,
      requirement_id: params.requirement_id ?? undefined,
      type: scope,
      versions: params.versions,
    });
    const entityByUuid = new Map(entities.map((entity) => [entity.uuid ?? '', entity]));

    const filtered = candidates.items
      .map((candidate) => {
        const entity = entityByUuid.get(candidate.uuid);
        if (!entity) return null;
        return {
          candidate,
          entity,
        };
      })
      .filter((item): item is { candidate: typeof candidates.items[number]; entity: Entity } => !!item);

    const offset = Math.max(0, params.offset ?? 0);
    const limit = Math.max(1, params.limit ?? 20);
    const paged = filtered.slice(offset, offset + limit);

    return {
      items: paged.map(({ candidate, entity }) => ({
        id: entity.id,
        type: entity.type,
        score: candidate.score,
        snippet: candidate.snippet,
        metadata: {
          status: entity.metadata.status,
          updated_at: entity.metadata.updated_at,
          source_repo: entity.metadata.source_repo,
        },
      })),
      degraded: candidates.degraded,
      degraded_reason: candidates.degraded ? candidates.degraded_reason : undefined,
      degraded_message: candidates.degraded ? candidates.degraded_message : undefined,
      search_mode: candidates.search_mode,
      total: filtered.length,
      has_more: offset + paged.length < filtered.length,
    };
  }

  async queryDeps(params: DepsParams): Promise<DepsResult> {
    return this.neo4j.queryDeps(params);
  }

  async queryImpact(params: ImpactParams): Promise<ImpactResult> {
    return this.neo4j.queryImpact(params);
  }

  async featLifecycle(params: FeatLifecycleParams): Promise<FeatLifecycleResult> {
    return this.mongo.featLifecycle(params);
  }

  async featMerge(params: FeatMergeParams): Promise<FeatMergeResult> {
    return this.mongo.featMerge(params);
  }

  async featChecklist(params: ChecklistParams): Promise<ChecklistResult> {
    return this.mongo.featChecklist(params);
  }

  async updateWorkflowStep(
    params: UpdateWorkflowStepParams
  ): Promise<UpdateWorkflowStepResult> {
    return this.mongo.updateWorkflowStep(params);
  }

  async readHistory(params: ReadHistoryParams): Promise<ReadHistoryResult> {
    return this.mongo.readHistory(params);
  }

  async backup(params: BackupParams): Promise<BackupResult> {
    return this.mongo.backup(params);
  }

  async restore(params: RestoreParams): Promise<RestoreResult> {
    return this.mongo.restore(params);
  }

  async downloadBackup(_remotePath: string, _localPath: string): Promise<void> {
    throw new Error('downloadBackup not implemented');
  }

  async repair(params: RepairParams): Promise<RepairResult> {
    return this.mongo.repair(params);
  }

  async validate(params: ValidateParams): Promise<ValidateResult> {
    return this.mongo.validate(params);
  }

  /**
   * v0.3.1 Server 迁移入口：
   * 将 legacy 文档迁移到 uuid/root_id/versions 模型，并重建图与向量索引。
   */
  async migrateLegacyDataset(rows: LegacyEntityRecord[]): Promise<{ migrated: number; skipped: number }> {
    const result = await this.mongo.migrateLegacyDataset(rows);
    const entities = await this.mongo.list({});
    await this.neo4j.rebuildFromEntities(entities);
    await this.milvus.rebuildFromEntities(entities);
    return { migrated: result.migrated, skipped: result.skipped };
  }

  async transaction<T>(fn: (adapter: StorageAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }

  startSyncWorker(): void {
    if (!this.syncWorker) {
      this.syncWorker = new SyncWorker(this.mongo, this.neo4j, this.milvus);
    }
    this.syncWorker.start();
  }

  async stopSyncWorker(): Promise<void> {
    if (!this.syncWorker) return;
    await this.syncWorker.stop();
  }

  private async enqueueSyncTasksForEntity(
    entity: Entity,
    operation: SyncOperation,
    versionOverride?: string
  ): Promise<void> {
    if (!entity.uuid) return;
    const versions = versionOverride ? [versionOverride] : (entity.versions ?? ['0.0.0']);
    const tasks = versions.flatMap((version) => [
      {
        task_type: 'graph_sync' as const,
        target_store: 'neo4j' as const,
        entity_uuid: entity.uuid ?? '',
        version,
        operation,
      },
      {
        task_type: 'vector_sync' as const,
        target_store: 'milvus' as const,
        entity_uuid: entity.uuid ?? '',
        version,
        operation,
      },
    ]);
    await this.mongo.enqueueSyncTasks(tasks);
  }

  private async enqueueSyncTasksForDeletion(uuid: string, version: string = '0.0.0'): Promise<void> {
    const tasks = [
      {
        task_type: 'graph_sync' as const,
        target_store: 'neo4j' as const,
        entity_uuid: uuid,
        version,
        operation: 'delete' as const,
      },
      {
        task_type: 'vector_sync' as const,
        target_store: 'milvus' as const,
        entity_uuid: uuid,
        version,
        operation: 'delete' as const,
      },
    ];
    await this.mongo.enqueueSyncTasks(tasks);
  }
}
