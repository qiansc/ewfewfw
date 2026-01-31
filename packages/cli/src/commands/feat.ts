import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAdapter } from "@c4a/storage";
import type { ChecklistResult } from "@c4a/storage";
import { loadProjectConfig } from "../core/config.js";
import { McpClient, type McpTransport } from "../core/mcp-client.js";
import { parseArgs } from "../utils/args.js";
import { renderChecklistMarkdown } from "../core/checklistRender.js";

function printHelp(): void {
  console.log("c4a feat render <feat-id> [--format=md|json] [--output <path>]");
}

function normalizeFormat(value: unknown): "md" | "json" {
  if (typeof value !== "string") return "md";
  if (value === "json") return "json";
  if (value === "md" || value === "markdown") return "md";
  return "md";
}

async function fetchChecklist(featId: string): Promise<ChecklistResult> {
  const projectConfig = await loadProjectConfig();
  const mode = projectConfig?.mode ?? "local";

  if (mode === "local") {
    const adapter = getAdapter({ forceMode: "local" });
    await adapter.initialize();
    try {
      return await adapter.featChecklist({ action: "get", feat_id: featId });
    } finally {
      await adapter.close();
    }
  }

  const baseUrl = mode === "remote" ? projectConfig?.remote?.url : undefined;
  const transport: McpTransport = mode === "server" ? "stdio" : "http";
  const client = new McpClient({ baseUrl, transport });
  return await client.request<ChecklistResult>("c4a_store_feat_checklist", {
    action: "get",
    feat_id: featId,
  });
}

export async function featCommand(args: string[]): Promise<void> {
  const { positionals, options } = parseArgs(args);
  const subcommand = positionals[0];

  if (!subcommand || subcommand === "help" || options.help) {
    printHelp();
    return;
  }

  if (subcommand !== "render") {
    console.error(`未知子命令: ${subcommand}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  const featId = positionals[1];
  if (!featId) {
    console.error("缺少 feat-id。用法: c4a feat render <feat-id>");
    process.exitCode = 1;
    return;
  }

  const format = normalizeFormat(options.format);
  const output =
    typeof options.output === "string"
      ? options.output
      : join(".context", "feat", featId, format === "json" ? "checklist.json" : "checklist.md");

  let result: ChecklistResult;
  try {
    result = await fetchChecklist(featId);
  } catch (error) {
    console.error(`获取 Checklist 失败: ${String(error)}`);
    process.exitCode = 1;
    return;
  }

  if (!result.success || !result.checklist) {
    console.error(result.message ?? result.error ?? "未找到 Checklist");
    process.exitCode = 1;
    return;
  }

  const content =
    format === "json"
      ? JSON.stringify(result.checklist, null, 2)
      : renderChecklistMarkdown(result.checklist);

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, content, "utf-8");

  console.log(`已渲染 Checklist: ${output}`);
  console.log("注意: 此文件为只读视图，修改不会同步到数据库。");
}
