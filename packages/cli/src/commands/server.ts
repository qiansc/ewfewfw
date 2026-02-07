import { loadGlobalConfig, getInstalledModes } from "../core/config.js";
import { McpClient, type McpTransport } from "../core/mcp-client.js";
import { parseArgs } from "../utils/args.js";
import { buildErrorResponse, printErrorResponse } from "../utils/errorResponse.js";
import {
  checkDockerInstalled,
  getContainerStatus,
  restartContainers,
  stopContainers,
  getContainerLogs,
} from "../utils/docker.js";
import { promptConfirm } from "../utils/prompt.js";
import type { CommandIO, ServerCommandDeps } from "./serverTypes.js";
import {
  checkProjectPermission,
  readBackupEntities,
  resolveServerUrl,
  summarizePermissions,
  summarizePermissionsWithCheck,
} from "./serverHelpers.js";
import {
  handleClean,
  handleLogs,
  handleRestart,
  handleStatus,
  handleStop,
  runComposeDown,
} from "./serverDocker.js";
import { handleBackup, handleCheckPermissions, handleRestore } from "./serverBackup.js";
import {
  handleCheckConsistency,
  handleRebuildMilvus,
  handleRebuildNeo4j,
} from "./serverMaintenance.js";

function printHelp(io: CommandIO): void {
  io.log("c4a server <command>");
  io.log("可用子命令:");
  io.log("  status              查看服务状态");
  io.log("  restart             重启服务");
  io.log("  stop                停止服务");
  io.log("  logs [service]      查看日志");
  io.log("  backup              备份数据");
  io.log("  restore <file>      恢复数据");
  io.log("  clean               清理数据");
  io.log("  check-permissions   检查备份文件权限");
  io.log("  check-consistency   检查数据一致性");
  io.log("  rebuild-neo4j       重建 Neo4j 数据");
  io.log("  rebuild-milvus      重建 Milvus 数据");
  io.log("");
  io.log("通用参数:");
  io.log("  --user <id>         指定用户 ID（默认从配置读取）");
  io.log("  --format json       JSON 格式输出");
}

export async function serverCommand(
  args: string[],
  deps: ServerCommandDeps = {},
): Promise<void> {
  function resolveUserId(options: Record<string, unknown>): string {
    if (typeof options.user === "string" && options.user) {
      return options.user;
    }
    return "cli-user";
  }

  const io: CommandIO = deps.io ?? console;
  const docker = deps.docker ?? {
    checkDockerInstalled,
    getContainerStatus,
    restartContainers,
    stopContainers,
    getContainerLogs,
  };
  const loadConfig = deps.loadConfig ?? loadGlobalConfig;
  const createMcpClient =
    deps.createMcpClient ?? ((options: { baseUrl?: string; transport?: McpTransport }) => new McpClient(options));
  const confirm = deps.confirm ?? promptConfirm;
  const composeDown = deps.composeDown ?? runComposeDown;
  const emitError = deps.emitError ?? printErrorResponse;
  const checkHealth = deps.checkHealth;

  const { positionals, options } = parseArgs(args);
  const subcommand = positionals[0];

  if (!subcommand || subcommand === "help" || options.help) {
    printHelp(io);
    return;
  }

  const config = await loadConfig();
  const installed = getInstalledModes(config);
  if (!installed.includes("server")) {
    emitError(
      buildErrorResponse("C4A-SERVER-001", "未检测到 Server 模式安装记录", {
        suggestion: "请先运行 c4a install server",
      }),
    );
    process.exitCode = 1;
    return;
  }

  const permissionChecker =
    deps.permissionChecker ??
    (async (backupFile: string, user?: string) => {
      const entities = await readBackupEntities(backupFile);
      const summary = summarizePermissions(entities);
      const baseUrl = resolveServerUrl(config ?? undefined);
      const userId = user ?? "cli-user";
      return await summarizePermissionsWithCheck(summary, (projectId) =>
        checkProjectPermission(baseUrl, userId, projectId),
      );
    });

  const dockerRequired = new Set(["status", "restart", "stop", "logs", "clean"]);
  if (dockerRequired.has(subcommand)) {
    if (!(await docker.checkDockerInstalled())) {
      emitError(
        buildErrorResponse("C4A-SERVER-002", "Docker 未安装或不可用", {
          suggestion: "请安装 Docker 并确保 docker 命令可用",
        }),
      );
      process.exitCode = 1;
      return;
    }
  }

  try {
    switch (subcommand) {
      case "status": {
      await handleStatus({ io, docker, config, checkHealth });
      return;
    }
      case "restart": {
      await handleRestart({ io, docker, emitError });
      return;
    }
      case "stop": {
      await handleStop({ io, docker, emitError });
      return;
    }
      case "logs": {
      const target = positionals[1];
      const tail = typeof options.tail === "string" ? Number(options.tail) : 200;
      await handleLogs({ io, docker, emitError, target, tail });
      return;
    }
      case "backup": {
      await handleBackup({ io, createMcpClient, config, options, emitError });
      return;
    }
      case "restore": {
      const userId = resolveUserId(options);
      await handleRestore({
        io,
        createMcpClient,
        config,
        options,
        positionals,
        confirm,
        emitError,
        permissionChecker,
        userId,
      });
      return;
    }
      case "clean": {
      await handleClean({ io, confirm, composeDown, emitError });
      return;
    }
      case "check-permissions": {
      const userId = resolveUserId(options);
      await handleCheckPermissions({
        io,
        options,
        positionals,
        emitError,
        permissionChecker,
        userId,
      });
      return;
    }
      case "check-consistency": {
      const userId = resolveUserId(options);
      await handleCheckConsistency({ io, config, options, emitError, userId });
      return;
    }
      case "rebuild-neo4j": {
      const userId = resolveUserId(options);
      await handleRebuildNeo4j({ io, config, options, emitError, confirm, userId });
      return;
    }
      case "rebuild-milvus": {
      const userId = resolveUserId(options);
      await handleRebuildMilvus({ io, config, options, emitError, confirm, userId });
      return;
    }
      default: {
      emitError(
        buildErrorResponse("C4A-SERVER-012", `未知子命令: ${subcommand}`, {
          suggestion: "运行 c4a server help 查看可用子命令",
        }),
      );
      process.exitCode = 1;
      return;
      }
    }
  } catch (error) {
    emitError(buildErrorResponse("C4A-SERVER-999", (error as Error).message || "命令执行失败"));
    process.exitCode = 1;
  }
}
