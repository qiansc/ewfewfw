import { getAdapter } from "@c4a/storage";
import type { QueryHandlerOptions } from "../handlerContext.js";
import type { QuerySearchInput } from "../schemas.js";
import type { QuerySearchResult } from "../types.js";

export async function querySearchHandler(
  args: QuerySearchInput,
  options: QueryHandlerOptions = {}
): Promise<QuerySearchResult> {
  const adapter = options.adapter ?? (await getAdapter());

  // 确保适配器已初始化
  await adapter.initialize();

  const limit = args.limit ?? 20;
  const offset = args.offset ?? 0;
  const scope = args.scope ?? args.type_filter;
  const result = await adapter.search({
    query: args.query,
    scope,
    root_id: args.root_id,
    versions: args.versions,
    limit,
    offset,
  });

  const items = result.items.map((item) => ({
    id: item.id,
    type: item.type,
    score: item.score,
    summary: item.snippet,
  }));

  const searchMode = result.search_mode === "like" ? "fulltext" : result.search_mode;

  return {
    success: true,
    items,
    pagination: {
      total: result.total ?? offset + items.length,
      offset,
      limit,
      has_more: result.has_more ?? false,
    },
    degraded: result.degraded,
    degraded_reason: result.degraded_reason,
    degraded_message: result.degraded_message,
    search_mode: searchMode,
  };
}
