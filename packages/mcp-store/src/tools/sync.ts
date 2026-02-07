/**
 * c4a_store_sync 工具实现
 *
 * 文件系统 ↔ 数据库同步（Local 模式）
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-sync.md §3.5
 */
import type {
  StoreSyncInput,
  StoreSyncResult,
  StoreSyncStatusInput,
  StoreSyncStatusResult,
} from "../schemas.js";
import { getAdapter } from "@c4a/storage";

/**
 * c4a_store_sync 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 * ⚠️ 仅适用于 Local 模式（MCP 工具嵌入 CLI，可访问本地文件系统）
 *
 * @param args - 输入参数
 * @returns 同步结果
 */
export async function storeSyncHandler(args: StoreSyncInput): Promise<StoreSyncResult> {
  const adapter = await getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  // 调用 StorageAdapter.sync()
  const result = await adapter.sync({
    direction: args.direction,
    status_filter: args.status_filter ?? "published",
    path: args.path ?? ".context",
    format: args.format ?? "yaml",
    mode: args.mode ?? "incremental",
    conflict_policy: args.conflict_policy ?? "skip",
  });

  return {
    success: result.success,
    stats: result.stats,
    details: result.details,
  };
}

/**
 * c4a_store_sync_status 处理函数
 *
 * Server 模式同步状态查询
 */
export async function storeSyncStatusHandler(
  _args: StoreSyncStatusInput
): Promise<StoreSyncStatusResult> {
  const adapter = await getAdapter();
  await adapter.initialize();

  const status = await adapter.syncStatus();
  const isSyncing = status.processing_count > 0 || status.pending_count > 0;
  const warning =
    status.failed_count > 0
      ? "同步任务存在失败记录，请检查日志或重试"
      : status.pending_count > 0
        ? "同步任务积压中，查询结果可能不完整"
        : undefined;

  return {
    pending_count: status.pending_count,
    failed_count: status.failed_count,
    last_sync_at: status.last_sync_at,
    is_syncing: isSyncing,
    lag_seconds: status.lag_seconds,
    sync_warning: warning,
  };
}
