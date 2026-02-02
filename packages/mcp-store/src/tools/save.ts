/**
 * c4a_store_save 工具实现
 *
 * 保存/更新实体到数据库
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-crud.md §3.1
 */
import type { StoreSaveInput, StoreSaveResult } from "../schemas.js";
import { StoreSaveInputSchemaWithRefine } from "../schemas.js";
import { getAdapter, loadConfig } from "@c4a/storage";
import { InputError, INPUT_ERROR_CODES } from "@c4a/core/types";

/**
 * c4a_store_save 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 *
 * @param args - 输入参数
 * @returns 保存结果
 */
export async function storeSaveHandler(args: StoreSaveInput): Promise<StoreSaveResult> {
  const parsed = StoreSaveInputSchemaWithRefine.parse(args);
  const config = loadConfig();
  const adapter = await getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  const dataSourceProject =
    parsed.data && typeof parsed.data.source_project === "string"
      ? parsed.data.source_project
      : undefined;
  const metadataSourceProject =
    parsed.data &&
    typeof parsed.data.metadata === "object" &&
    parsed.data.metadata &&
    typeof (parsed.data.metadata as Record<string, unknown>).source_project === "string"
      ? ((parsed.data.metadata as Record<string, unknown>).source_project as string)
      : undefined;
  const resolvedSourceProject =
    parsed.source_project || dataSourceProject || metadataSourceProject || config.project_id;
  if (!resolvedSourceProject) {
    throw new InputError(
      INPUT_ERROR_CODES.MISSING_REQUIRED_FIELD,
      {
        field: "source_project",
        expected: "非空字符串",
        actual: "",
        suggestion: "请在参数中传入 source_project，或在 .context/.c4a.yaml 设置 project_id",
        recoverable_actions: [
          {
            action: "retry",
            label: "补充 source_project 后重试",
            params: {
              source_project: config.project_id ?? "<your_project_id>",
            },
          },
        ],
      },
      "缺少 source_project（project_id）"
    );
  }

  // 调用 StorageAdapter.save()
  const result = await adapter.save({
    type: parsed.type,
    data: parsed.data,
    content: parsed.content,
    format: parsed.format,
    id: parsed.id,
    source_project: resolvedSourceProject,
    proposal_id: parsed.proposal_id,
    enforce_adr: parsed.enforce_adr,
    adr_policy: config.adr_policy,
    skip_adr_check: parsed.skip_adr_check,
    ignore_concurrent_warning: parsed.ignore_concurrent_warning,
    force_save: parsed.force_save,
  });

  return {
    success: result.success,
    id: result.id,
    status: result.status,
    adr_check: result.adr_check,
    warnings: result.warnings,
  };
}
