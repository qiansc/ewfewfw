/**
 * c4a_store_feat_lifecycle 工具实现
 *
 * Feat 生命周期管理：创建/流转/删除
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-feat-lifecycle.md §3.6
 */
import type {
  StoreFeatLifecycleInput,
  StoreFeatLifecycleResult,
} from "../schemas.js";
import { getAdapter, loadConfig } from "@c4a/storage";
import { BusinessError, BIZ_ERROR_CODES } from "@c4a/core/types";

/**
 * c4a_store_feat_lifecycle 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 *
 * @param args - 输入参数
 * @returns 操作结果
 */
export async function storeFeatLifecycleHandler(
  args: StoreFeatLifecycleInput
): Promise<StoreFeatLifecycleResult> {
  const adapter = await getAdapter();
  const config = loadConfig();

  // 确保适配器已初始化
  await adapter.initialize();

  // 调用 StorageAdapter.featLifecycle()
  const result = await adapter.featLifecycle({
    action: args.action,
    feat_id: args.feat_id,
    metadata: args.metadata,
    to_status: args.to_status,
    sync_checklist: args.sync_checklist ?? true,
    force_publish: args.force_publish ?? false,
    expected_content_hash: args.expected_content_hash,
  });

  if (
    args.action === "transition" &&
    args.to_status === "published" &&
    result.success
  ) {
    const count = await adapter.list({
      proposal_id: args.feat_id,
      project_id: config.project_id,
      count_only: true,
    });
    const total =
      typeof (count as { total?: number }).total === "number"
        ? (count as { total: number }).total
        : 0;
    let remaining = total;
    if (remaining > 0) {
      const mergeResult = await adapter.featMerge({
        feat_id: args.feat_id,
        strategy: "auto",
      });
      if (!mergeResult.success) {
        throw new BusinessError(
          BIZ_ERROR_CODES.MERGE_CONFLICT,
          {
            entity_id: args.feat_id,
            actual: String(remaining),
            expected: "0",
            suggestion: "解决冲突后重试发布或手动执行 c4a_store_feat_merge",
            recoverable_actions: [
              {
                action: "retry",
                label: "重试合并",
                params: { feat_id: args.feat_id, strategy: "auto" },
              },
            ],
          },
          "发布后检测到冲突，自动合并失败"
        );
      }
      const afterMerge = await adapter.list({
        proposal_id: args.feat_id,
        project_id: config.project_id,
        count_only: true,
      });
      remaining =
        typeof (afterMerge as { total?: number }).total === "number"
          ? (afterMerge as { total: number }).total
          : 0;
    }
    if (remaining === 0) {
      const probe = await adapter.list({
        proposal_id: args.feat_id,
        project_id: config.project_id,
        limit: 1,
        offset: 0,
      });
      if (Array.isArray((probe as { items?: unknown[] }).items)) {
        remaining = (probe as { items: unknown[] }).items.length;
      }
    }
    if (remaining > 0) {
      throw new BusinessError(
        BIZ_ERROR_CODES.MERGE_CONFLICT,
        {
          entity_id: args.feat_id,
          actual: String(remaining),
          expected: "0",
          suggestion: "重试发布或执行 c4a_store_feat_merge",
          recoverable_actions: [
            {
              action: "retry",
              label: "重试合并",
              params: { feat_id: args.feat_id, strategy: "auto" },
            },
          ],
        },
        "发布后仍存在 feat 分支实体，合并未完成"
      );
    }
  }

  return result as StoreFeatLifecycleResult;
}
