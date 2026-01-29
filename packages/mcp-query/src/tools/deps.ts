import { getAdapter } from "@c4a/storage";
import { checkSyncStatus } from "../checkSyncStatus.js";
import type { QueryHandlerOptions } from "../handlerContext.js";
import type { QueryDepsInput } from "../schemas.js";
import type { QueryDepsResult } from "../types.js";

export async function queryDepsHandler(
  args: QueryDepsInput,
  options: QueryHandlerOptions = {}
): Promise<QueryDepsResult> {
  const adapter = options.adapter ?? getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  const context = await checkSyncStatus([args.id], options.checkSyncStatus);
  const items = await adapter.queryDeps({
    id: args.id,
    source_project: args.source_project,
    direction: args.direction,
    depth: args.depth,
    proposal_id: args.proposal_id,
  });

  return {
    success: true,
    items,
    degraded: context.degraded,
    degraded_reason: context.degraded_reason,
    degraded_message: context.degraded_message,
  };
}
