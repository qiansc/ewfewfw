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
  "spec",
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
 * UUID 格式
 */
export const UuidSchema = z.string().uuid().describe("UUID v4");

/**
 * root_id 格式
 */
export const RootIdSchema = z.string().describe("包边界标识（允许空字符串）");

/**
 * SemVer 版本格式（允许预发布）
 */
export const VersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, {
    message: "version 必须符合 SemVer 格式，例如 1.0.0 或 1.0.0-alpha.1",
  });

/**
 * requirement_id 格式（Feat UUID，可为 null 表示主分支）
 */
export const RequirementIdSchema = UuidSchema.nullable().describe("关联的 Feat UUID（可为空）");

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
  format: z.enum(["yaml", "json"]).optional().describe("content 的格式（当使用 content 时必填）"),
  id: z.string().optional().describe("指定 ID（不传则可由系统生成）"),
  uuid: UuidSchema.optional().describe("实体 UUID（不传则自动生成）"),
  root_id: RootIdSchema.optional().describe("包边界标识（Server 模式必填；Feat/Checklist 自动为空字符串）"),
  version: VersionSchema.optional().describe("目标版本（可选，CLI 从项目配置读取后传入）"),
  requirement_id: UuidSchema.optional().describe("关联的 Feat UUID（可选）"),
  component_id: z.string().optional().describe("关联的父 Component ID（可选）"),
  expected_updated_at: z
    .string()
    .optional()
    .describe("乐观锁：期望的 updated_at 值（ISO 8601）"),
  force: z.boolean().optional().describe("强制覆盖（跳过乐观锁检查）"),
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
  entity: z.record(z.any()).describe("完整实体"),
  warnings: z.array(WarningSchema).optional().describe("警告信息列表"),
});

// ============ c4a_store_read ============

/**
 * c4a_store_read 输入参数
 */
export const StoreReadInputSchema = z.object({
  uuid: UuidSchema.optional().describe("实体 UUID（优先级高于 id/root_id）"),
  root_id: RootIdSchema.optional().describe("包边界标识（与 id 组合使用）"),
  id: z.string().optional().describe("实体 ID（与 root_id 组合使用）"),
  version: VersionSchema.optional().describe("指定版本号（缺省为 0.0.0）"),
  format: FormatSchema.optional().describe("返回格式"),
  include_versions: z
    .boolean()
    .optional()
    .describe("是否返回指定实体的全部版本链"),
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
  uuid: UuidSchema.optional().describe("实体 UUID"),
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
  root_id: RootIdSchema.optional().describe("按 root_id 筛选"),
  id: z.string().optional().describe("按实体 ID 筛选"),
  requirement_id: UuidSchema.optional().describe("按 Feat UUID 筛选"),
  version: VersionSchema.optional().describe("按版本筛选（versions 包含）"),
  type: EntityTypeSchema.or(z.literal("all")).optional().describe("类型筛选"),
  status: EntityStatusSchema.optional().describe("按状态筛选"),
  updated_after: z.string().optional().describe("按更新时间筛选（ISO 8601 格式）"),
  limit: z.number().optional().describe("返回结果数量上限"),
  offset: z.number().optional().describe("分页偏移量"),
  group_by: z.enum(["type", "status"]).optional().describe("分组统计"),
  count_only: z.boolean().optional().describe("仅返回数量统计"),
});

/**
 * 实体概要信息
 */
export const EntitySummarySchema = z.object({
  uuid: UuidSchema.describe("实体 UUID"),
  id: z.string().describe("实体 ID"),
  root_id: RootIdSchema.describe("包边界标识"),
  type: z.string().describe("实体类型"),
  status: z.string().describe("实体状态"),
  updated_at: z.string().describe("更新时间"),
  content_hash: z.string().describe("内容哈希"),
  versions: z.array(z.string()).optional().describe("版本集合"),
  requirement_id: UuidSchema.optional().describe("关联的 Feat UUID"),
  component_id: z.string().optional().describe("关联的父 Component ID"),
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
  uuid: UuidSchema.describe("实体 UUID（必需）"),
  cascade: z.boolean().optional().describe("是否级联删除版本链"),
});

/**
 * c4a_store_delete 返回结果
 */
export const StoreDeleteResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  uuid: UuidSchema.describe("实体 UUID"),
  id: z.string().describe("实体 ID"),
  deleted_relations: z.number().optional().describe("级联删除的关系数量"),
});

// ============ 版本管理工具 ============

/**
 * c4a_store_add_version 输入参数
 */
export const StoreAddVersionInputSchema = z.object({
  uuid: UuidSchema.describe("实体 UUID（必填）"),
  version: VersionSchema.describe("要追加的版本号（必填）"),
});

/**
 * c4a_store_add_version 返回结果
 */
export const StoreAddVersionResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  entity_uuid: UuidSchema.describe("实体 UUID"),
  versions: z.array(z.string()).describe("更新后的版本列表"),
  warning: z.string().optional().describe("警告信息"),
});

/**
 * c4a_store_remove_version 输入参数
 */
export const StoreRemoveVersionInputSchema = z.object({
  uuid: UuidSchema.describe("实体 UUID（必填）"),
  version: VersionSchema.describe("要移除的版本号（必填）"),
  fallback_version: VersionSchema.optional().describe("移除 0.0.0 时的回退版本（可选）"),
});

/**
 * c4a_store_remove_version 返回结果
 */
export const StoreRemoveVersionResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  entity_uuid: UuidSchema.describe("实体 UUID"),
  versions: z.array(z.string()).describe("更新后的版本列表"),
  deleted: z.boolean().describe("是否已删除实体"),
  latest_fallback: z.object({
    previous_latest: z.string().describe("回退到的版本"),
    target_uuid: UuidSchema.describe("0.0.0 转移到的实体 UUID"),
  }).optional().describe("移除 0.0.0 时的回退信息"),
});

/**
 * c4a_store_publish_version 输入参数
 */
export const StorePublishVersionInputSchema = z.object({
  root_id: RootIdSchema.describe("包 ID（必填）"),
  version: VersionSchema.describe("要发布的版本号（必填）"),
  transfer_latest: z.boolean().optional().describe("是否转移 0.0.0（latest 指针）"),
});

/**
 * c4a_store_publish_version 返回结果
 */
export const StorePublishVersionResultSchema = z.object({
  success: z.boolean().describe("是否成功"),
  root_id: RootIdSchema.describe("包 ID"),
  version: z.string().describe("发布的版本号"),
  affected_entities: z.number().describe("受影响的实体数量"),
  latest_transferred: z.boolean().describe("是否转移了 0.0.0"),
  warnings: z.array(z.string()).optional().describe("警告信息"),
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
export type RequirementId = z.infer<typeof RequirementIdSchema>;

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
export type StoreAddVersionInput = z.infer<typeof StoreAddVersionInputSchema>;
export type StoreAddVersionResult = z.infer<typeof StoreAddVersionResultSchema>;
export type StoreRemoveVersionInput = z.infer<typeof StoreRemoveVersionInputSchema>;
export type StoreRemoveVersionResult = z.infer<typeof StoreRemoveVersionResultSchema>;
export type StorePublishVersionInput = z.infer<typeof StorePublishVersionInputSchema>;
export type StorePublishVersionResult = z.infer<typeof StorePublishVersionResultSchema>;

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

// ============ c4a_store_sync_status ============

/**
 * c4a_store_sync_status 输入参数
 */
export const StoreSyncStatusInputSchema = z.object({});

/**
 * c4a_store_sync_status 返回结果
 */
export const StoreSyncStatusResultSchema = z.object({
  pending_count: z.number().describe("待处理任务数"),
  failed_count: z.number().describe("失败任务数"),
  last_sync_at: z.string().nullable().describe("最后同步时间"),
  is_syncing: z.boolean().describe("是否正在同步"),
  lag_seconds: z.number().describe("同步延迟（秒）"),
  sync_warning: z.string().optional().describe("同步状态提示"),
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
  requirement_id: RequirementIdSchema.optional().describe("关联的 Feat UUID"),
  content: z.string().optional().describe("文件内容（execute=true 时必须提供）"),
});

/**
 * 同步快照
 */
export const SyncSnapshotSchema = z.object({
  synced_at: z.string().describe("同步时间"),
  entities: z.record(z.object({
    content_hash: z.string().describe("内容哈希"),
    requirement_id: RequirementIdSchema.optional().describe("关联的 Feat UUID"),
  })).describe("实体快照"),
});

/**
 * 同步选项
 */
export const SyncOptionsSchema = z.object({
  requirement_id: RequirementIdSchema.optional().describe("指定同步的 Feat UUID"),
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
export type StoreSyncStatusInput = z.infer<typeof StoreSyncStatusInputSchema>;
export type StoreSyncStatusResult = z.infer<typeof StoreSyncStatusResultSchema>;

export type StorePlanSyncInput = z.infer<typeof StorePlanSyncInputSchema>;
export type StorePlanSyncResult = z.infer<typeof StorePlanSyncResultSchema>;
export type StorePlanSyncExecutedResult = z.infer<typeof StorePlanSyncExecutedResultSchema>;
export type LocalFileManifest = z.infer<typeof LocalFileManifestSchema>;
export type SyncSnapshot = z.infer<typeof SyncSnapshotSchema>;
export type SyncOptions = z.infer<typeof SyncOptionsSchema>;
export type SyncAction = z.infer<typeof SyncActionSchema>;

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
  requirement_id: RequirementIdSchema.optional().describe("指定 Feat UUID"),
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
  requirement_id: RequirementIdSchema.optional().describe("Feat UUID"),
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
