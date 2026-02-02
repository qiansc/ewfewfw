import { getAdapter, loadConfig } from "@c4a/storage";
import { checkSyncStatus } from "../checkSyncStatus.js";
import type { QueryHandlerOptions } from "../handlerContext.js";
import type { QueryDepsInput } from "../schemas.js";
import type { QueryDepsResult } from "../types.js";

export async function queryDepsHandler(
  args: QueryDepsInput,
  options: QueryHandlerOptions = {}
): Promise<QueryDepsResult> {
  const config = loadConfig();
  const adapter = options.adapter ?? (await getAdapter());

  // 确保适配器已初始化
  await adapter.initialize();

  const context = await checkSyncStatus([args.id], options.checkSyncStatus);
  const resolvedSourceProject =
    args.source_project ?? config.project_id ?? config.local?.defaultProject;
  if (!resolvedSourceProject) {
    throw new Error("缺少 source_project（project_id）");
  }
  const result = await adapter.queryDeps({
    id: args.id,
    source_project: resolvedSourceProject,
    direction: args.direction,
    depth: args.depth,
    proposal_id: args.proposal_id,
  });

  const degraded = result.degraded || context.degraded;
  const degraded_reason = result.degraded ? result.degraded_reason : context.degraded_reason;
  const degraded_message = result.degraded ? result.degraded_message : context.degraded_message;

  return {
    success: true,
    items: result.nodes,
    degraded,
    degraded_reason,
    degraded_message,
  };
}
