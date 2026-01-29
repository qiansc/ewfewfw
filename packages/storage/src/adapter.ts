/**
 * Storage Adapter Layer - 统一存储抽象接口
 *
 * 设计文档: v0.3.0/architecture.md §1.2
 *
 * 架构:
 * ```
 * MCP Tools (c4a_store_*, c4a_query_*)
 *              │
 *              ▼
 *    ┌─────────────────────┐
 *    │  StorageAdapter     │  ← 本文件定义
 *    │  (抽象层)            │
 *    └─────────┬───────────┘
 *              │
 *     ┌────────┴────────┐
 *     ▼                 ▼
 * LiteAdapter      ServerAdapter
 *   (TS)            (HTTP)
 *     │                │
 *     ▼                ▼
 *   SQLite         MongoDB/Neo4j/Milvus
 * ```
 */

import type { SaveParams, SaveResult, ReadParams, ReadResultObject, ReadResultString, ListParams, ListResult, DeleteParams, DeleteResult } from './adapterCrudTypes.js';
import type { SyncParams, SyncResult, PlanSyncParams, PlanSyncResult } from './adapterSyncTypes.js';
import type { SearchParams, SearchResult, DepsParams, DepsNode, ImpactParams, ImpactNode } from './adapterSearchTypes.js';
import type { FeatLifecycleParams, FeatLifecycleResult, FeatMergeParams, FeatMergeResult, ChecklistParams, ChecklistResult, UpdateWorkflowStepParams, UpdateWorkflowStepResult } from './adapterFeatTypes.js';
import type { ReadHistoryParams, ReadHistoryResult, BackupParams, BackupResult, RestoreParams, RestoreResult, RepairParams, RepairResult, ValidateParams, ValidateResult } from './adapterUtilsTypes.js';

export type * from './adapterBaseTypes.js';
export type * from './adapterCrudTypes.js';
export type * from './adapterSearchTypes.js';
export type * from './adapterSyncTypes.js';
export type * from './adapterFeatTypes.js';
export type * from './adapterUtilsTypes.js';

// ============================================================
// StorageAdapter 抽象接口
// ============================================================

/**
 * 存储适配器抽象接口
 *
 * 所有 MCP Store/Query 工具通过此接口访问存储，
 * 不直接调用 SQLiteStore 或 Python 服务。
 *
 * 实现:
 * - LiteAdapter: Local 模式，调用 SQLiteStore
 * - ServerAdapter: Server 模式，调用 Server API
 */
export interface StorageAdapter {
  // ============================================================
  // CRUD 操作 (c4a_store_*)
  // ============================================================

  /**
   * 保存/更新实体
   * 对应 MCP 工具: c4a_store_save
   */
  save(params: SaveParams): Promise<SaveResult>;

  /**
   * 读取实体
   * 对应 MCP 工具: c4a_store_read
   */
  read(params: ReadParams): Promise<ReadResultObject | ReadResultString | null>;

  /**
   * 列出实体概要
   * 对应 MCP 工具: c4a_store_list
   */
  list(params: ListParams): Promise<ListResult>;

  /**
   * 删除实体
   * 对应 MCP 工具: c4a_store_delete
   */
  delete(params: DeleteParams): Promise<DeleteResult>;

  // ============================================================
  // 同步操作 (c4a_store_sync / c4a_store_plan_sync)
  // ============================================================

  /**
   * 文件系统同步 (Local 模式)
   * 对应 MCP 工具: c4a_store_sync
   */
  sync(params: SyncParams): Promise<SyncResult>;

  /**
   * 同步计划 (Server/Remote 模式)
   * 对应 MCP 工具: c4a_store_plan_sync
   */
  planSync(params: PlanSyncParams): Promise<PlanSyncResult>;

  // ============================================================
  // 查询操作 (c4a_query_*)
  // ============================================================

  /**
   * 语义搜索
   * 对应 MCP 工具: c4a_query_search
   */
  search(params: SearchParams): Promise<SearchResult>;

  /**
   * 依赖查询
   * 对应 MCP 工具: c4a_query_deps
   */
  queryDeps(params: DepsParams): Promise<DepsNode[]>;

  /**
   * 影响分析
   * 对应 MCP 工具: c4a_query_impact
   */
  queryImpact(params: ImpactParams): Promise<ImpactNode[]>;

  // ============================================================
  // Feat 生命周期操作 (c4a_store_feat_*)
  // ============================================================

  /**
   * Feat 生命周期管理
   * 对应 MCP 工具: c4a_store_feat_lifecycle
   */
  featLifecycle(params: FeatLifecycleParams): Promise<FeatLifecycleResult>;

  /**
   * Feat 合并
   * 对应 MCP 工具: c4a_store_feat_merge
   */
  featMerge(params: FeatMergeParams): Promise<FeatMergeResult>;

  /**
   * Checklist 管理
   * 对应 MCP 工具: c4a_store_feat_checklist
   */
  featChecklist(params: ChecklistParams): Promise<ChecklistResult>;

  /**
   * 原子更新 workflow 步骤状态
   * 对应 MCP 工具: c4a_store_update_workflow_step
   */
  updateWorkflowStep(params: UpdateWorkflowStepParams): Promise<UpdateWorkflowStepResult>;

  // ============================================================
  // 工具类操作 (c4a_store_read_history, backup, restore, repair, validate)
  // ============================================================

  /**
   * 读取实体变更历史
   * 对应 MCP 工具: c4a_store_read_history
   */
  readHistory(params: ReadHistoryParams): Promise<ReadHistoryResult>;

  /**
   * 备份数据
   * 对应 MCP 工具: c4a_store_backup
   */
  backup(params: BackupParams): Promise<BackupResult>;

  /**
   * 恢复数据
   * 对应 MCP 工具: c4a_store_restore
   */
  restore(params: RestoreParams): Promise<RestoreResult>;

  /**
   * 修复数据一致性
   * 对应 MCP 工具: c4a_store_repair
   */
  repair(params: RepairParams): Promise<RepairResult>;

  /**
   * 架构一致性检查
   * 对应 MCP 工具: c4a_store_validate
   */
  validate(params: ValidateParams): Promise<ValidateResult>;

  // ============================================================
  // 生命周期
  // ============================================================

  /**
   * 初始化适配器
   */
  initialize(): Promise<void>;

  /**
   * 关闭适配器
   */
  close(): Promise<void>;

  /**
   * 健康检查
   */
  healthCheck(): Promise<boolean>;
}
