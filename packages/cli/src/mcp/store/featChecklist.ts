/**
 * c4a_store_feat_checklist 工具实现
 *
 * Checklist 管理：生成/获取/更新/清除
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-feat-checklist.md §3.8
 */
import { getAdapter } from "@c4a/core/store";
import type {
  ChecklistParams,
  ChecklistResult,
  ChecklistAction,
  ChecklistPatch,
} from "@c4a/core/store";

/**
 * 输入参数类型
 */
export interface StoreFeatChecklistInput {
  action: ChecklistAction;
  feat_id: string;
  source?: "technical_spec";
  patches?: ChecklistPatch[];
  validate?: boolean;
}

/**
 * c4a_store_feat_checklist 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 *
 * @param args - 输入参数
 * @returns 操作结果
 */
export async function storeFeatChecklistHandler(
  args: StoreFeatChecklistInput
): Promise<ChecklistResult> {
  const adapter = getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  // 调用 StorageAdapter.featChecklist()
  const result = await adapter.featChecklist({
    action: args.action,
    feat_id: args.feat_id,
    source: args.source,
    patches: args.patches,
    validate: args.validate ?? true,
  });

  return result;
}
