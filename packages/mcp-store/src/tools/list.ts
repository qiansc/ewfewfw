/**
 * c4a_store_list 工具实现
 *
 * 列出实体概要
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-crud.md §3.3
 */
import type {
  StoreListInput,
  StoreListResult,
  StoreListCountResult,
  StoreListGroupResult,
} from "../schemas.js";
import { getAdapter, loadConfig } from "@c4a/storage";

/**
 * c4a_store_list 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 *
 * @param args - 输入参数
 * @returns 列表结果
 */
export async function storeListHandler(
  args: StoreListInput
): Promise<StoreListResult | StoreListCountResult | StoreListGroupResult> {
  const adapter = await getAdapter();
  const config = loadConfig();

  // 确保适配器已初始化
  await adapter.initialize();

  const resolvedProjectId = args.project_id ?? config.project_id;

  // 调用 StorageAdapter.list()
  const result = await adapter.list({
    filter: args.filter,
    type: args.type,
    project_id: resolvedProjectId,
    proposal_id: args.proposal_id,
    status: args.status,
    updated_after: args.updated_after,
    limit: args.limit ?? 100,
    offset: args.offset ?? 0,
    group_by: args.group_by,
    count_only: args.count_only ?? false,
  });

  // 根据返回类型返回不同格式
  if (args.count_only) {
    return result as StoreListCountResult;
  }

  if (args.group_by) {
    return result as StoreListGroupResult;
  }

  return result as StoreListResult;
}
