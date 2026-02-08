/**
 * LiteAdapter - Local 模式存储适配器
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/mode-switch.md
 *
 * 实现 StorageAdapter 接口，调用 SQLiteStore 完成存储操作。
 * 用于 Local 模式，替代 Server 模式的 MongoDB/Neo4j/Milvus 三库架构。
 */

import { SQLiteStore } from './sqlite-store.js';
import { InMemoryGraph } from './in-memory-graph.js';
import { GraphQueryCache } from './graph-query-cache.js';
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

// 导入拆分的模块
import type { LiteAdapterConfig, RequiredConfig, AdapterContext } from './lite-adapter/types.js';
import { save as saveEntity, read as readEntity, list as listEntities, del as deleteEntity } from './lite-adapter/crud-operations.js';
import { sync, planSync } from './lite-adapter/sync-operations.js';
import { search } from './lite-adapter/search-operations.js';
import { queryDeps, queryImpact } from './lite-adapter/graph-operations.js';
import { readHistory, backup, restore, repair, validate } from './lite-adapter/utils-operations.js';
import { addVersion, removeVersion, splitEntity, listVersions, readByUuid } from './lite-adapter/version-operations.js';
import { formatContent, parseContent, normalizeRequirementId } from './lite-adapter/helpers.js';

// 重新导出类型
export type { LiteAdapterConfig } from './lite-adapter/types.js';

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

function toEntityInputFromLegacy(params: SaveParams, defaultRootId: string): EntityInput {
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
    root_id: params.root_id ?? defaultRootId,
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

/**
 * Local 模式存储适配器
 *
 * 通过 SQLiteStore 实现所有存储操作，
 * 使用 InMemoryGraph 实现图查询，
 * 使用 GraphQueryCache 缓存查询结果。
 */
export class LiteAdapter implements StorageAdapter {
  private store: SQLiteStore;
  private graph: InMemoryGraph;
  private cache: GraphQueryCache;
  private config: RequiredConfig;
  private initialized = false;

  constructor(config: LiteAdapterConfig = {}) {
    // 默认使用全局数据库路径 ~/.c4a/store.db
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
    const defaultDbPath = `${homeDir}/.c4a/store.db`;

    this.config = {
      dbPath: config.dbPath || defaultDbPath,
      defaultProject: config.defaultProject || 'default',
      enableVectorSearch: config.enableVectorSearch ?? true,
      repoId: config.repoId ?? null,
      feat: {
        concurrent_warning: config.feat?.concurrent_warning ?? true,
        auto_notify: config.feat?.auto_notify ?? false,
      },
    };

    this.store = SQLiteStore.getInstance({ dbPath: this.config.dbPath });
    this.graph = new InMemoryGraph();
    this.cache = new GraphQueryCache();
  }

  /**
   * 获取适配器上下文（用于模块间共享状态）
   */
  private getContext(): AdapterContext {
    return {
      store: this.store,
      graph: this.graph,
      cache: this.cache,
      config: this.config,
    };
  }

  // ============================================================
  // 生命周期方法
  // ============================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 加载图数据到内存
    const db = this.store.getDatabase();
    this.graph.load(db);

    this.initialized = true;
  }

  async close(): Promise<void> {
    this.store.close();
    this.initialized = false;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const db = this.store.getDatabase();
      db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================
  // CRUD 操作
  // ============================================================

  async save(entity: EntityInput, options?: SaveOptions): Promise<Entity>;
  async save(params: SaveParams): Promise<LegacySaveResult>;
  async save(
    entityOrParams: EntityInput | SaveParams,
    options?: SaveOptions
  ): Promise<Entity | LegacySaveResult> {
    if (isLegacySaveParams(entityOrParams)) {
      try {
        const input = toEntityInputFromLegacy(entityOrParams, this.config.defaultProject);
        const saved = await saveEntity(this.getContext(), input, {
          force: entityOrParams.force_save ?? false,
        });
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
    return saveEntity(this.getContext(), entityOrParams, options);
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
      const candidates = await listEntities(this.getContext(), {
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
    return readEntity(this.getContext(), rootIdOrParams, id, version);
  }

  async readByUuid(uuid: string): Promise<Entity | null> {
    return readByUuid(this.getContext(), uuid);
  }

  async list(filter: EntityFilter): Promise<Entity[]>;
  async list(params: ListParams): Promise<LegacyListResult>;
  async list(filterOrParams: EntityFilter | ListParams): Promise<Entity[] | LegacyListResult> {
    if (isLegacyListParams(filterOrParams)) {
      const params = filterOrParams;
      const entities = await listEntities(this.getContext(), {
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
    return listEntities(this.getContext(), filterOrParams);
  }

  async delete(uuid: string): Promise<void>;
  async delete(params: DeleteParams): Promise<void>;
  async delete(uuidOrParams: string | DeleteParams): Promise<void> {
    if (typeof uuidOrParams === 'string') {
      return deleteEntity(this.getContext(), uuidOrParams);
    }
    const candidates = await listEntities(this.getContext(), {
      id: uuidOrParams.id,
      requirement_id: uuidOrParams.requirement_id ?? undefined,
      limit: 1,
    });
    if (candidates[0]?.uuid) {
      await deleteEntity(this.getContext(), candidates[0].uuid);
    }
  }

  async addVersion(uuid: string, version: string): Promise<Entity> {
    return addVersion(this.getContext(), uuid, version);
  }

  async removeVersion(uuid: string, version: string): Promise<Entity> {
    return removeVersion(this.getContext(), uuid, version);
  }

  async splitEntity(uuid: string, version: string, newData: Record<string, unknown>): Promise<string> {
    return splitEntity(this.getContext(), uuid, version, newData);
  }

  async listVersions(rootId: string): Promise<string[]> {
    return listVersions(this.getContext(), rootId);
  }

  // ============================================================
  // 同步操作
  // ============================================================

  async sync(params: SyncParams): Promise<SyncResult> {
    return sync(this.getContext(), params);
  }

  async planSync(params: PlanSyncParams): Promise<PlanSyncResult> {
    return planSync(this.getContext(), params);
  }

  async syncStatus(): Promise<SyncStatus> {
    return {
      pending_count: 0,
      failed_count: 0,
      processing_count: 0,
      last_sync_at: null,
      lag_seconds: 0,
    };
  }

  // ============================================================
  // 查询操作
  // ============================================================

  async search(params: SearchParams): Promise<SearchResult> {
    return search(this.getContext(), params);
  }

  async queryDeps(params: DepsParams): Promise<DepsResult> {
    return queryDeps(this.getContext(), params);
  }

  async queryImpact(params: ImpactParams): Promise<ImpactResult> {
    return queryImpact(this.getContext(), params);
  }

  // ============================================================
  // 工具类操作
  // ============================================================

  async readHistory(params: ReadHistoryParams): Promise<ReadHistoryResult> {
    await this.initialize();
    return readHistory(this.getContext(), params);
  }

  async backup(params: BackupParams): Promise<BackupResult> {
    await this.initialize();
    return backup(this.getContext(), params);
  }

  async restore(params: RestoreParams): Promise<RestoreResult> {
    await this.initialize();
    return restore(this.getContext(), params);
  }

  async repair(params: RepairParams): Promise<RepairResult> {
    await this.initialize();
    return repair(this.getContext(), params);
  }

  async validate(params: ValidateParams): Promise<ValidateResult> {
    await this.initialize();
    return validate(this.getContext(), params);
  }

  async transaction<T>(fn: (adapter: StorageAdapter) => Promise<T>): Promise<T> {
    const db = this.store.getDatabase();
    db.exec('BEGIN');
    try {
      const result = await fn(this);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
