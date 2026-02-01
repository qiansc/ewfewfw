/**
 * c4a_store_plan_sync 工具实现
 *
 * Server/Remote 模式同步计划
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-sync.md §3.5.1
 */
import type {
  StorePlanSyncInput,
  StorePlanSyncResult,
  StorePlanSyncExecutedResult,
} from "../schemas.js";
import { getAdapter } from "@c4a/storage";
import type { LocalManifest, SyncSnapshot } from "@c4a/storage";

/**
 * c4a_store_plan_sync 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 * ⚠️ 适用于 Server/Remote 模式（MCP 服务在独立进程或远程服务器）
 *
 * @param args - 输入参数
 * @returns 同步计划或执行结果
 */
export async function storePlanSyncHandler(
  args: StorePlanSyncInput
): Promise<StorePlanSyncResult | StorePlanSyncExecutedResult> {
  const adapter = await getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  // 调用 StorageAdapter.planSync()
  // 类型转换：schemas 中的类型与 adapter 中的类型略有差异
  const result = await adapter.planSync({
    local_manifest: args.local_manifest as unknown as LocalManifest,
    snapshot: args.snapshot as unknown as SyncSnapshot | null,
    options: args.options,
    execute: args.execute ?? false,
  });

  // 根据 execute 返回不同格式
  if (args.execute && result.executed) {
    return result as unknown as StorePlanSyncExecutedResult;
  }

  return result as unknown as StorePlanSyncResult;
}
