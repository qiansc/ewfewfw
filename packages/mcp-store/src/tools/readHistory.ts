/**
 * c4a_store_read_history MCP 工具处理器
 *
 * 设计文档: store-utils.md §3.11
 */

import { getAdapter } from '@c4a/storage';
import type {
  StoreReadHistoryInput,
  StoreReadHistoryResult,
} from '../schemas.js';

/**
 * 读取实体变更历史
 */
export async function storeReadHistoryHandler(
  args: StoreReadHistoryInput
): Promise<StoreReadHistoryResult> {
  const adapter = await getAdapter();
  await adapter.initialize();

  const result = await adapter.readHistory({
    entity_id: args.entity_id,
    feat_id: args.feat_id,
    limit: args.limit,
    order: args.order,
  });

  return result as StoreReadHistoryResult;
}
