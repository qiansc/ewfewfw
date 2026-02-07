import type { ListResult } from "@c4a/storage";
import { loadProjectConfig, saveProjectConfig } from "../core/config.js";
import { McpClient, type McpTransport } from "../core/mcp-client.js";
import { parseArgs } from "../utils/args.js";

type McpClientLike = {
  request<T>(method: string, params: unknown): Promise<T>;
};

type VersionCommandDeps = {
  loadProjectConfig: typeof loadProjectConfig;
  saveProjectConfig: typeof saveProjectConfig;
  createMcpClient: (options: { baseUrl?: string; transport?: McpTransport }) => McpClientLike;
  log: (message: string) => void;
  error: (message: string) => void;
};

const DEFAULT_DEPS: VersionCommandDeps = {
  loadProjectConfig,
  saveProjectConfig,
  createMcpClient: (options) => new McpClient(options),
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

const LIST_LIMIT = 200;

function printHelp(): void {
  console.log("c4a version switch <version>");
  console.log("c4a version add <version> [--entity <uuid>] [--all]");
  console.log("c4a version remove <version> [--entity <uuid>] [--all]");
  console.log("c4a version list [--entity <uuid>]");
  console.log("c4a version publish <version> [--latest | --no-latest]");
}

function resolveRootId(projectConfig: Awaited<ReturnType<typeof loadProjectConfig>>): string | null {
  if (!projectConfig) return null;
  return projectConfig.root_id ?? null;
}

function resolveTransport(mode?: string): McpTransport {
  if (mode === "remote" || mode === "server") {
    return "http";
  }
  return "stdio";
}

function resolveBaseUrl(projectConfig: Awaited<ReturnType<typeof loadProjectConfig>>): string | undefined {
  const mode = projectConfig?.mode;
  if (mode === "remote") return projectConfig?.remote?.url;
  if (mode === "server") return projectConfig?.server?.url;
  return undefined;
}

async function fetchAllEntities(
  client: McpClientLike,
  rootId: string,
): Promise<Array<{ uuid: string; versions?: string[] }>> {
  const items: Array<{ uuid: string; versions?: string[] }> = [];
  let offset = 0;
  while (true) {
    const result = await client.request<ListResult>("c4a_store_list", {
      root_id: rootId,
      type: "all",
      limit: LIST_LIMIT,
      offset,
    });
    const pageItems = (result as { items?: Array<{ uuid: string; versions?: string[] }> }).items ?? [];
    items.push(...pageItems);
    const hasMore = (result as { pagination?: { has_more?: boolean } }).pagination?.has_more ?? false;
    if (!hasMore || pageItems.length === 0) {
      break;
    }
    offset += pageItems.length;
  }
  return items;
}

export async function versionCommand(
  args: string[],
  deps: VersionCommandDeps = DEFAULT_DEPS,
): Promise<void> {
  const { positionals, options } = parseArgs(args);
  const subcommand = positionals[0];

  if (!subcommand || subcommand === "help" || options.help) {
    printHelp();
    return;
  }

  if (subcommand === "switch") {
    const version = positionals[1];
    if (!version) {
      deps.error("缺少版本号。用法: c4a version switch <version>");
      process.exitCode = 1;
      return;
    }
    const projectConfig = (await deps.loadProjectConfig()) ?? {};
    const updated = { ...projectConfig, version };
    await deps.saveProjectConfig(updated);
    deps.log(`已切换工作版本: ${version}`);
    return;
  }

  const projectConfig = await deps.loadProjectConfig();
  const rootId = resolveRootId(projectConfig);
  const mode = projectConfig?.mode;
  const transport = resolveTransport(mode);
  const baseUrl = resolveBaseUrl(projectConfig);
  const client = deps.createMcpClient({ baseUrl, transport });

  if (subcommand === "add" || subcommand === "remove") {
    const version = positionals[1];
    if (!version) {
      deps.error(`缺少版本号。用法: c4a version ${subcommand} <version> [--entity <uuid>] [--all]`);
      process.exitCode = 1;
      return;
    }

    const entityUuid = typeof options.entity === "string" ? options.entity : null;
    const all = Boolean(options.all);
    if ((entityUuid && all) || (!entityUuid && !all)) {
      deps.error("请指定 --entity <uuid> 或 --all（二选一）");
      process.exitCode = 1;
      return;
    }

    if (all) {
      if (!rootId) {
        deps.error("未配置 root_id，无法对全量实体操作。请先在 .context/.c4a.yaml 配置 root_id");
        process.exitCode = 1;
        return;
      }
      const entities = await fetchAllEntities(client, rootId);
      if (entities.length === 0) {
        deps.log("未找到可操作的实体");
        return;
      }
      const failures: Array<{ uuid: string; error: string }> = [];
      for (const entity of entities) {
        try {
          await client.request(
            subcommand === "add" ? "c4a_store_add_version" : "c4a_store_remove_version",
            {
              uuid: entity.uuid,
              version,
            },
          );
        } catch (error) {
          failures.push({ uuid: entity.uuid, error: String(error) });
        }
      }
      deps.log(
        `${subcommand === "add" ? "追加" : "移除"}完成: ${entities.length - failures.length}/${
          entities.length
        }`,
      );
      if (failures.length > 0) {
        deps.error("部分实体处理失败:");
        for (const failure of failures) {
          deps.error(`- ${failure.uuid}: ${failure.error}`);
        }
        process.exitCode = 1;
      }
      return;
    }

    try {
      const result = await client.request<{ versions?: string[]; warning?: string }>(
        subcommand === "add" ? "c4a_store_add_version" : "c4a_store_remove_version",
        {
          uuid: entityUuid,
          version,
        },
      );
      deps.log(`实体 ${entityUuid} 版本更新完成`);
      if (result.warning) {
        deps.log(`提示: ${result.warning}`);
      }
      if (result.versions) {
        deps.log(`当前版本: ${result.versions.join(", ")}`);
      }
    } catch (error) {
      deps.error(`版本更新失败: ${String(error)}`);
      process.exitCode = 1;
    }
    return;
  }

  if (subcommand === "list") {
    const entityUuid = typeof options.entity === "string" ? options.entity : null;
    if (entityUuid) {
      try {
        const result = await client.request<{ entity?: { versions?: string[] } }>("c4a_store_read", {
          uuid: entityUuid,
        });
        const versions = result.entity?.versions ?? [];
        if (versions.length === 0) {
          deps.log("未找到版本记录");
        } else {
          deps.log(versions.join("\n"));
        }
      } catch (error) {
        deps.error(`读取实体失败: ${String(error)}`);
        process.exitCode = 1;
      }
      return;
    }

    if (!rootId) {
      deps.error("未配置 root_id，无法列出版本。请先在 .context/.c4a.yaml 配置 root_id");
      process.exitCode = 1;
      return;
    }

    try {
      const entities = await fetchAllEntities(client, rootId);
      const versionSet = new Set<string>();
      for (const entity of entities) {
        (entity.versions ?? []).forEach((ver) => versionSet.add(ver));
      }
      const versions = Array.from(versionSet).sort();
      if (versions.length === 0) {
        deps.log("未找到版本记录");
      } else {
        deps.log(versions.join("\n"));
      }
    } catch (error) {
      deps.error(`读取版本列表失败: ${String(error)}`);
      process.exitCode = 1;
    }
    return;
  }

  if (subcommand === "publish") {
    const version = positionals[1];
    if (!version) {
      deps.error("缺少版本号。用法: c4a version publish <version> [--latest | --no-latest]");
      process.exitCode = 1;
      return;
    }
    if (!rootId) {
      deps.error("未配置 root_id，无法发布版本。请先在 .context/.c4a.yaml 配置 root_id");
      process.exitCode = 1;
      return;
    }
    const transferLatest = options.latest ? true : options["no-latest"] ? false : undefined;
    try {
      const result = await client.request<{
        version?: string;
        warnings?: string[];
        updated_entities?: number;
        skipped_entities?: number;
        latest_transferred?: boolean;
      }>("c4a_store_publish_version", {
        root_id: rootId,
        version,
        transfer_latest: transferLatest,
      });
      deps.log(`已发布版本: ${result.version ?? version}`);
      if (typeof result.updated_entities === "number") {
        deps.log(`更新实体: ${result.updated_entities}`);
      }
      if (typeof result.skipped_entities === "number") {
        deps.log(`跳过实体: ${result.skipped_entities}`);
      }
      if (typeof result.latest_transferred === "boolean") {
        deps.log(`Latest 转移: ${result.latest_transferred ? "是" : "否"}`);
      }
      if (result.warnings && result.warnings.length > 0) {
        deps.log("警告:");
        for (const warning of result.warnings) {
          deps.log(`- ${warning}`);
        }
      }
    } catch (error) {
      deps.error(`发布失败: ${String(error)}`);
      process.exitCode = 1;
    }
    return;
  }

  deps.error(`未知子命令: ${subcommand}`);
  printHelp();
  process.exitCode = 1;
}
