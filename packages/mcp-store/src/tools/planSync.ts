/**
 * c4a_store_plan_sync 工具实现
 *
 * Server/Remote 模式同步计划
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-sync.md §3.5.1
 */
import type {
  StorePlanSyncInput,
  StorePlanSyncResult,
  StorePlanSyncExecutedResult,
} from "../schemas.js";
import { getAdapter } from "@c4a/storage";
import type { LocalManifest, SyncPlan, SyncSnapshot } from "@c4a/storage";

type PlanSyncStats = {
  to_upload: number;
  to_download: number;
  conflicts: number;
  to_delete: number;
};

type PlanSyncAction = StorePlanSyncResult["actions"][number];
type StorageSyncAction = SyncPlan["to_upload"][number];
type StoreEntityType = Exclude<PlanSyncAction["type"], undefined>;

type ExecutedStats = StorePlanSyncExecutedResult["stats"];

const STORE_ENTITY_TYPES: StoreEntityType[] = [
  "product",
  "system",
  "container",
  "component",
  "process",
  "sor",
  "adr",
  "contract",
];

function isStoreEntityType(value: StorageSyncAction["type"]): value is StoreEntityType {
  if (!value) {
    return false;
  }
  return STORE_ENTITY_TYPES.includes(value as StoreEntityType);
}

function toPlanSyncAction(action: StorageSyncAction): PlanSyncAction {
  if (!action.type || isStoreEntityType(action.type)) {
    return action as PlanSyncAction;
  }
  const { type: _ignored, ...rest } = action;
  return rest as PlanSyncAction;
}

function buildActions(plan: SyncPlan): PlanSyncAction[] {
  const actions: PlanSyncAction[] = [];
  for (const item of plan.to_upload) {
    actions.push(toPlanSyncAction(item));
  }
  for (const item of plan.to_download) {
    actions.push(toPlanSyncAction(item));
  }
  for (const item of plan.to_delete_local) {
    actions.push(toPlanSyncAction(item));
  }
  for (const item of plan.to_delete_remote) {
    actions.push(toPlanSyncAction(item));
  }
  for (const conflict of plan.conflicts) {
    actions.push({
      op: "conflict",
      entity_id: conflict.entity_id,
      conflict_type: conflict.conflict_type,
      local_hash: conflict.local_hash,
      remote_hash: conflict.remote_hash,
      remote_content: conflict.remote_content,
      reason: conflict.reason,
    });
  }
  return actions;
}

function buildStats(plan: SyncPlan): PlanSyncStats {
  return {
    to_upload: plan.to_upload.length,
    to_download: plan.to_download.length,
    conflicts: plan.conflicts.length,
    to_delete: plan.to_delete_local.length + plan.to_delete_remote.length,
  };
}

function buildStatsFromActions(actions: PlanSyncAction[]): PlanSyncStats {
  const stats: PlanSyncStats = {
    to_upload: 0,
    to_download: 0,
    conflicts: 0,
    to_delete: 0,
  };
  for (const action of actions) {
    switch (action.op) {
      case "upload":
        stats.to_upload += 1;
        break;
      case "download":
        stats.to_download += 1;
        break;
      case "delete_local":
      case "delete_remote":
        stats.to_delete += 1;
        break;
      case "conflict":
        stats.conflicts += 1;
        break;
      default:
        break;
    }
  }
  return stats;
}

function buildExecutedStats(
  actions: StorePlanSyncExecutedResult["actions"],
  result: StorePlanSyncExecutedResult["results"] | undefined,
  existing?: ExecutedStats,
): ExecutedStats {
  if (existing) {
    return existing;
  }
  const stats: ExecutedStats = {
    uploaded: result?.uploaded?.length ?? 0,
    to_download: 0,
    conflicts: 0,
    to_delete: 0,
  };
  for (const action of actions) {
    switch (action.op) {
      case "download":
        stats.to_download += 1;
        break;
      case "conflict":
        stats.conflicts += 1;
        break;
      case "delete_local":
      case "delete_remote":
        stats.to_delete += 1;
        break;
      default:
        break;
    }
  }
  return stats;
}

function ensureSnapshot(snapshot?: SyncSnapshot | null): SyncSnapshot {
  if (snapshot) {
    return snapshot;
  }
  return { synced_at: new Date().toISOString(), entities: {} };
}

/**
 * c4a_store_plan_sync 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 * ⚠️ 适用于 Server/Remote 模式（MCP 服务在独立进程或远程服务器）
 *
 * @param args - 输入参数
 * @returns 同步计划或执行结果
 */
export async function storePlanSyncHandler(
  args: StorePlanSyncInput
): Promise<StorePlanSyncResult | StorePlanSyncExecutedResult> {
  const adapter = await getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  // 调用 StorageAdapter.planSync()
  // 类型转换：schemas 中的类型与 adapter 中的类型略有差异
  const result = await adapter.planSync({
    local_manifest: args.local_manifest as unknown as LocalManifest,
    snapshot: args.snapshot as unknown as SyncSnapshot | null,
    options: args.options,
    execute: args.execute ?? false,
  });

  if ("plan" in result && result.plan) {
    const actions = buildActions(result.plan);
    const stats = buildStats(result.plan);
    return {
      success: true,
      executed: false,
      actions,
      new_snapshot: ensureSnapshot(result.new_snapshot ?? null),
      stats,
    };
  }

  if ("executed" in result && result.executed) {
    const executed = result as unknown as StorePlanSyncExecutedResult;
    const actions = executed.actions ?? [];
    return {
      ...executed,
      actions,
      stats: buildExecutedStats(actions, executed.results, executed.stats),
      new_snapshot: ensureSnapshot(executed.new_snapshot ?? null),
    };
  }

  if ("executed" in result && result.executed === false) {
    const draft = result as Partial<StorePlanSyncResult>;
    const actions = draft.actions ?? [];
    return {
      success: draft.success ?? true,
      executed: false,
      actions,
      new_snapshot: ensureSnapshot(draft.new_snapshot ?? null),
      stats: draft.stats ?? buildStatsFromActions(actions),
    };
  }

  return result as unknown as StorePlanSyncResult;
}
