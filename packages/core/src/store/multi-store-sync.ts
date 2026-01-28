/**
 * 多库一致性 - Server 模式同步状态管理
 *
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-feat-lifecycle.md §3.7.9
 *
 * 核心原则：MongoDB 是单一权威源（Source of Truth），Neo4j 和 Milvus 是派生索引。
 *
 * 写入顺序：
 * 1. MongoDB 事务（权威操作）- 强一致
 * 2. Neo4j 同步（尽力而为）- 最终一致
 * 3. Milvus 同步（尽力而为）- 最终一致
 */

// ============================================================
// 类型定义
// ============================================================

/**
 * 同步状态
 */
export interface SyncStatus {
  mongodb: boolean;
  neo4j: boolean;
  milvus: boolean;
}

/**
 * 待同步记录
 */
export interface PendingSyncRecord {
  feat_id: string;
  entity_ids: string[];
  status: "pending" | "partial" | "completed";
  neo4j_synced: boolean;
  milvus_synced: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * 合并结果（Server 模式）
 */
export interface ServerMergeResult {
  success: boolean;
  merged: string[];
  sync_status: SyncStatus;
  repair_scheduled: boolean;
  warnings?: SyncWarning[];
}

/**
 * 同步警告
 */
export interface SyncWarning {
  code: "PARTIAL_SYNC" | "NEO4J_SYNC_FAILED" | "MILVUS_SYNC_FAILED";
  message: string;
  severity: "info" | "warning" | "error";
  details?: {
    failed_entities?: string[];
    repair_command?: string;
  };
}

/**
 * 降级模式查询结果
 */
export interface DegradedQueryResult {
  success: false;
  error: "DEGRADED_MODE_DEPTH_LIMIT" | "DEGRADED_MODE_DISABLED";
  message: string;
  allowed_depth?: number;
}

// ============================================================
// 常量
// ============================================================

/**
 * 降级模式下的最大查询深度
 */
export const DEGRADED_MODE_MAX_DEPTH = 1;

/**
 * 故障类型与降级行为映射
 */
export const DEGRADATION_BEHAVIOR = {
  neo4j: {
    affected_features: ["dependency_query", "impact_analysis"],
    fallback: "mongodb_with_depth_limit",
    max_depth: 1,
  },
  milvus: {
    affected_features: ["semantic_search"],
    fallback: "fulltext_search",
    precision_loss: true,
  },
} as const;

// ============================================================
// 辅助函数
// ============================================================

/**
 * 检查是否在降级模式下
 */
export function isDegradedMode(syncStatus: SyncStatus): boolean {
  return !syncStatus.neo4j || !syncStatus.milvus;
}

/**
 * 检查查询深度是否在降级模式允许范围内
 */
export function isDepthAllowedInDegradedMode(depth: number): boolean {
  return depth <= DEGRADED_MODE_MAX_DEPTH;
}

/**
 * 创建降级模式查询错误
 */
export function createDegradedModeError(
  requestedDepth: number
): DegradedQueryResult {
  return {
    success: false,
    error: "DEGRADED_MODE_DEPTH_LIMIT",
    message: `Neo4j 不可用，降级模式仅支持 depth=${DEGRADED_MODE_MAX_DEPTH} 的直接依赖查询`,
    allowed_depth: DEGRADED_MODE_MAX_DEPTH,
  };
}

/**
 * 创建部分同步警告
 */
export function createPartialSyncWarning(
  failedStorage: "neo4j" | "milvus",
  failedEntities: string[]
): SyncWarning {
  const storageNames = {
    neo4j: "Neo4j 图索引",
    milvus: "Milvus 向量索引",
  };

  return {
    code: "PARTIAL_SYNC",
    message: `实体已合并到主分支，但 ${storageNames[failedStorage]} 同步失败`,
    severity: "warning",
    details: {
      failed_entities: failedEntities,
      repair_command: `c4a_store_repair --scope=${failedStorage} --entity-ids=${failedEntities.join(",")}`,
    },
  };
}

/**
 * 创建待同步记录
 */
export function createPendingSyncRecord(
  featId: string,
  entityIds: string[]
): PendingSyncRecord {
  const now = new Date().toISOString();
  return {
    feat_id: featId,
    entity_ids: entityIds,
    status: "pending",
    neo4j_synced: false,
    milvus_synced: false,
    created_at: now,
    updated_at: now,
  };
}

/**
 * 更新待同步记录状态
 */
export function updatePendingSyncStatus(
  record: PendingSyncRecord,
  neo4jSuccess: boolean,
  milvusSuccess: boolean
): PendingSyncRecord {
  const allSynced = neo4jSuccess && milvusSuccess;
  return {
    ...record,
    status: allSynced ? "completed" : "partial",
    neo4j_synced: neo4jSuccess,
    milvus_synced: milvusSuccess,
    updated_at: new Date().toISOString(),
  };
}

/**
 * 构建合并结果
 */
export function buildServerMergeResult(
  mergedIds: string[],
  neo4jSuccess: boolean,
  milvusSuccess: boolean
): ServerMergeResult {
  const warnings: SyncWarning[] = [];

  if (!neo4jSuccess) {
    warnings.push(createPartialSyncWarning("neo4j", mergedIds));
  }

  if (!milvusSuccess) {
    warnings.push(createPartialSyncWarning("milvus", mergedIds));
  }

  return {
    success: true, // MongoDB 成功即视为成功
    merged: mergedIds,
    sync_status: {
      mongodb: true,
      neo4j: neo4jSuccess,
      milvus: milvusSuccess,
    },
    repair_scheduled: !neo4jSuccess || !milvusSuccess,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
