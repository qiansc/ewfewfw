/**
 * c4a_store_list 工具实现
 *
 * 列出实体概要
 */
import type {
  StoreListInput,
  StoreListResult,
  StoreListCountResult,
  StoreListGroupResult,
  EntitySummary,
} from "../schemas.js";
import { getAdapter, loadConfig } from "@c4a/storage";

function toSummary(entity: Record<string, any>): EntitySummary {
  return {
    uuid: entity.uuid ?? "",
    id: entity.id,
    root_id: entity.root_id ?? "",
    type: entity.type,
    status: entity.metadata?.status ?? "draft",
    updated_at: entity.metadata?.updated_at ?? "",
    content_hash: entity.metadata?.content_hash ?? "",
    versions: entity.versions ?? [],
    requirement_id: entity.requirement_id ?? undefined,
    component_id: entity.component_id ?? undefined,
  };
}

/**
 * c4a_store_list 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 *
 * @param args - 输入参数
 * @returns 列表结果
 */
export async function storeListHandler(
  args: StoreListInput
): Promise<StoreListResult | StoreListCountResult | StoreListGroupResult> {
  const adapter = await getAdapter();
  const config = loadConfig();

  // 确保适配器已初始化
  await adapter.initialize();

  const resolvedRootId =
    args.root_id ?? config.local?.defaultProject ?? config.root_id;

  const entities = await adapter.list({
    root_id: resolvedRootId ?? undefined,
    id: args.id,
    requirement_id: args.requirement_id,
    version: args.version,
    type: args.type && args.type !== "all" ? args.type : undefined,
  });

  let filtered = entities;
  if (args.status) {
    filtered = filtered.filter((entity) => entity.metadata?.status === args.status);
  }
  if (args.updated_after) {
    filtered = filtered.filter((entity) => entity.metadata?.updated_at > args.updated_after!);
  }

  const countOnly = args.count_only ?? false;
  if (countOnly) {
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const entity of filtered) {
      const type = entity.type ?? "unknown";
      const status = entity.metadata?.status ?? "unknown";
      byType[type] = (byType[type] ?? 0) + 1;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
    return {
      total: filtered.length,
      by_type: byType,
      by_status: byStatus,
    } as StoreListCountResult;
  }

  const offset = args.offset ?? 0;
  const limit = args.limit ?? 100;

  if (args.group_by) {
    const groups: Record<string, { count: number; items?: EntitySummary[] }> = {};
    for (const entity of filtered) {
      const groupKey =
        args.group_by === "type"
          ? (entity.type ?? "unknown")
          : (entity.metadata?.status ?? "unknown");
      if (!groups[groupKey]) {
        groups[groupKey] = { count: 0, items: [] };
      }
      groups[groupKey].count += 1;
      groups[groupKey].items?.push(toSummary(entity));
    }
    return { groups } as StoreListGroupResult;
  }

  const items = filtered.slice(offset, offset + limit).map(toSummary);

  return {
    items,
    pagination: {
      total: filtered.length,
      offset,
      limit,
      has_more: offset + limit < filtered.length,
    },
  } as StoreListResult;
}
