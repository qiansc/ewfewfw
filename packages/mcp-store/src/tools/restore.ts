/**
 * c4a_store_restore MCP 工具处理器
 *
 * 设计文档: store-utils.md §3.14
 */

import { getAdapter } from '@c4a/storage';
import type {
  StoreRestoreInput,
  StoreRestoreResult,
} from '../schemas.js';

/**
 * 恢复数据
 */
export async function storeRestoreHandler(
  args: StoreRestoreInput
): Promise<StoreRestoreResult> {
  const adapter = getAdapter();
  await adapter.initialize();

  const result = await adapter.restore({
    input: args.input,
    conflict_policy: args.conflict_policy,
    validate_checksums: args.validate_checksums,
  });

  return result as StoreRestoreResult;
}
