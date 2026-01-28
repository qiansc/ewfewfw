/**
 * c4a_store_feat_merge 工具实现
 *
 * Feat 合并与冲突解决
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-feat-lifecycle.md §3.7
 */
import type {
  StoreFeatMergeInput,
  StoreFeatMergeResult,
} from "../storeSchemas.js";
import { getAdapter } from "@c4a/core/store";

/**
 * c4a_store_feat_merge 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 *
 * @param args - 输入参数
 * @returns 合并结果
 */
export async function storeFeatMergeHandler(
  args: StoreFeatMergeInput
): Promise<StoreFeatMergeResult> {
  const adapter = getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  // 调用 StorageAdapter.featMerge()
  const result = await adapter.featMerge({
    feat_id: args.feat_id,
    strategy: args.strategy,
    conflict_resolution: args.conflict_resolution,
  });

  return result as StoreFeatMergeResult;
}
