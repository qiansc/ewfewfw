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
  SaveParams,
  SaveResult,
  ReadParams,
  ReadResultObject,
  ReadResultString,
  ListParams,
  ListResult,
  DeleteParams,
  DeleteResult,
  SyncParams,
  SyncResult,
  PlanSyncParams,
  PlanSyncResult,
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
} from './adapter.js';

// 导入拆分的模块
import type { LiteAdapterConfig, RequiredConfig, AdapterContext } from './lite-adapter/types.js';
import { save, read, list, del } from './lite-adapter/crud-operations.js';
import { sync, planSync } from './lite-adapter/sync-operations.js';
import { search } from './lite-adapter/search-operations.js';
import { queryDeps, queryImpact } from './lite-adapter/graph-operations.js';
import { featLifecycle, featMerge, featChecklist, updateWorkflowStep } from './lite-adapter/feat-operations.js';
import { readHistory, backup, restore, repair, validate } from './lite-adapter/utils-operations.js';

// 重新导出类型
export type { LiteAdapterConfig } from './lite-adapter/types.js';

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
    this.graph.load(db, null);

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

  async save(params: SaveParams): Promise<SaveResult> {
    return save(this.getContext(), params);
  }

  async read(params: ReadParams): Promise<ReadResultObject | ReadResultString | null> {
    return read(this.getContext(), params);
  }

  async list(params: ListParams): Promise<ListResult> {
    return list(this.getContext(), params);
  }

  async delete(params: DeleteParams): Promise<DeleteResult> {
    return del(this.getContext(), params);
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
  // Feat 操作
  // ============================================================

  async featLifecycle(params: FeatLifecycleParams): Promise<FeatLifecycleResult> {
    await this.initialize();
    return featLifecycle(this.getContext(), params);
  }

  async featMerge(params: FeatMergeParams): Promise<FeatMergeResult> {
    await this.initialize();
    return featMerge(this.getContext(), params);
  }

  async featChecklist(params: ChecklistParams): Promise<ChecklistResult> {
    await this.initialize();
    return featChecklist(this.getContext(), params);
  }

  async updateWorkflowStep(params: UpdateWorkflowStepParams): Promise<UpdateWorkflowStepResult> {
    await this.initialize();
    return updateWorkflowStep(this.getContext(), params);
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
}
