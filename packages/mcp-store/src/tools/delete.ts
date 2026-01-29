/**
 * c4a_store_delete 工具实现
 *
 * 删除实体
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-crud.md §3.4
 */
import type { StoreDeleteInput, StoreDeleteResult } from "../schemas.js";
import { getAdapter } from "@c4a/storage";

/**
 * c4a_store_delete 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 *
 * @param args - 输入参数
 * @returns 删除结果
 */
export async function storeDeleteHandler(args: StoreDeleteInput): Promise<StoreDeleteResult> {
  const adapter = getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  // 调用 StorageAdapter.delete()
  const result = await adapter.delete({
    id: args.id,
    proposal_id: args.proposal_id,
    force: args.force ?? false,
  });

  return {
    success: result.success,
    id: result.id,
  };
}
