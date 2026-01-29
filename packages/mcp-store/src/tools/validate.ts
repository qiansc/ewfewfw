/**
 * c4a_store_validate MCP 工具处理器
 *
 * 设计文档: store-utils.md §3.16
 */

import { getAdapter } from '@c4a/storage';
import type {
  StoreValidateInput,
  StoreValidateResult,
} from '../schemas.js';

/**
 * 架构一致性检查
 */
export async function storeValidateHandler(
  args: StoreValidateInput
): Promise<StoreValidateResult> {
  const adapter = getAdapter();
  await adapter.initialize();

  const result = await adapter.validate({
    proposal_id: args.proposal_id,
    checks: args.checks,
    options: args.options,
  });

  return result as StoreValidateResult;
}
