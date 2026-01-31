import type { Checklist, ChecklistItem } from "@c4a/storage";

const STATUS_SYMBOL: Record<string, string> = {
  completed: "[x]",
  in_progress: "[~]",
  pending: "[ ]",
  skipped: "[-]",
  blocked: "[!]",
};

function formatItemLine(item: ChecklistItem): string {
  const symbol = STATUS_SYMBOL[item.status] ?? "[ ]";
  const idPart = item.id ? ` (${item.id})` : "";
  return `- ${symbol} ${item.title}${idPart}`;
}

function formatItemDetails(item: ChecklistItem): string[] {
  const details: string[] = [];
  if (item.type) {
    details.push(`  - 类型: ${item.type}`);
  }
  if (item.entity_id) {
    details.push(`  - 关联实体: ${item.entity_id}`);
  }
  if (item.assignee) {
    details.push(`  - 负责人: ${item.assignee}`);
  }
  if (item.completed_at) {
    details.push(`  - 完成时间: ${item.completed_at}`);
  }
  if (item.blocked_reason) {
    details.push(`  - 阻塞原因: ${item.blocked_reason}`);
  }
  return details;
}

function summarizeChecklist(items: ChecklistItem[]): string {
  const summary = {
    total: items.length,
    completed: items.filter((item) => item.status === "completed").length,
    in_progress: items.filter((item) => item.status === "in_progress").length,
    pending: items.filter((item) => item.status === "pending").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    blocked: items.filter((item) => item.status === "blocked").length,
  };
  return `总计 ${summary.total} | 完成 ${summary.completed} | 进行中 ${summary.in_progress} | 待处理 ${summary.pending} | 跳过 ${summary.skipped} | 阻塞 ${summary.blocked}`;
}

export function renderChecklistMarkdown(checklist: Checklist): string {
  const featId = checklist.metadata?.feat_id ?? "unknown-feat";
  const lines: string[] = [];

  lines.push(`# Checklist: ${featId}`);
  lines.push("");
  lines.push(summarizeChecklist(checklist.items));
  lines.push("");

  for (const item of checklist.items) {
    lines.push(formatItemLine(item));
    lines.push(...formatItemDetails(item));
  }

  lines.push("");
  lines.push("---");
  lines.push("> 此文件由 `c4a feat render` 自动生成，请勿手动编辑。");
  lines.push("> 修改 checklist 请使用 Agent 或 `c4a_store_feat_checklist` 接口。");

  return lines.join("\n");
}
