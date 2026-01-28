/**
 * c4a_store_feat_lifecycle 工具实现
 *
 * Feat 生命周期管理：创建/流转/删除
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-feat-lifecycle.md §3.6
 */
import type {
  StoreFeatLifecycleInput,
  StoreFeatLifecycleResult,
} from "../storeSchemas.js";
import { getAdapter } from "@c4a/core/store";

/**
 * c4a_store_feat_lifecycle 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 *
 * @param args - 输入参数
 * @returns 操作结果
 */
export async function storeFeatLifecycleHandler(
  args: StoreFeatLifecycleInput
): Promise<StoreFeatLifecycleResult> {
  const adapter = getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  // 调用 StorageAdapter.featLifecycle()
  const result = await adapter.featLifecycle({
    action: args.action,
    feat_id: args.feat_id,
    metadata: args.metadata,
    to_status: args.to_status,
    sync_checklist: args.sync_checklist ?? true,
    force_publish: args.force_publish ?? false,
    expected_content_hash: args.expected_content_hash,
  });

  return result as StoreFeatLifecycleResult;
}
