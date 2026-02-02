/**
 * Store 工具的输入 Schema 定义
 *
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-crud.md
 */
import { z } from "zod";

// ============ 通用类型定义 ============

/**
 * 实体类型
 */
export const EntityTypeSchema = z.enum([
  "system",
  "container",
  "component",
  "adr",
  "contract",
  "product",
  "process",
  "sor",
]);

/**
 * 实体状态
 */
export const EntityStatusSchema = z.enum([
  "draft",
  "approved",
  "published",
  "deprecated",
  "archived",
]);

/**
 * 返回格式
 */
export const FormatSchema = z.enum(["object", "yaml", "json"]);

/**
 * proposal_id 格式验证
 * 格式：^feat-[a-z0-9]+(-[a-z0-9]+)*$
 */
export const ProposalIdSchema = z
  .string()
  .regex(/^feat-[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: "proposal_id 必须符合格式：feat-{小写字母/数字/连字符}",
  })
  .nullable()
  .default(null);

// ============ c4a_store_save ============

/**
 * c4a_store_save 输入参数 - 基础 schema（用于 MCP tool shape）
 *
 * 注意：此 schema 仅定义字段，不包含 refine 验证
 * MCP SDK 需要纯 ZodObject 的 .shape 属性
 */
export const StoreSaveInputSchema = z.object({
  type: EntityTypeSchema.describe("实体类型"),
  data: z.record(z.any()).optional().describe("实体内容（业务数据对象，与 content 二选一）"),
  content: z.string().optional().describe("实体内容（YAML/JSON 字符串，与 data 二选一）"),
  format: z.enum(["yaml", "json"]).optional().default("yaml").describe("content 的格式（当使用 content 时必填）"),
  id: z.string().optional().describe("指定 ID（不传则可由系统生成）"),
  source_project: z.string().optional().describe("实体归属项目（用于权限校验）"),
  proposal_id: ProposalIdSchema.describe("feat/提案隔离（主分支为 null）"),
  enforce_adr: z.boolean().optional().default(false).describe("是否强制 ADR 检查"),
  skip_adr_check: z.boolean().optional().default(false).describe("跳过 ADR 检查（需要特殊权限）"),
  ignore_concurrent_warning: z.boolean().optional().default(false).describe("忽略并发修改警告"),
  force_save: z.boolean().optional().default(false).describe("强制保存（跳过所有警告，需要特殊权限）"),
});

/**
 * c4a_store_save 输入参数 - 带验证的完整 schema
 *
 * 用于运行时验证，包含业务逻辑校验
 */
export const StoreSaveInputSchemaWithRefine = StoreSaveInputSchema.refine(
  (data) => {
    // 必须提供 data 或 content 其中之一
    return (data.data !== undefined) !== (data.content !== undefined);
  },
  {
    message: "必须提供 data 或 content 其中之一（不能同时提供或都不提供）",
  }
).refine(
  (data) => {
    // 使用 content 时必须指定 format
    if (data.content !== undefined && data.format === undefined) {
      return false;
    }
    return true;
  },
  {
    message: "使用 content 时必须同时指定 format",
  }
);

/**
 * Warning 类型定义
 */
export const WarningSchema = z.object({
  code: z.string().describe("警告码"),
  message: z.string().describe("警告消息"),
  severity: z.enum(["info", "warning", "error"]).describe("严重程度"),
  details: z.record(z.any()).optional().describe("详细信息"),
});

/**
 * ADR 检查结果
 */
export const AdrCheckResultSchema = z.object({
  required: z.boolean().describe("是否需要 ADR"),
  passed: z.boolean().describe("是否通过检查"),
  missing_adr: z.boolean().optional().describe("是否缺少 ADR"),
  message: z.string().optional().describe("检查消息"),
});

/**
 * c4a_store_save 返回结果
 */
export const StoreSaveResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  id: z.string().describe("实体 ID"),
  status: EntityStatusSchema.describe("实体状态"),
  adr_check: AdrCheckResultSchema.optional().describe("ADR 检查结果"),
  warnings: z.array(WarningSchema).optional().describe("警告信息列表"),
});

// ============ c4a_store_read ============

/**
 * c4a_store_read 输入参数
 */
export const StoreReadInputSchema = z.object({
  id: z.string().optional().describe("实体 ID"),
  format: FormatSchema.optional().default("object").describe("返回格式"),
  proposal_id: z.union([
    z.string(),
    z.array(z.string()),
    z.null(),
  ]).optional().default(null).describe("Feat 隔离查询"),
  filter: z.record(z.any()).optional().describe("通用过滤条件"),
  limit: z.number().optional().describe("返回结果数量上限"),
  include_relations: z.boolean().optional().describe("是否包含关系"),
  filter_relations: z.record(z.any()).optional().describe("关系过滤条件"),
});

/**
 * c4a_store_read 返回结果（format=object）
 */
export const StoreReadResultSchema = z.union([
  z.record(z.any()), // 单个实体
  z.array(z.record(z.any())), // 实体列表
]);

/**
 * c4a_store_read 返回结果（format=yaml/json）
 */
export const StoreReadFormattedResultSchema = z.object({
  id: z.string().describe("实体 ID"),
  type: z.string().describe("实体类型"),
  status: z.string().describe("实体状态"),
  content: z.string().describe("格式化的内容字符串"),
  format: z.enum(["yaml", "json"]).describe("内容格式"),
});

// ============ c4a_store_list ============

/**
 * c4a_store_list 输入参数
 */
export const StoreListInputSchema = z.object({
  filter: z.record(z.any()).optional().describe("通用过滤条件"),
  type: EntityTypeSchema.or(z.literal("all")).optional().describe("类型筛选"),
  project_id: z.string().optional().describe("按项目 ID 筛选"),
  proposal_id: z.union([
    z.string(),
    z.null(),
  ]).optional().describe("按提案 ID 筛选"),
  status: EntityStatusSchema.optional().describe("按状态筛选"),
  updated_after: z.string().optional().describe("按更新时间筛选（ISO 8601 格式）"),
  limit: z.number().optional().default(100).describe("返回结果数量上限"),
  offset: z.number().optional().default(0).describe("分页偏移量"),
  group_by: z.enum(["type", "status"]).optional().describe("分组统计"),
  count_only: z.boolean().optional().default(false).describe("仅返回数量统计"),
});

/**
 * 实体概要信息
 */
export const EntitySummarySchema = z.object({
  id: z.string().describe("实体 ID"),
  type: z.string().describe("实体类型"),
  status: z.string().describe("实体状态"),
  updated_at: z.string().describe("更新时间"),
  content_hash: z.string().describe("内容哈希"),
  source_project: z.string().optional().describe("归属项目"),
  proposal_id: z.string().optional().describe("提案 ID"),
});

/**
 * 分页信息
 */
export const PaginationSchema = z.object({
  total: z.number().describe("总数"),
  offset: z.number().describe("偏移量"),
  limit: z.number().describe("每页数量"),
  has_more: z.boolean().describe("是否有更多"),
});

/**
 * c4a_store_list 返回结果（count_only=false）
 */
export const StoreListResultSchema = z.object({
  items: z.array(EntitySummarySchema).describe("实体列表"),
  pagination: PaginationSchema.describe("分页信息"),
});

/**
 * c4a_store_list 返回结果（count_only=true）
 */
export const StoreListCountResultSchema = z.object({
  total: z.number().describe("总数"),
  by_type: z.record(z.number()).optional().describe("按类型统计"),
  by_status: z.record(z.number()).optional().describe("按状态统计"),
});

/**
 * c4a_store_list 返回结果（group_by 指定时）
 */
export const StoreListGroupResultSchema = z.object({
  groups: z.record(z.object({
    count: z.number().describe("数量"),
    items: z.array(EntitySummarySchema).optional().describe("实体列表"),
  })).describe("分组结果"),
});

// ============ c4a_store_delete ============

/**
 * c4a_store_delete 输入参数
 */
export const StoreDeleteInputSchema = z.object({
  id: z.string().describe("实体 ID（必需）"),
  proposal_id: ProposalIdSchema.describe("feat/提案隔离（默认 null 表示主分支）"),
  force: z.boolean().optional().default(false).describe("强制删除（跳过关联检查）"),
});

/**
 * c4a_store_delete 返回结果
 */
export const StoreDeleteResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  id: z.string().describe("实体 ID"),
  deleted_relations: z.number().optional().describe("级联删除的关系数量"),
});

// ============ 错误响应 ============

/**
 * 可恢复操作
 */
export const RecoverableActionSchema = z.object({
  action: z.string().describe("操作标识"),
  label: z.string().describe("操作描述"),
  params: z.record(z.any()).optional().describe("重试时需要的参数"),
});

/**
 * 错误响应
 */
export const ErrorResponseSchema = z.object({
  code: z.string().describe("错误码"),
  message: z.string().describe("错误消息"),
  details: z.record(z.any()).optional().describe("详细信息"),
  timestamp: z.string().describe("错误发生时间（ISO 8601）"),
  request_id: z.string().optional().describe("请求 ID"),
  recoverable_actions: z.array(RecoverableActionSchema).optional().describe("可恢复操作"),
});

// ============ 类型导出 ============

export type EntityType = z.infer<typeof EntityTypeSchema>;
export type EntityStatus = z.infer<typeof EntityStatusSchema>;
export type Format = z.infer<typeof FormatSchema>;
export type ProposalId = z.infer<typeof ProposalIdSchema>;

export type StoreSaveInput = z.infer<typeof StoreSaveInputSchema>;
export type StoreSaveResult = z.infer<typeof StoreSaveResultSchema>;
export type Warning = z.infer<typeof WarningSchema>;
export type AdrCheckResult = z.infer<typeof AdrCheckResultSchema>;

export type StoreReadInput = z.infer<typeof StoreReadInputSchema>;
export type StoreReadResult = z.infer<typeof StoreReadResultSchema>;
export type StoreReadFormattedResult = z.infer<typeof StoreReadFormattedResultSchema>;

export type StoreListInput = z.infer<typeof StoreListInputSchema>;
export type StoreListResult = z.infer<typeof StoreListResultSchema>;
export type StoreListCountResult = z.infer<typeof StoreListCountResultSchema>;
export type StoreListGroupResult = z.infer<typeof StoreListGroupResultSchema>;
export type EntitySummary = z.infer<typeof EntitySummarySchema>;
export type Pagination = z.infer<typeof PaginationSchema>;

export type StoreDeleteInput = z.infer<typeof StoreDeleteInputSchema>;
export type StoreDeleteResult = z.infer<typeof StoreDeleteResultSchema>;

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type RecoverableAction = z.infer<typeof RecoverableActionSchema>;

// ============ c4a_store_sync ============

/**
 * c4a_store_sync 输入参数（Local 模式）
 */
export const StoreSyncInputSchema = z.object({
  direction: z.enum(["import", "export"]).describe("同步方向"),
  status_filter: z.enum(["published", "approved", "all"]).optional().default("published").describe("按实体状态筛选"),
  path: z.string().optional().default(".context").describe("本地路径（需路径安全校验）"),
  format: z.enum(["yaml", "json"]).optional().default("yaml").describe("文件格式（仅 export 时使用）"),
  mode: z.enum(["incremental", "full"]).optional().default("incremental").describe("同步模式"),
  conflict_policy: z.enum(["warn", "skip", "override", "prompt"]).optional().default("skip").describe("冲突处理策略（仅 export 时使用）"),
});

/**
 * 同步统计信息
 */
export const SyncStatsSchema = z.object({
  scanned: z.number().describe("扫描的文件数"),
  created: z.number().describe("创建的实体数"),
  updated: z.number().describe("更新的实体数"),
  skipped: z.number().describe("跳过的实体数"),
  conflicted: z.number().describe("冲突的实体数"),
  failed: z.number().describe("失败的实体数"),
});

/**
 * c4a_store_sync 返回结果
 */
export const StoreSyncResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  stats: SyncStatsSchema.describe("统计信息"),
  details: z.array(z.record(z.any())).optional().describe("详细信息"),
});

// ============ c4a_store_plan_sync ============

/**
 * 本地文件摘要
 */
export const LocalFileManifestSchema = z.object({
  path: z.string().describe("相对路径"),
  entity_id: z.string().describe("实体 ID"),
  type: z.string().describe("实体类型"),
  content_hash: z.string().describe("内容哈希（SHA-256）"),
  updated_at: z.string().describe("本地文件修改时间（ISO 8601）"),
  proposal_id: z.string().optional().describe("feat 分支标识"),
  content: z.string().optional().describe("文件内容（execute=true 时必须提供）"),
});

/**
 * 同步快照
 */
export const SyncSnapshotSchema = z.object({
  synced_at: z.string().describe("同步时间"),
  entities: z.record(z.object({
    content_hash: z.string().describe("内容哈希"),
    proposal_id: z.string().optional().describe("提案 ID"),
  })).describe("实体快照"),
});

/**
 * 同步选项
 */
export const SyncOptionsSchema = z.object({
  proposal_id: z.string().optional().describe("指定同步的 feat 分支"),
  status_filter: z.enum(["published", "approved", "all"]).optional().describe("按状态筛选"),
  conflict_policy: z.enum(["warn", "skip", "override", "prompt"]).optional().describe("冲突处理策略"),
});

/**
 * c4a_store_plan_sync 输入参数
 */
export const StorePlanSyncInputSchema = z.object({
  local_manifest: z.object({
    files: z.array(LocalFileManifestSchema).describe("本地文件列表"),
  }).describe("本地文件摘要列表"),
  snapshot: SyncSnapshotSchema.nullable().optional().describe("上次同步快照"),
  options: SyncOptionsSchema.optional().describe("同步选项"),
  execute: z.boolean().optional().default(false).describe("是否执行上传（默认 false）"),
});

/**
 * 同步操作类型
 */
export const SyncActionSchema = z.object({
  op: z.enum(["upload", "download", "conflict", "delete_local", "delete_remote", "skip"]).describe("操作类型"),
  entity_id: z.string().describe("实体 ID"),
  type: EntityTypeSchema.optional().describe("实体类型"),
  path: z.string().optional().describe("文件路径"),
  reason: z.string().optional().describe("操作原因"),
  conflict_type: z.enum(["both_modified", "local_deleted", "remote_deleted"]).optional().describe("冲突类型"),
  local_hash: z.string().optional().describe("本地哈希"),
  remote_hash: z.string().optional().describe("远程哈希"),
  remote_content: z.string().optional().describe("远程内容"),
  content: z.string().optional().describe("文件内容（download 时提供）"),
  expected_hash: z.string().optional().describe("期望的本地文件哈希（用于 Double Check）"),
});

/**
 * c4a_store_plan_sync 返回结果（execute=false）
 */
export const StorePlanSyncResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  executed: z.literal(false).describe("标识未执行"),
  actions: z.array(SyncActionSchema).describe("操作指令列表"),
  new_snapshot: SyncSnapshotSchema.describe("更新后的快照"),
  stats: z.object({
    to_upload: z.number().describe("待上传数"),
    to_download: z.number().describe("待下载数"),
    conflicts: z.number().describe("冲突数"),
    to_delete: z.number().describe("待删除数"),
  }).describe("统计信息"),
});

/**
 * c4a_store_plan_sync 返回结果（execute=true）
 */
export const StorePlanSyncExecutedResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  executed: z.literal(true).describe("标识已执行"),
  results: z.object({
    uploaded: z.array(z.string()).describe("已上传的实体 ID"),
    failed: z.array(z.string()).describe("失败的实体 ID"),
  }).describe("执行结果"),
  actions: z.array(SyncActionSchema).describe("仍需 CLI 处理的操作"),
  new_snapshot: SyncSnapshotSchema.describe("更新后的快照"),
  stats: z.object({
    uploaded: z.number().describe("已上传数"),
    to_download: z.number().describe("待下载数"),
    conflicts: z.number().describe("冲突数"),
    to_delete: z.number().describe("待删除数"),
  }).describe("统计信息"),
});

// ============ 类型导出 ============

export type StoreSyncInput = z.infer<typeof StoreSyncInputSchema>;
export type StoreSyncResult = z.infer<typeof StoreSyncResultSchema>;
export type SyncStats = z.infer<typeof SyncStatsSchema>;

export type StorePlanSyncInput = z.infer<typeof StorePlanSyncInputSchema>;
export type StorePlanSyncResult = z.infer<typeof StorePlanSyncResultSchema>;
export type StorePlanSyncExecutedResult = z.infer<typeof StorePlanSyncExecutedResultSchema>;
export type LocalFileManifest = z.infer<typeof LocalFileManifestSchema>;
export type SyncSnapshot = z.infer<typeof SyncSnapshotSchema>;
export type SyncOptions = z.infer<typeof SyncOptionsSchema>;
export type SyncAction = z.infer<typeof SyncActionSchema>;

// ============ c4a_store_feat_lifecycle ============

/**
 * c4a_store_feat_lifecycle 输入参数
 */
export const StoreFeatLifecycleInputSchema = z.object({
  action: z.enum(["create", "transition", "delete"]).describe("操作类型"),
  feat_id: z.string().describe("Feat ID"),
  metadata: z.object({
    title: z.string().describe("标题"),
    description: z.string().describe("描述"),
    created_by: z.string().describe("创建人"),
  }).optional().describe("元数据（create 用）"),
  to_status: z.enum(["approved", "published", "deprecated", "archived"]).optional().describe("目标状态（transition 用）"),
  sync_checklist: z.boolean().optional().default(true).describe("是否启用 checklist 远程同步（create 用）"),
  force_publish: z.boolean().optional().default(false).describe("强制发布（transition 用）"),
  expected_content_hash: z.string().optional().describe("期望的内容哈希（transition to published 用）"),
});

/**
 * Merge 结果
 */
export const MergeResultSchema = z.object({
  merged: z.array(z.string()).describe("已合并的实体 ID"),
  conflicts: z.array(z.any()).describe("冲突列表"),
});

/**
 * c4a_store_feat_lifecycle 返回结果
 */
export const StoreFeatLifecycleResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  feat_id: z.string().describe("Feat ID"),
  status: z.string().optional().describe("当前状态（create 用）"),
  from_status: z.string().optional().describe("原状态（transition 用）"),
  to_status: z.string().optional().describe("目标状态（transition 用）"),
  merge_result: MergeResultSchema.optional().describe("合并结果（transition to published 用）"),
  deleted: z.boolean().optional().describe("是否已删除（delete 用）"),
  error: z.string().optional().describe("错误码"),
  message: z.string().optional().describe("错误消息"),
  conflicts: z.array(z.any()).optional().describe("冲突详情"),
  expected_hash: z.string().optional().describe("期望的哈希"),
  actual_hash: z.string().optional().describe("实际的哈希"),
  suggestion: z.string().optional().describe("建议"),
  affected_projects: z.array(z.string()).optional().describe("受影响的项目"),
  missing_permission: z.string().optional().describe("缺少的权限"),
});

// ============ c4a_store_feat_merge ============

/**
 * 冲突解决方案
 */
export const ConflictResolutionSchema = z.object({
  entity_id: z.string().describe("实体 ID"),
  resolution: z.enum(["keep_main", "keep_feat"]).describe("解决方案"),
});

/**
 * c4a_store_feat_merge 输入参数
 */
export const StoreFeatMergeInputSchema = z.object({
  feat_id: z.string().describe("Feat ID"),
  strategy: z.enum(["auto", "manual"]).describe("合并策略"),
  conflict_resolution: z.array(ConflictResolutionSchema).optional().describe("冲突解决方案（strategy=manual 时使用）"),
});

/**
 * 冲突详情
 */
export const ConflictDetailSchema = z.object({
  entity_id: z.string().describe("实体 ID"),
  conflict_type: z.enum(["content", "deleted"]).describe("冲突类型"),
  main_branch: z.record(z.any()).optional().describe("主分支版本"),
  feat_branch: z.record(z.any()).optional().describe("Feat 分支版本"),
  suggested_resolution: z.enum(["keep_main", "keep_feat"]).optional().describe("建议的解决方案"),
});

/**
 * c4a_store_feat_merge 返回结果
 */
export const StoreFeatMergeResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  merged: z.array(z.string()).describe("已合并的实体 ID"),
  conflicts: z.array(ConflictDetailSchema).describe("冲突列表"),
});

// ============ 类型导出 ============

export type StoreFeatLifecycleInput = z.infer<typeof StoreFeatLifecycleInputSchema>;
export type StoreFeatLifecycleResult = z.infer<typeof StoreFeatLifecycleResultSchema>;
export type MergeResult = z.infer<typeof MergeResultSchema>;

export type StoreFeatMergeInput = z.infer<typeof StoreFeatMergeInputSchema>;
export type StoreFeatMergeResult = z.infer<typeof StoreFeatMergeResultSchema>;
export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>;
export type ConflictDetail = z.infer<typeof ConflictDetailSchema>;

// ============ c4a_store_update_workflow_step ============

/**
 * Workflow 步骤状态
 */
export const WorkflowStepStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "skipped",
]);

/**
 * Workflow 步骤元数据
 */
export const WorkflowStepMetadataSchema = z.object({
  started_at: z.string().optional().describe("开始时间（ISO 8601）"),
  completed_at: z.string().optional().describe("完成时间（ISO 8601）"),
  failed_at: z.string().optional().describe("失败时间（ISO 8601）"),
  error: z.string().optional().describe("错误信息"),
  recovered: z.boolean().optional().describe("是否为恢复操作"),
}).catchall(z.any()).describe("步骤元数据");

/**
 * c4a_store_update_workflow_step 输入参数
 */
export const StoreUpdateWorkflowStepInputSchema = z.object({
  feat_id: z.string().describe("Feat ID"),
  step_id: z.string().describe("步骤 ID"),
  status: WorkflowStepStatusSchema.optional().describe("步骤状态"),
  metadata: WorkflowStepMetadataSchema.optional().describe("步骤元数据"),
});

/**
 * c4a_store_update_workflow_step 返回结果
 */
export const StoreUpdateWorkflowStepResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  feat_id: z.string().describe("Feat ID"),
  step_id: z.string().describe("步骤 ID"),
  status: WorkflowStepStatusSchema.optional().describe("步骤状态"),
  updated_at: z.string().optional().describe("更新时间（ISO 8601）"),
  updated_fields: z.array(z.string()).optional().describe("已更新的字段"),
  error: z
    .enum(["feat_not_found", "step_not_found", "concurrent_update"])
    .optional()
    .describe("错误码"),
  message: z.string().optional().describe("错误消息"),
});

export type WorkflowStepStatus = z.infer<typeof WorkflowStepStatusSchema>;
export type WorkflowStepMetadata = z.infer<typeof WorkflowStepMetadataSchema>;
export type StoreUpdateWorkflowStepInput = z.infer<typeof StoreUpdateWorkflowStepInputSchema>;
export type StoreUpdateWorkflowStepResult = z.infer<typeof StoreUpdateWorkflowStepResultSchema>;

// ============ c4a_store_read_history ============

/**
 * 历史记录项
 */
export const HistoryItemSchema = z.object({
  entity_id: z.string().optional().describe("实体 ID"),
  feat_id: z.string().nullable().describe("Feat ID"),
  action: z.enum(["create", "update", "delete", "archive"]).describe("操作类型"),
  changed_fields: z.array(z.string()).optional().describe("变更字段"),
  changed_by: z.string().optional().describe("变更人"),
  changed_at: z.string().describe("变更时间"),
});

/**
 * c4a_store_read_history 输入参数
 */
export const StoreReadHistoryInputSchema = z.object({
  entity_id: z.string().optional().describe("查询指定实体的历史"),
  feat_id: z.string().optional().describe("查询指定 Feat 的变更记录"),
  limit: z.number().default(100).describe("返回记录数量上限"),
  order: z.enum(["asc", "desc"]).default("desc").describe("按时间排序"),
});

/**
 * c4a_store_read_history 返回结果
 */
export const StoreReadHistoryResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  items: z.array(HistoryItemSchema).describe("历史记录列表"),
  total: z.number().optional().describe("总记录数"),
});

export type HistoryItem = z.infer<typeof HistoryItemSchema>;
export type StoreReadHistoryInput = z.infer<typeof StoreReadHistoryInputSchema>;
export type StoreReadHistoryResult = z.infer<typeof StoreReadHistoryResultSchema>;

// ============ c4a_store_backup ============

/**
 * 备份统计
 */
export const BackupStatsSchema = z.object({
  entities: z.number().describe("实体数量"),
  relations: z.number().describe("关系数量"),
  vectors: z.number().describe("向量数量"),
});

/**
 * c4a_store_backup 输入参数
 */
export const StoreBackupInputSchema = z.object({
  output: z.string().describe("备份文件路径"),
  status_filter: z.enum(["published", "approved", "all"]).default("published").describe("按实体状态筛选"),
  format: z.enum(["tar.gz", "json"]).default("tar.gz").describe("备份格式"),
  include_metadata: z.boolean().default(true).describe("是否包含元数据"),
});

/**
 * c4a_store_backup 返回结果
 */
export const StoreBackupResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  file: z.string().optional().describe("备份文件路径"),
  size: z.number().optional().describe("文件大小（字节）"),
  format_version: z.string().optional().describe("备份格式版本"),
  stats: BackupStatsSchema.optional().describe("备份统计"),
  error: z.string().optional().describe("错误信息"),
});

export type BackupStats = z.infer<typeof BackupStatsSchema>;
export type StoreBackupInput = z.infer<typeof StoreBackupInputSchema>;
export type StoreBackupResult = z.infer<typeof StoreBackupResultSchema>;

// ============ c4a_store_restore ============

/**
 * 恢复冲突
 */
export const RestoreConflictSchema = z.object({
  entity_id: z.string().describe("实体 ID"),
  reason: z.string().describe("冲突原因"),
  resolution: z.string().describe("解决方式"),
});

/**
 * c4a_store_restore 输入参数
 */
export const StoreRestoreInputSchema = z.object({
  input: z.string().describe("备份文件路径"),
  conflict_policy: z.enum(["skip", "override", "merge", "error"]).default("skip").describe("冲突处理策略"),
  validate_checksums: z.boolean().default(true).describe("是否验证校验和"),
});

/**
 * c4a_store_restore 返回结果
 */
export const StoreRestoreResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  format_version: z.string().optional().describe("备份格式版本"),
  compatible: z.boolean().optional().describe("是否兼容当前版本"),
  stats: BackupStatsSchema.optional().describe("恢复统计"),
  conflicts: z.array(RestoreConflictSchema).optional().describe("冲突列表"),
  error: z.string().optional().describe("错误信息"),
});

export type RestoreConflict = z.infer<typeof RestoreConflictSchema>;
export type StoreRestoreInput = z.infer<typeof StoreRestoreInputSchema>;
export type StoreRestoreResult = z.infer<typeof StoreRestoreResultSchema>;

// ============ c4a_store_repair ============

/**
 * 不一致问题
 */
export const InconsistencySchema = z.object({
  entity_id: z.string().describe("实体 ID"),
  issue: z.string().describe("问题描述"),
  fixed: z.boolean().describe("是否已修复"),
});

/**
 * c4a_store_repair 输入参数
 */
export const StoreRepairInputSchema = z.object({
  scope: z.enum(["all", "neo4j", "milvus"]).default("all").describe("修复范围"),
  dry_run: z.boolean().default(false).describe("仅检测不修复"),
  entity_ids: z.array(z.string()).optional().describe("指定实体 ID"),
});

/**
 * c4a_store_repair 返回结果
 */
export const StoreRepairResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  scanned: z.number().describe("扫描的实体数量"),
  inconsistencies: z.array(InconsistencySchema).describe("不一致问题列表"),
  stats: z.object({
    neo4j_fixed: z.number().describe("Neo4j 修复数量"),
    milvus_fixed: z.number().describe("Milvus 修复数量"),
    failed: z.number().describe("失败数量"),
  }).optional().describe("修复统计"),
  message: z.string().optional().describe("提示信息"),
});

export type Inconsistency = z.infer<typeof InconsistencySchema>;
export type StoreRepairInput = z.infer<typeof StoreRepairInputSchema>;
export type StoreRepairResult = z.infer<typeof StoreRepairResultSchema>;

// ============ c4a_store_validate ============

/**
 * 检查类型
 */
export const ValidateCheckTypeSchema = z.enum([
  "functional_spec",
  "technical_spec",
  "contracts",
  "references",
  "adr_completeness",
  "checklist",
]);

/**
 * 检查错误
 */
export const ValidateErrorSchema = z.object({
  code: z.string().describe("错误码"),
  entity_id: z.string().optional().describe("相关实体 ID"),
  message: z.string().describe("错误消息"),
  suggestion: z.string().optional().describe("修复建议"),
});

/**
 * 单项检查结果
 */
export const ValidateCheckResultSchema = z.object({
  status: z.enum(["passed", "warning", "error"]).describe("检查状态"),
  message: z.string().describe("检查消息"),
  errors: z.array(ValidateErrorSchema).optional().describe("错误列表"),
  warnings: z.array(ValidateErrorSchema).optional().describe("警告列表"),
  dangling_count: z.number().optional().describe("悬空引用数量"),
  changes_detected: z.array(z.object({
    type: z.string(),
    entity_id: z.string(),
    detail: z.string(),
  })).optional().describe("检测到的变更"),
  progress: z.object({
    completed: z.number(),
    total: z.number(),
    percentage: z.number(),
  }).optional().describe("进度"),
  blocked: z.array(z.string()).optional().describe("阻塞项"),
  suggestion: z.string().optional().describe("建议"),
});

/**
 * c4a_store_validate 输入参数
 */
export const StoreValidateInputSchema = z.object({
  proposal_id: z.string().optional().describe("指定 feat 分支"),
  checks: z.array(ValidateCheckTypeSchema).optional().describe("检查项"),
  options: z.object({
    check_depth: z.number().default(2).describe("依赖检查深度"),
    include_suggestions: z.boolean().default(true).describe("是否返回修复建议"),
  }).optional().describe("检查选项"),
});

/**
 * c4a_store_validate 返回结果
 */
export const StoreValidateResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  proposal_id: z.string().optional().describe("Feat ID"),
  summary: z.object({
    passed: z.number().describe("通过数量"),
    warnings: z.number().describe("警告数量"),
    errors: z.number().describe("错误数量"),
    status: z.enum(["passed", "warnings", "failed"]).describe("总体状态"),
  }).optional().describe("检查结果汇总"),
  checks: z.record(ValidateCheckResultSchema).optional().describe("各项检查详情"),
  suggestions: z.array(z.string()).optional().describe("修复建议"),
  error: z.string().optional().describe("错误信息"),
});

export type ValidateCheckType = z.infer<typeof ValidateCheckTypeSchema>;
export type ValidateError = z.infer<typeof ValidateErrorSchema>;
export type ValidateCheckResult = z.infer<typeof ValidateCheckResultSchema>;
export type StoreValidateInput = z.infer<typeof StoreValidateInputSchema>;
export type StoreValidateResult = z.infer<typeof StoreValidateResultSchema>;

// ============ c4a_store_feat_checklist ============

/**
 * Checklist 操作类型
 */
export const ChecklistActionSchema = z.enum([
  "generate",
  "get",
  "patch",
  "clear",
]);

/**
 * Checklist 补丁
 */
export const ChecklistPatchSchema = z.object({
  task_id: z.string().describe("任务 ID"),
  updates: z
    .object({
      title: z.string().optional().describe("任务标题"),
      status: z.enum(["pending", "in_progress", "completed", "blocked", "skipped"]).optional().describe("状态"),
      type: z.enum(["dsl", "code", "test", "doc", "contract"]).optional().describe("任务类型"),
      entity_id: z.string().optional().describe("关联实体 ID"),
      assignee: z.string().optional().describe("负责人"),
      completed_at: z.string().optional().describe("完成时间"),
      blocked_reason: z.string().optional().describe("阻塞原因"),
    })
    .describe("更新字段"),
});

/**
 * c4a_store_feat_checklist 输入参数
 */
export const StoreFeatChecklistInputSchema = z.object({
  action: ChecklistActionSchema.describe("操作类型"),
  feat_id: z.string().describe("Feat ID"),
  source: z.literal("technical_spec").optional().describe("Checklist 来源（generate 用）"),
  items: z.array(z.object({
    id: z.string().describe("任务 ID"),
    title: z.string().optional().describe("任务标题"),
    status: z.enum(["pending", "in_progress", "completed", "blocked", "skipped"]).optional().describe("状态"),
    type: z.enum(["dsl", "code", "test", "doc", "contract"]).optional().describe("任务类型"),
    entity_id: z.string().optional().describe("关联实体 ID"),
    assignee: z.string().optional().describe("负责人"),
  })).optional().describe("初始任务列表（generate 用）"),
  patches: z.array(ChecklistPatchSchema).optional().describe("更新补丁（patch 用）"),
  validate: z.boolean().optional().default(true).describe("是否验证"),
});

/**
 * Checklist 项
 */
export const ChecklistItemSchema = z.object({
  id: z.string().describe("任务 ID"),
  title: z.string().describe("任务标题"),
  status: z.enum(["pending", "in_progress", "completed", "blocked", "skipped"]).describe("状态"),
  type: z.enum(["dsl", "code", "test", "doc", "contract"]).optional().describe("任务类型"),
  entity_id: z.string().optional().describe("关联实体 ID"),
  assignee: z.string().optional().describe("负责人"),
  completed_at: z.string().optional().describe("完成时间"),
  blocked_reason: z.string().optional().describe("阻塞原因"),
});

/**
 * Checklist 内容
 */
export const ChecklistSchema = z.object({
  version: z.string().describe("版本"),
  metadata: z
    .object({
      feat_id: z.string().describe("Feat ID"),
      generated_at: z.string().optional().describe("生成时间"),
      source: z.string().optional().describe("生成来源"),
    })
    .optional()
    .describe("元信息"),
  updated_at: z.string().optional().describe("更新时间"),
  updated_by: z.string().optional().describe("更新人"),
  items: z.array(ChecklistItemSchema).describe("任务列表"),
});

/**
 * c4a_store_feat_checklist 返回结果
 */
export const StoreFeatChecklistResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  feat_id: z.string().describe("Feat ID"),
  checklist: ChecklistSchema.optional().describe("Checklist 内容"),
  updated_checklist: ChecklistSchema.optional().describe("更新后的 Checklist"),
  patched_at: z.string().optional().describe("补丁更新时间"),
  patched_tasks: z
    .array(
      z.object({
        task_id: z.string().describe("任务 ID"),
        fields_updated: z.array(z.string()).describe("更新字段列表"),
      }),
    )
    .optional()
    .describe("已更新的任务"),
  cleared: z.boolean().optional().describe("是否已清除（clear 用）"),
  error: z.string().optional().describe("错误码"),
  message: z.string().optional().describe("错误消息"),
  missing_tasks: z.array(z.string()).optional().describe("缺失的任务 ID 列表"),
  validation_errors: z
    .array(
      z.object({
        code: z.string().describe("错误码"),
        message: z.string().describe("错误信息"),
        task_id: z.string().optional().describe("任务 ID"),
      }),
    )
    .optional()
    .describe("结构校验错误"),
});

export type ChecklistAction = z.infer<typeof ChecklistActionSchema>;
export type ChecklistPatch = z.infer<typeof ChecklistPatchSchema>;
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;
export type Checklist = z.infer<typeof ChecklistSchema>;
export type StoreFeatChecklistInput = z.infer<typeof StoreFeatChecklistInputSchema>;
export type StoreFeatChecklistResult = z.infer<typeof StoreFeatChecklistResultSchema>;
