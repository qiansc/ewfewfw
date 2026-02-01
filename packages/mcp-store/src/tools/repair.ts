/**
 * c4a_store_repair MCP 工具处理器
 *
 * 设计文档: store-utils.md §3.15
 */

import { getAdapter } from '@c4a/storage';
import type {
  StoreRepairInput,
  StoreRepairResult,
} from '../schemas.js';

/**
 * 修复数据一致性
 */
export async function storeRepairHandler(
  args: StoreRepairInput
): Promise<StoreRepairResult> {
  const adapter = await getAdapter();
  await adapter.initialize();

  const result = await adapter.repair({
    scope: args.scope,
    dry_run: args.dry_run,
    entity_ids: args.entity_ids,
  });

  return result as StoreRepairResult;
}
