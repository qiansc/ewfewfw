/**
 * c4a_store_feat_checklist 工具实现
 *
 * Checklist 管理：生成/获取/patch/清除
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-feat-checklist.md §3.8
 */
import { getAdapter, isLocalMode } from "@c4a/storage";
import type {
  ChecklistParams,
  ChecklistResult,
  ChecklistAction,
  ChecklistPatch,
  Checklist,
} from "@c4a/storage";
import { join } from "node:path";
import { safeRenderFile } from "./fileProtection.js";

/**
 * 输入参数类型
 */
export interface StoreFeatChecklistInput {
  action: ChecklistAction;
  feat_id: string;
  source?: "technical_spec";
  items?: Array<{
    id: string;
    title?: string;
    status?: string;
    type?: string;
    entity_id?: string;
    assignee?: string;
  }>;
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
  const adapter = await getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  // 调用 StorageAdapter.featChecklist()
  const result = await adapter.featChecklist({
    action: args.action,
    feat_id: args.feat_id,
    source: args.source,
    items: args.items,
    patches: args.patches,
    validate: args.validate ?? true,
  });

  // Local 模式下更新只读视图（checklist.md）
  if (isLocalMode()) {
    const checklist = result.updated_checklist ?? result.checklist;
    if (checklist) {
      renderChecklistView(args.feat_id, checklist);
    }
  }

  return result;
}

function renderChecklistView(featId: string, checklist: Checklist): void {
  const checklistPath = join(process.cwd(), ".context", "feat", featId, "checklist.md");
  const body = renderChecklistMarkdown(featId, checklist);
  const renderResult = safeRenderFile(checklistPath, featId, body);
  if (!renderResult.success && renderResult.error) {
    console.warn(renderResult.error);
  }
  if (renderResult.message) {
    console.warn(renderResult.message);
  }
}

function renderChecklistMarkdown(featId: string, checklist: Checklist): string {
  const lines: string[] = [];
  lines.push(`# Feat Checklist: ${featId}`);

  const updatedAt = checklist.updated_at ?? checklist.metadata?.generated_at;
  if (updatedAt) {
    lines.push("");
    lines.push(`- 更新时间: ${updatedAt}`);
  }

  lines.push("");
  lines.push("## 任务列表");

  for (const item of checklist.items) {
    const marker = item.status === "completed" ? "x" : " ";
    const statusLabel = item.status === "completed" ? "" : ` (${item.status})`;
    const entitySuffix = item.entity_id ? ` [${item.entity_id}]` : "";
    lines.push(`- [${marker}] ${item.title}${entitySuffix}${statusLabel}`);

    if (item.assignee) {
      lines.push(`  - 负责人: ${item.assignee}`);
    }
    if (item.completed_at) {
      lines.push(`  - 完成时间: ${item.completed_at}`);
    }
    if (item.blocked_reason) {
      lines.push(`  - 阻塞原因: ${item.blocked_reason}`);
    }
  }

  return lines.join("\n");
}
