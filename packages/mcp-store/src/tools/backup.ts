/**
 * c4a_store_backup MCP 工具处理器
 *
 * 设计文档: store-utils.md §3.13
 */

import { getAdapter } from '@c4a/storage';
import type {
  StoreBackupInput,
  StoreBackupResult,
} from '../schemas.js';

/**
 * 备份数据
 */
export async function storeBackupHandler(
  args: StoreBackupInput
): Promise<StoreBackupResult> {
  const adapter = getAdapter();
  await adapter.initialize();

  const result = await adapter.backup({
    output: args.output,
    status_filter: args.status_filter,
    format: args.format,
    include_metadata: args.include_metadata,
  });

  return result as StoreBackupResult;
}
