import { homedir } from "node:os";
import { join } from "node:path";
import type { ListResult } from "@c4a/storage";
import { getInstalledModes, loadGlobalConfig, loadProjectConfig } from "../core/config.js";
import { McpClient, type McpTransport } from "../core/mcp-client.js";

type SkillsConfig = {
  cursor?: boolean;
  claude?: boolean;
  opencode?: boolean;
};

type ProjectConfigWithExtras = Awaited<ReturnType<typeof loadProjectConfig>> & {
  skills?: SkillsConfig;
  server?: { url?: string };
  remote?: { url?: string };
};

type McpClientLike = {
  request<T>(method: string, params: unknown): Promise<T>;
};

type StatusCommandDeps = {
  loadGlobalConfig: typeof loadGlobalConfig;
  loadProjectConfig: typeof loadProjectConfig;
  createMcpClient: (options: { baseUrl?: string; transport?: McpTransport }) => McpClientLike;
  now: () => number;
  log: (message: string) => void;
  error: (message: string) => void;
};

const DEFAULT_DEPS: StatusCommandDeps = {
  loadGlobalConfig,
  loadProjectConfig,
  createMcpClient: (options) => new McpClient(options),
  now: () => Date.now(),
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

const TYPE_LABELS: Record<string, string> = {
  system: "System",
  container: "Container",
  component: "Component",
  process: "Process",
  sor: "SoR",
  adr: "ADR",
  contract: "Contract",
  product: "Product",
  checklist: "Checklist",
  feat: "Feat",
};

export async function statusCommand(
  args: string[],
  deps: StatusCommandDeps = DEFAULT_DEPS,
): Promise<void> {
  void args;

  deps.log("\n  C4A 状态\n");

  const globalConfigPath = join(homedir(), ".c4a", "config.yaml");
  let globalConfig = null;
  try {
    globalConfig = await deps.loadGlobalConfig();
  } catch (error) {
    deps.error(`读取全局配置失败: ${formatError(error)}`);
  }

  const installedModes = getInstalledModes(globalConfig);

  deps.log("全局配置:");
  deps.log(`  配置文件: ${globalConfigPath}`);
  deps.log(
    `  已安装模式: ${
      installedModes.length > 0 ? installedModes.map(formatModeLabel).join(", ") : "未安装"
    }`,
  );

  let projectConfig: ProjectConfigWithExtras | null = null;
  try {
    projectConfig = (await deps.loadProjectConfig()) as ProjectConfigWithExtras | null;
  } catch (error) {
    deps.error(`读取项目配置失败: ${formatError(error)}`);
  }

  deps.log("\n项目配置:");
  if (!projectConfig) {
    deps.log("  未检测到 .context/.c4a.yaml");
  } else {
    deps.log(`  项目 ID: ${projectConfig.project_id ?? "未设置"}`);
    deps.log(`  仓库 ID: ${projectConfig.repo_id ?? "未设置"}`);
    deps.log(`  使用模式: ${projectConfig.mode ?? "未设置"}`);
    deps.log("  配置文件: .context/.c4a.yaml");
  }

  const mode = projectConfig?.mode;
  const remoteUrl = mode === "remote" ? projectConfig?.remote?.url : undefined;
  const serverUrl = mode === "server" ? projectConfig?.server?.url : undefined;
  const baseUrl = remoteUrl ?? serverUrl;
  const transport: McpTransport =
    mode === "remote" || mode === "server" ? "http" : "local";

  let listResult: ListResult | null = null;
  let listError: unknown = null;
  let listLatencyMs: number | null = null;

  if (projectConfig) {
    const client = deps.createMcpClient({ baseUrl, transport });
    const start = deps.now();
    try {
      listResult = await client.request<ListResult>("c4a_store_list", {
        group_by: "type",
        project_id: projectConfig.project_id,
      });
      listLatencyMs = deps.now() - start;
    } catch (error) {
      listLatencyMs = deps.now() - start;
      listError = error;
    }
  }

  if (mode === "remote") {
    deps.log("\n远程服务:");
    deps.log(`  地址: ${remoteUrl ?? "未配置"}`);
    if (listError) {
      deps.log("  状态: ❌ 连接失败");
      deps.log(`  错误: ${formatError(listError)}`);
    } else if (listLatencyMs !== null) {
      deps.log("  状态: ✅ 连接正常");
      deps.log(`  延迟: ${listLatencyMs}ms`);
    } else {
      deps.log("  状态: ⚪ 未检测");
    }
  }

  deps.log("\n数据库统计:");
  if (!projectConfig) {
    deps.log("  未检测到项目配置，跳过统计");
  } else if (listError) {
    deps.log(`  获取失败: ${formatError(listError)}`);
  } else if (listResult?.groups && Object.keys(listResult.groups).length > 0) {
    for (const [type, info] of Object.entries(listResult.groups)) {
      const label = TYPE_LABELS[type] ?? type;
      deps.log(`  ${label}: ${info.count} 个`);
    }
  } else {
    deps.log("  暂无数据");
  }

  deps.log("\nSkills:");
  const skills = projectConfig?.skills;
  deps.log(`  Cursor: ${formatSkillStatus(skills?.cursor)}`);
  deps.log(`  Claude Code: ${formatSkillStatus(skills?.claude)}`);
  deps.log(`  OpenCode: ${formatSkillStatus(skills?.opencode)}`);
}

function formatModeLabel(mode: string): string {
  if (mode === "local") {
    return "Local";
  }
  if (mode === "server") {
    return "Server";
  }
  if (mode === "remote") {
    return "Remote";
  }
  return mode;
}

function formatSkillStatus(enabled?: boolean): string {
  if (enabled === true) {
    return "✅ 已配置";
  }
  if (enabled === false) {
    return "❌ 未配置";
  }
  return "⚪ 未设置";
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
