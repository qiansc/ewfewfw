import { getAdapter } from "@c4a/storage";
import { checkSyncStatus } from "../checkSyncStatus.js";
import type { QueryHandlerOptions } from "../handlerContext.js";
import type { QueryDepsInput } from "../schemas.js";
import type { QueryDepsResult } from "../types.js";

export async function queryDepsHandler(
  args: QueryDepsInput,
  options: QueryHandlerOptions = {}
): Promise<QueryDepsResult> {
  const adapter = options.adapter ?? (await getAdapter());

  // 确保适配器已初始化
  await adapter.initialize();

  if (!args.uuid && !args.id) {
    throw new Error("缺少 uuid 或 id");
  }
  const context = await checkSyncStatus(
    args.uuid ? [args.uuid] : args.id ? [args.id] : [],
    options.checkSyncStatus
  );
  const depth = context.degraded ? 1 : args.depth;
  const result = await adapter.queryDeps({
    uuid: args.uuid,
    id: args.id,
    root_id: args.root_id,
    direction: args.direction,
    depth,
  });

  const degraded = result.degraded || context.degraded;
  const degraded_reason = result.degraded ? result.degraded_reason : context.degraded_reason;
  const degraded_message = result.degraded ? result.degraded_message : context.degraded_message;
  const maxDepthAllowed = degraded ? 1 : undefined;

  return {
    success: true,
    items: result.nodes,
    degraded,
    degraded_reason,
    degraded_message,
    max_depth_allowed: maxDepthAllowed,
  };
}
