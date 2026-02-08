import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { McpClient, type McpTransport } from "../core/mcp-client.js";
import { pullVersion, PullEngineError } from "../core/pullEngine.js";
import type { ProjectConfig } from "../core/config.js";
import { parseArgs } from "../utils/args.js";
import { buildErrorResponse, printErrorResponse } from "../utils/errorResponse.js";
import { promptConfirm } from "../utils/prompt.js";
import { resolveC4aConfig, type C4aConfig } from "../utils/resolveConfig.js";

type McpClientLike = {
  request<T>(method: string, params: unknown): Promise<T>;
};

type VersionCommandDeps = {
  createMcpClient: (options: { baseUrl?: string; transport?: McpTransport }) => McpClientLike;
  resolveC4aConfig: typeof resolveC4aConfig;
  confirm: (message: string) => Promise<boolean>;
  log: (message: string) => void;
  error: (message: string) => void;
};

const DEFAULT_DEPS: VersionCommandDeps = {
  createMcpClient: (options) => new McpClient(options),
  resolveC4aConfig,
  confirm: promptConfirm,
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

const LIST_LIMIT = 200;
const CONTEXT_CONFIG_PATH = join(".context", ".c4a.yaml");

function printHelp(log: (message: string) => void): void {
  log("用法: c4a version <command>");
  log("");
  log("命令:");
  log("  list              列出所有版本");
  log("  create <version>  创建新版本");
  log("  switch <version>  切换工作版本");
  log("  pull [version]    从数据库导出实体到本地文件");
  log("  push [files...]   将本地文件导入数据库");
  log("  release <version> 发布版本（检查 + 转移 latest）");
  log("  delete <version>  删除版本");
  log("  help              显示此帮助信息");
  log("");
  log("选项:");
  log("  --help            显示此帮助信息");
  log("");
  log("示例:");
  log("  c4a version list");
  log("  c4a version create 1.2.0 --from 1.1.0 --all");
  log("  c4a version switch 1.0.0");
  log("  c4a version pull");
  log("  c4a version push system/order.c4a.yaml");
  log("  c4a version release 1.1.0");
  log("  c4a version delete 1.1.0");
}

function resolveMcpClientConfig(config: C4aConfig): { transport: McpTransport; baseUrl?: string } {
  if (config.mode === "remote") {
    return { transport: "http", baseUrl: config.serverUrl };
  }
  return { transport: "local" };
}

async function fetchAllEntities(
  client: McpClientLike,
  rootId: string,
): Promise<Array<{ uuid: string; versions?: string[] }>> {
  const items: Array<{ uuid: string; versions?: string[] }> = [];
  let offset = 0;
  while (true) {
    const result = await client.request<{ items?: Array<{ uuid: string; versions?: string[] }>; pagination?: { has_more?: boolean } }>(
      "c4a_store_list",
      {
        root_id: rootId,
        type: "all",
        limit: LIST_LIMIT,
        offset,
      },
    );
    const pageItems = result.items ?? [];
    items.push(...pageItems);
    const hasMore = result.pagination?.has_more ?? false;
    if (!hasMore || pageItems.length === 0) {
      break;
    }
    offset += pageItems.length;
  }
  return items;
}

async function checkVersionExists(
  client: McpClientLike,
  rootId: string,
  version: string,
): Promise<boolean> {
  const result = await client.request<{ total?: number }>("c4a_store_list", {
    root_id: rootId,
    version,
    type: "all",
    count_only: true,
  });
  return (result.total ?? 0) > 0;
}

function compareSemver(a: string, b: string): number {
  const parse = (input: string): number[] =>
    input.split(".").map((part) => {
      const value = Number(part);
      return Number.isFinite(value) ? value : NaN;
    });
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (Number.isNaN(l) || Number.isNaN(r)) {
      return a.localeCompare(b);
    }
    if (l !== r) return l - r;
  }
  return 0;
}

function sortVersions(versions: string[]): string[] {
  const latestIndex = versions.indexOf("0.0.0");
  const remaining = versions.filter((version) => version !== "0.0.0").sort(compareSemver);
  if (latestIndex >= 0) {
    return ["0.0.0", ...remaining];
  }
  return remaining;
}

async function readProjectConfig(rootDir: string): Promise<ProjectConfig | null> {
  const configPath = join(rootDir, CONTEXT_CONFIG_PATH);
  try {
    const content = await readFile(configPath, "utf-8");
    if (!content.trim()) return null;
    return parse(content) as ProjectConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeProjectConfig(rootDir: string, config: ProjectConfig): Promise<void> {
  const contextDir = join(rootDir, ".context");
  if (!existsSync(contextDir)) {
    await mkdir(contextDir, { recursive: true });
  }
  const configPath = join(rootDir, CONTEXT_CONFIG_PATH);
  await writeFile(configPath, stringify(config), "utf-8");
}

async function updatePackageJsonVersion(rootDir: string, version: string): Promise<void> {
  const packagePath = join(rootDir, "package.json");
  const content = await readFile(packagePath, "utf-8");
  const json = JSON.parse(content) as { c4a?: Record<string, unknown> };
  const next = { ...json };
  next.c4a = { ...(json.c4a ?? {}), version };
  await writeFile(packagePath, JSON.stringify(next, null, 2) + "\n", "utf-8");
}

async function findDslFiles(rootDir: string): Promise<string[]> {
  const contextDir = join(rootDir, ".context");
  if (!existsSync(contextDir)) return [];
  const results: string[] = [];
  const stack = [contextDir];
  const configPath = join(rootDir, CONTEXT_CONFIG_PATH);
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".c4a.yaml")) {
        if (fullPath !== configPath) {
          results.push(fullPath);
        }
      }
    }
  }
  return results;
}

async function ensureConfig(deps: VersionCommandDeps): Promise<C4aConfig | null> {
  const config = await deps.resolveC4aConfig();
  if (!config) {
    printErrorResponse(buildErrorResponse("C4A-VER-999", "未找到项目配置"));
    return null;
  }
  return config;
}

export async function versionCommand(
  args: string[],
  deps: VersionCommandDeps = DEFAULT_DEPS,
): Promise<void> {
  const { positionals, options } = parseArgs(args);
  const subcommand = positionals[0];

  if (!subcommand || subcommand === "help" || options.help) {
    printHelp(deps.log);
    return;
  }

  if (subcommand === "pull") {
    const version = positionals[1];
    const config = await ensureConfig(deps);
    if (!config) {
      process.exitCode = 1;
      return;
    }
    const { transport, baseUrl } = resolveMcpClientConfig(config);
    const client = deps.createMcpClient({ baseUrl, transport });

    try {
      const result = await pullVersion({
        client,
        config,
        version,
        confirmCreateContext: deps.confirm,
      });
      if (result.canceled) {
        deps.log("已取消 pull");
        return;
      }
      if (options.json) {
        deps.log(
          JSON.stringify(
            {
              version: result.version,
              root_id: result.rootId,
              entities: result.entityCount,
              files_written: result.filesWritten.length,
              sync_state_updated: result.syncStateUpdated,
              sync_state_path: result.syncStatePath,
            },
            null,
            2,
          ),
        );
        return;
      }
      deps.log(`已拉取版本 ${result.version}（实体 ${result.entityCount} 个）`);
      if (result.syncStateUpdated && result.syncStatePath) {
        deps.log(`同步状态已更新: ${result.syncStatePath}`);
      }
    } catch (error) {
      if (error instanceof PullEngineError) {
        printErrorResponse(buildErrorResponse(error.code, error.message, error.details));
      } else {
        deps.error(`pull 失败: ${String(error)}`);
      }
      process.exitCode = 1;
    }
    return;
  }

  if (subcommand === "list") {
    const config = await ensureConfig(deps);
    if (!config) {
      process.exitCode = 1;
      return;
    }
    if (!config.rootId) {
      printErrorResponse(buildErrorResponse("C4A-VER-999", "未配置 root_id，无法列出版本"));
      process.exitCode = 1;
      return;
    }
    const { transport, baseUrl } = resolveMcpClientConfig(config);
    const client = deps.createMcpClient({ baseUrl, transport });
    try {
      const entities = await fetchAllEntities(client, config.rootId);
      const counts = new Map<string, number>();
      for (const entity of entities) {
        for (const version of entity.versions ?? []) {
          counts.set(version, (counts.get(version) ?? 0) + 1);
        }
      }
      const versions = sortVersions([...counts.keys()]);
      if (versions.length === 0) {
        deps.log("未找到版本记录");
        return;
      }
      const current = config.version ?? "0.0.0";
      if (options.json) {
        deps.log(
          JSON.stringify(
            {
              versions: versions.map((version) => ({
                version,
                entity_count: counts.get(version) ?? 0,
                is_latest: version === "0.0.0",
                is_current: version === current,
              })),
            },
            null,
            2,
          ),
        );
        return;
      }

      const versionWidth = Math.max("版本".length, ...versions.map((v) => v.length));
      const countWidth = Math.max(
        "实体数".length,
        ...versions.map((v) => String(counts.get(v) ?? 0).length),
      );
      deps.log(`${"版本".padEnd(versionWidth)}  ${"实体数".padEnd(countWidth)}`);
      deps.log("─".repeat(versionWidth + countWidth + 2));
      for (const version of versions) {
        const marker: string[] = [];
        if (version === "0.0.0") marker.push("latest");
        if (version === current) marker.push("当前");
        const suffix = marker.length > 0 ? ` ← ${marker.join(", ")}` : "";
        deps.log(
          `${version.padEnd(versionWidth)}  ${String(counts.get(version) ?? 0).padEnd(
            countWidth,
          )}${suffix}`,
        );
      }
    } catch (error) {
      deps.error(`读取版本列表失败: ${String(error)}`);
      process.exitCode = 1;
    }
    return;
  }

  if (subcommand === "switch") {
    const version = positionals[1];
    if (!version) {
      deps.error("缺少版本号。用法: c4a version switch <version>");
      process.exitCode = 1;
      return;
    }
    const config = await ensureConfig(deps);
    if (!config) {
      process.exitCode = 1;
      return;
    }
    if (!config.rootId) {
      printErrorResponse(buildErrorResponse("C4A-VER-999", "未配置 root_id，无法切换版本"));
      process.exitCode = 1;
      return;
    }

    const { transport, baseUrl } = resolveMcpClientConfig(config);
    const client = deps.createMcpClient({ baseUrl, transport });
    const exists = await checkVersionExists(client, config.rootId, version);
    if (!exists) {
      printErrorResponse(
        buildErrorResponse("C4A-VER-001", `版本 ${version} 不存在`, {
          field: "version",
          expected: "已存在的版本",
          actual: version,
          suggestion: `使用 c4a version create ${version} 创建新版本`,
        }),
      );
      process.exitCode = 1;
      return;
    }

    if (!config.hasContextDir) {
      await updatePackageJsonVersion(config.rootDir, version);
      const leftover = await findDslFiles(config.rootDir);
      if (leftover.length > 0) {
        deps.log(
          `警告：检测到 .context/ 下存在旧版本的 DSL 文件，当前配置版本已更新为 ${version}。`,
        );
        deps.log("提示：运行 c4a version pull 更新本地文件，或手动删除 .context/ 目录。");
      }
      deps.log(`已切换工作版本: ${version}`);
      return;
    }

    const skipPull = options["no-pull"] === true;
    if (!skipPull && options.yes !== true) {
      const confirmed = await deps.confirm(
        "切换版本将清除 .context/ 下不属于目标版本的 DSL 文件，确认？",
      );
      if (!confirmed) {
        deps.log("已取消切换");
        return;
      }
    }

    const currentConfig = (await readProjectConfig(config.rootDir)) ?? {};
    await writeProjectConfig(config.rootDir, { ...currentConfig, version });

    if (skipPull) {
      deps.log(`已切换工作版本: ${version}`);
      return;
    }

    try {
      const result = await pullVersion({
        client,
        config: { ...config, version },
        confirmCreateContext: deps.confirm,
      });
      if (result.canceled) {
        deps.log("已取消切换");
        return;
      }
      deps.log(`已切换到版本 ${version}（拉取 ${result.entityCount} 个）`);
    } catch (error) {
      if (error instanceof PullEngineError) {
        printErrorResponse(buildErrorResponse(error.code, error.message, error.details));
      } else {
        deps.error(`切换失败: ${String(error)}`);
      }
      process.exitCode = 1;
    }
    return;
  }

  if (
    subcommand === "create" ||
    subcommand === "push" ||
    subcommand === "release" ||
    subcommand === "delete"
  ) {
    deps.log(`子命令 ${subcommand} 尚未实现`);
    return;
  }

  deps.error(`未知子命令: ${subcommand}`);
  printHelp(deps.log);
  process.exitCode = 1;
}
