import { getAdapter, isLocalMode } from "@c4a/storage";
import { checkSyncStatus } from "../checkSyncStatus.js";
import type { QueryHandlerOptions } from "../handlerContext.js";
import type { QueryImpactInput } from "../schemas.js";
import type { QueryImpactResponse } from "../types.js";

export async function queryImpactHandler(
  args: QueryImpactInput,
  options: QueryHandlerOptions = {}
): Promise<QueryImpactResponse> {
  const adapter = options.adapter ?? (await getAdapter());

  // 确保适配器已初始化
  await adapter.initialize();

  const context = await checkSyncStatus([args.id], options.checkSyncStatus);
  const isLocal = options.isLocalMode ?? isLocalMode;

  if (context.degraded && !isLocal()) {
    return {
      success: false,
      error: "DEGRADED_MODE_UNSUPPORTED",
      message: "影响分析需要完整的图数据，当前处于降级模式",
      suggestion: "请等待同步完成或执行 `c4a_store_repair` 修复数据一致性",
    };
  }

  const result = await adapter.queryImpact({
    id: args.id,
    source_project: args.source_project,
    change_type: args.change_type,
    depth: args.depth,
    proposal_id: args.proposal_id,
  });

  const degraded = result.degraded || context.degraded;

  if (degraded && !isLocal()) {
    return {
      success: false,
      error: "DEGRADED_MODE_UNSUPPORTED",
      message: "影响分析需要完整的图数据，当前处于降级模式",
      suggestion: "请等待同步完成或执行 `c4a_store_repair` 修复数据一致性",
    };
  }

  if (isLocal()) {
    return {
      success: true,
      degraded: true,
      degraded_reason: "LOCAL_MODE_SIMPLIFIED",
      degraded_message: "Local 模式使用简化版影响分析，仅基于依赖关系遍历",
      max_depth_allowed: 1,
      items: result.nodes,
      suggestion: "如需完整的影响分析（含变更类型推断），请使用 Server 模式",
    };
  }

  return {
    success: true,
    items: result.nodes,
    degraded: context.degraded,
    degraded_reason: context.degraded_reason,
    degraded_message: context.degraded_message,
  };
}
