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
 *   (TS)            (Python)
 *     │                │
 *     ▼                ▼
 *   SQLite         MongoDB/Neo4j/Milvus
 * ```
 */

// ============================================================
// 基础类型定义
// ============================================================

/**
 * 实体类型
 */
export type EntityType =
  | 'system'
  | 'container'
  | 'component'
  | 'adr'
  | 'contract'
  | 'product'
  | 'process'
  | 'sor';

/**
 * 实体状态
 */
export type EntityStatus =
  | 'draft'
  | 'approved'
  | 'published'
  | 'deprecated'
  | 'archived';

/**
 * 返回格式
 */
export type OutputFormat = 'object' | 'yaml' | 'json';

// ============================================================
// 实体数据结构
// ============================================================

/**
 * 实体基础数据
 */
export interface EntityData {
  id: string;
  type: EntityType;
  kind?: string;
  scope?: string;
  perspective?: string;
  data: Record<string, unknown>;
}

/**
 * 实体元数据
 */
export interface EntityMetadata {
  source_project: string;
  source_repo?: string;
  external_url?: string;
  status: EntityStatus;
  content_hash: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

/**
 * 完整实体（数据 + 元数据）
 */
export interface Entity extends EntityData {
  proposal_id: string | null;
  metadata: EntityMetadata;
}

/**
 * 实体关系
 */
export interface Relation {
  id: string;
  proposal_id: string | null;
  from_project: string;
  from_id: string;
  to_project: string;
  to_id: string;
  rel_type: string;
  properties?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ============================================================
// 操作参数类型
// ============================================================

/**
 * 保存实体参数
 * 设计文档: store-crud.md §3.1
 */
export interface SaveParams {
  type: EntityType;
  data?: Record<string, unknown>;
  content?: string;
  format?: 'yaml' | 'json';
  id?: string;
  source_project?: string;
  proposal_id?: string | null;
  enforce_adr?: boolean;
  skip_adr_check?: boolean;
  ignore_concurrent_warning?: boolean;
  force_save?: boolean;
}

/**
 * 保存结果
 */
export interface SaveResult {
  success: boolean;
  id: string;
  status: EntityStatus;
  content_hash: string;
  adr_check?: {
    required: boolean;
    passed: boolean;
    missing_adr?: boolean;
    message?: string;
  };
  warnings?: Warning[];
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * 警告信息
 */
export interface Warning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  details?: Record<string, unknown>;
}

/**
 * 读取实体参数
 * 设计文档: store-crud.md §3.2
 */
export interface ReadParams {
  id?: string;
  format?: OutputFormat;
  proposal_id?: string | string[] | null;
  filter?: Record<string, unknown>;
  limit?: number;
  include_relations?: boolean;
  filter_relations?: Record<string, unknown>;
}

/**
 * 读取结果（对象格式）
 */
export interface ReadResultObject {
  entity: Entity | null;
  relations?: Relation[];
}

/**
 * 读取结果（字符串格式）
 */
export interface ReadResultString {
  id: string;
  type: EntityType;
  status: EntityStatus;
  content: string;
  format: 'yaml' | 'json';
}

/**
 * 列表参数
 * 设计文档: store-crud.md §3.3
 */
export interface ListParams {
  filter?: Record<string, unknown>;
  type?: EntityType | 'all';
  project_id?: string;
  proposal_id?: string | null;
  status?: EntityStatus;
  updated_after?: string;
  limit?: number;
  offset?: number;
  group_by?: 'type' | 'status';
  count_only?: boolean;
}

/**
 * 列表项概要
 */
export interface ListItem {
  id: string;
  type: EntityType;
  status: EntityStatus;
  updated_at: string;
  content_hash: string;
  source_project?: string;
  proposal_id?: string | null;
}

/**
 * 分页信息
 */
export interface Pagination {
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

/**
 * 列表结果
 */
export interface ListResult {
  items?: ListItem[];
  pagination?: Pagination;
  total?: number;
  by_type?: Record<string, number>;
  by_status?: Record<string, number>;
  groups?: Record<string, { count: number; items?: ListItem[] }>;
}

/**
 * 删除参数
 * 设计文档: store-crud.md §3.4
 */
export interface DeleteParams {
  id: string;
  proposal_id?: string | null;
  force?: boolean;
}

/**
 * 删除结果
 */
export interface DeleteResult {
  success: boolean;
  id: string;
  deleted_relations?: number;
  soft_deleted?: boolean;
  warnings?: Warning[];
}

// ============================================================
// 查询参数类型
// ============================================================

/**
 * 语义搜索参数
 */
export interface SearchParams {
  query: string;
  scope?: EntityType | 'all';
  proposal_id?: string | null;
  limit?: number;
}

/**
 * 搜索结果项
 */
export interface SearchResultItem {
  id: string;
  type: EntityType;
  score: number;
  snippet?: string;
  metadata: Partial<EntityMetadata>;
}

/**
 * 搜索模式
 */
export type SearchMode = 'vector' | 'fulltext';

/**
 * 搜索结果（包含降级状态）
 *
 * 设计文档: appendix.md Q1 降级策略
 */
export interface SearchResult {
  items: SearchResultItem[];
  /** 是否降级 */
  degraded: boolean;
  /** 降级原因 */
  degraded_reason?: 'VECTOR_SEARCH_UNAVAILABLE' | 'VECTOR_SEARCH_FAILED' | 'NO_VECTOR_RESULTS';
  /** 降级提示信息 */
  degraded_message?: string;
  /** 搜索模式 */
  search_mode: SearchMode;
}

/**
 * 依赖查询参数
 */
export interface DepsParams {
  id: string;
  direction?: 'upstream' | 'downstream' | 'both';
  depth?: number;
  proposal_id?: string | null;
}

/**
 * 依赖节点
 */
export interface DepsNode {
  id: string;
  type: EntityType;
  distance: number;
  relation_type: string;
}

/**
 * 影响分析参数
 */
export interface ImpactParams {
  id: string;
  change_type?: 'upgrade' | 'deprecate' | 'remove';
  depth?: number;
  proposal_id?: string | null;
}

/**
 * 影响节点
 */
export interface ImpactNode {
  id: string;
  type: EntityType;
  distance: number;
  impact_level: 'direct' | 'indirect';
}

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
 * - ServerAdapter: Server 模式，调用 mcp-data HTTP API
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

// ============================================================
// 同步操作类型
// ============================================================

/**
 * 同步方向
 */
export type SyncDirection = 'import' | 'export';

/**
 * 同步模式
 */
export type SyncMode = 'incremental' | 'full';

/**
 * 冲突策略
 */
export type ConflictPolicy = 'warn' | 'skip' | 'override' | 'prompt';

/**
 * 同步参数 (Local 模式)
 * 设计文档: store-sync.md §3.5
 */
export interface SyncParams {
  direction: SyncDirection;
  path?: string;
  mode?: SyncMode;
  status_filter?: 'published' | 'approved' | 'all';
  format?: 'yaml' | 'json';
  conflict_policy?: ConflictPolicy;
}

/**
 * 同步结果
 */
export interface SyncResult {
  success: boolean;
  stats: {
    scanned: number;
    created: number;
    updated: number;
    skipped: number;
    conflicted: number;
    failed: number;
  };
  details?: SyncDetail[];
  conflicts?: SyncConflict[];
}

/**
 * 同步详情
 */
export interface SyncDetail {
  path?: string;
  entity_id: string;
  type?: EntityType;
  action: 'created' | 'updated' | 'skipped' | 'failed' | 'exported' | 'conflict';
  error?: string;
}

/**
 * 同步冲突
 */
export interface SyncConflict {
  entity_id: string;
  local_hash: string;
  remote_hash: string;
  local_updated_at: string;
  remote_updated_at: string;
}

/**
 * 同步计划参数 (Server/Remote 模式)
 * 设计文档: store-sync.md §3.5.1
 */
export interface PlanSyncParams {
  local_manifest: LocalManifest;
  snapshot?: SyncSnapshot | null;
  options?: {
    proposal_id?: string;
    status_filter?: 'published' | 'approved' | 'all';
    conflict_policy?: ConflictPolicy;
  };
  execute?: boolean;
}

/**
 * 本地文件清单
 */
export interface LocalManifest {
  files: LocalFileInfo[];
}

/**
 * 本地文件信息
 */
export interface LocalFileInfo {
  path: string;
  entity_id: string;
  type: EntityType;
  content_hash: string;
  updated_at: string;
  proposal_id?: string;
  content?: string;
}

/**
 * 同步快照
 */
export interface SyncSnapshot {
  synced_at: string;
  entities: Record<
    string,
    {
      content_hash: string;
      proposal_id?: string;
    }
  >;
}

/**
 * 同步计划结果
 */
export interface PlanSyncResult {
  plan: SyncPlan;
  executed?: boolean;
  result?: SyncResult;
  new_snapshot?: SyncSnapshot;
}

/**
 * 同步计划
 */
export interface SyncPlan {
  to_upload: SyncAction[];
  to_download: SyncAction[];
  to_delete_local: SyncAction[];
  to_delete_remote: SyncAction[];
  conflicts: PlanConflict[];
  unchanged: string[];
}

/**
 * 同步操作
 * 设计文档: store-sync.md §3.5.1
 */
export interface SyncAction {
  op: 'upload' | 'download' | 'delete_local' | 'delete_remote' | 'conflict' | 'skip';
  entity_id: string;
  type?: EntityType;
  path?: string;
  content?: string;
  content_hash?: string;
  expected_hash?: string;
  reason?: string;
}

/**
 * 计划项（兼容旧接口）
 */
export interface PlanItem {
  entity_id: string;
  type: EntityType;
  action: 'create' | 'update';
  content_hash: string;
}

/**
 * 计划冲突
 */
export interface PlanConflict {
  entity_id: string;
  conflict_type: 'both_modified' | 'local_deleted' | 'remote_deleted';
  local_hash?: string;
  remote_hash?: string;
  remote_content?: string;
  reason?: string;
  resolution?: 'keep_local' | 'keep_remote';
}

// ============================================================
// Feat 生命周期类型
// ============================================================

/**
 * Feat 状态 - 从 types 模块导入
 * 定义见 v0.3.0/concepts.md
 */
import type { FeatStatus } from '../types/index.js';
export type { FeatStatus };

/**
 * Feat 生命周期操作
 */
export type FeatAction = 'create' | 'transition' | 'delete';

/**
 * Feat 生命周期参数
 */
export interface FeatLifecycleParams {
  action: FeatAction;
  feat_id: string;
  metadata?: {
    title: string;
    description: string;
    created_by: string;
  };
  to_status?: FeatStatus;
  sync_checklist?: boolean;
  force_publish?: boolean;
  expected_content_hash?: string;
}

/**
 * Feat 生命周期结果
 */
export interface FeatLifecycleResult {
  success: boolean;
  feat_id: string;
  status?: FeatStatus;
  from_status?: FeatStatus;
  to_status?: FeatStatus;
  deleted?: boolean;
  error?: string;
  message?: string;
  conflicts?: FeatConflict[];
  merge_result?: {
    merged: string[];
    conflicts: FeatConflict[];
  };
  // content_hash 验证失败时返回
  expected_hash?: string;
  actual_hash?: string;
}

/**
 * Feat 合并参数
 */
export interface FeatMergeParams {
  feat_id: string;
  strategy: 'auto' | 'manual';
  conflict_resolution?: Array<{
    entity_id: string;
    resolution: 'keep_main' | 'keep_feat';
  }>;
}

/**
 * Feat 冲突
 */
export interface FeatConflict {
  entity_id: string;
  conflict_type: 'content' | 'deleted' | 'both_modified';
  main_branch?: Record<string, unknown>;
  feat_branch?: Record<string, unknown>;
  suggested_resolution?: 'keep_main' | 'keep_feat';
}

/**
 * Feat 合并结果
 */
export interface FeatMergeResult {
  success: boolean;
  merged: string[];
  conflicts: FeatConflict[];
}

// ============================================================
// Checklist 类型
// ============================================================

/**
 * Checklist 操作类型
 */
export type ChecklistAction = 'generate' | 'get' | 'patch' | 'clear';

/**
 * Checklist 任务状态
 */
export type ChecklistTaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

/**
 * Checklist 任务类型
 */
export type ChecklistTaskType = 'dsl' | 'code' | 'test' | 'doc' | 'contract';

/**
 * Checklist 任务项
 */
export interface ChecklistItem {
  id: string;
  title: string;
  status: ChecklistTaskStatus;
  type?: ChecklistTaskType;
  entity_id?: string;
  assignee?: string;
  completed_at?: string;
  blocked_reason?: string;
}

/**
 * Checklist 数据
 */
export interface Checklist {
  version: string;
  metadata?: {
    feat_id: string;
    generated_at?: string;
    source?: string;
  };
  updated_at?: string;
  updated_by?: string;
  items: ChecklistItem[];
}

/**
 * Checklist 补丁
 */
export interface ChecklistPatch {
  task_id: string;
  updates: Partial<Omit<ChecklistItem, 'id'>> & { title?: string };
}

/**
 * Checklist 参数
 */
export interface ChecklistParams {
  action: ChecklistAction;
  feat_id: string;
  source?: 'technical_spec';
  patches?: ChecklistPatch[];
  validate?: boolean;
}

/**
 * Checklist 结果
 */
export interface ChecklistResult {
  success: boolean;
  feat_id: string;
  checklist?: Checklist;
  cleared?: boolean;
  patched_at?: string;
  patched_tasks?: Array<{ task_id: string; fields_updated: string[] }>;
  updated_checklist?: Checklist;
  error?: string;
  message?: string;
  missing_tasks?: string[];
  validation_errors?: Array<{ code: string; message: string; task_id?: string }>;
}

// ============================================================
// Workflow Step 类型
// ============================================================

/**
 * Workflow 步骤状态
 */
export type WorkflowStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

/**
 * Workflow 步骤元数据
 */
export interface WorkflowStepMetadata {
  started_at?: string;
  completed_at?: string;
  failed_at?: string;
  error?: string;
  recovered?: boolean;
  [key: string]: unknown;
}

/**
 * 更新 Workflow 步骤参数
 * 设计文档: store-feat-checklist.md §3.9
 */
export interface UpdateWorkflowStepParams {
  feat_id: string;
  step_id: string;
  status?: WorkflowStepStatus;
  metadata?: WorkflowStepMetadata;
}

/**
 * 更新 Workflow 步骤结果
 */
export interface UpdateWorkflowStepResult {
  success: boolean;
  feat_id: string;
  step_id: string;
  updated_fields?: string[];
  error?: 'feat_not_found' | 'step_not_found';
  message?: string;
}

// ============================================================
// 历史记录类型
// ============================================================

/**
 * 历史记录项
 */
export interface HistoryItem {
  entity_id?: string;
  feat_id: string | null;
  action: 'create' | 'update' | 'delete';
  changed_fields?: string[];
  changed_by?: string;
  changed_at: string;
}

/**
 * 读取历史参数
 * 设计文档: store-utils.md §3.11
 */
export interface ReadHistoryParams {
  entity_id?: string;
  feat_id?: string;
  limit?: number;
  order?: 'asc' | 'desc';
}

/**
 * 读取历史结果
 */
export interface ReadHistoryResult {
  success: boolean;
  items: HistoryItem[];
  total?: number;
}

// ============================================================
// 备份恢复类型
// ============================================================

/**
 * 备份统计
 */
export interface BackupStats {
  entities: number;
  relations: number;
  vectors: number;
}

/**
 * 备份参数
 * 设计文档: store-utils.md §3.13
 */
export interface BackupParams {
  output: string;
  status_filter?: 'published' | 'approved' | 'all';
  format?: 'tar.gz' | 'json';
  include_metadata?: boolean;
}

/**
 * 备份结果
 */
export interface BackupResult {
  success: boolean;
  file?: string;
  size?: number;
  format_version?: string;
  stats?: BackupStats;
  error?: string;
}

/**
 * 恢复冲突
 */
export interface RestoreConflict {
  entity_id: string;
  reason: string;
  resolution: string;
}

/**
 * 恢复参数
 * 设计文档: store-utils.md §3.14
 */
export interface RestoreParams {
  input: string;
  conflict_policy?: 'skip' | 'override' | 'merge' | 'error';
  validate_checksums?: boolean;
}

/**
 * 恢复结果
 */
export interface RestoreResult {
  success: boolean;
  format_version?: string;
  compatible?: boolean;
  stats?: BackupStats;
  conflicts?: RestoreConflict[];
  error?: string;
}

// ============================================================
// 修复类型
// ============================================================

/**
 * 不一致问题
 */
export interface Inconsistency {
  entity_id: string;
  issue: string;
  fixed: boolean;
}

/**
 * 修复参数
 * 设计文档: store-utils.md §3.15
 */
export interface RepairParams {
  scope?: 'all' | 'neo4j' | 'milvus';
  dry_run?: boolean;
  entity_ids?: string[];
}

/**
 * 修复结果
 */
export interface RepairResult {
  success: boolean;
  scanned: number;
  inconsistencies: Inconsistency[];
  stats?: {
    neo4j_fixed: number;
    milvus_fixed: number;
    failed: number;
  };
  message?: string;
}

// ============================================================
// 验证类型
// ============================================================

/**
 * 验证检查类型
 */
export type ValidateCheckType =
  | 'functional_spec'
  | 'technical_spec'
  | 'contracts'
  | 'references'
  | 'adr_completeness'
  | 'checklist';

/**
 * 验证错误
 */
export interface ValidateError {
  code: string;
  entity_id?: string;
  message: string;
  suggestion?: string;
}

/**
 * 单项检查结果
 */
export interface ValidateCheckResult {
  status: 'passed' | 'warning' | 'error';
  message: string;
  errors?: ValidateError[];
  warnings?: ValidateError[];
  dangling_count?: number;
  changes_detected?: Array<{
    type: string;
    entity_id: string;
    detail: string;
  }>;
  progress?: {
    completed: number;
    total: number;
    percentage: number;
  };
  blocked?: string[];
  suggestion?: string;
}

/**
 * 验证参数
 * 设计文档: store-utils.md §3.16
 */
export interface ValidateParams {
  proposal_id?: string;
  checks?: ValidateCheckType[];
  options?: {
    check_depth?: number;
    include_suggestions?: boolean;
  };
}

/**
 * 验证结果
 */
export interface ValidateResult {
  success: boolean;
  proposal_id?: string;
  summary?: {
    passed: number;
    warnings: number;
    errors: number;
    status: 'passed' | 'warnings' | 'failed';
  };
  checks?: Record<string, ValidateCheckResult>;
  suggestions?: string[];
  error?: string;
}
