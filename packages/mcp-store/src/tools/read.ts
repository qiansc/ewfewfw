/**
 * c4a_store_read 工具实现
 *
 * 读取实体/列表
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-crud.md §3.2
 */
import type {
  StoreReadInput,
  StoreReadResult,
  StoreReadFormattedResult,
} from "../schemas.js";
import { getAdapter } from "@c4a/storage";

/**
 * c4a_store_read 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 *
 * @param args - 输入参数
 * @returns 读取结果
 */
export async function storeReadHandler(
  args: StoreReadInput
): Promise<StoreReadResult | StoreReadFormattedResult | StoreReadFormattedResult[]> {
  const adapter = await getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  // 调用 StorageAdapter.read()
  const result = await adapter.read({
    id: args.id,
    format: args.format ?? "object",
    proposal_id: args.proposal_id,
    filter: args.filter,
    limit: args.limit,
    include_relations: args.include_relations,
    filter_relations: args.filter_relations,
  });

  // 处理空结果
  if (result === null) {
    return {} as StoreReadResult;
  }

  // 根据 format 返回不同格式
  if (args.format === "yaml" || args.format === "json") {
    return result as StoreReadFormattedResult | StoreReadFormattedResult[];
  }

  // 默认返回 object 格式
  return result as StoreReadResult;
}
