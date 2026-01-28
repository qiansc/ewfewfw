/**
 * c4a_store_save 工具实现
 *
 * 保存/更新实体到数据库
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-crud.md §3.1
 */
import type { StoreSaveInput, StoreSaveResult } from "../storeSchemas.js";
import { getAdapter } from "@c4a/core/store";

/**
 * c4a_store_save 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 *
 * @param args - 输入参数
 * @returns 保存结果
 */
export async function storeSaveHandler(args: StoreSaveInput): Promise<StoreSaveResult> {
  const adapter = getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  // 调用 StorageAdapter.save()
  const result = await adapter.save({
    type: args.type,
    data: args.data,
    content: args.content,
    format: args.format,
    id: args.id,
    source_project: args.source_project,
    proposal_id: args.proposal_id,
    enforce_adr: args.enforce_adr,
    skip_adr_check: args.skip_adr_check,
    ignore_concurrent_warning: args.ignore_concurrent_warning,
    force_save: args.force_save,
  });

  return {
    success: result.success,
    id: result.id,
    status: result.status,
    adr_check: result.adr_check,
    warnings: result.warnings,
  };
}
