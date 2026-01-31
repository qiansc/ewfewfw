import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { gunzipSync } from "node:zlib";
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
  type ContainerStatus,
  type CommandResult,
} from "../utils/docker.js";
import { promptConfirm } from "../utils/prompt.js";

interface CommandIO {
  log: (message: string) => void;
  error: (message: string) => void;
}

interface ServerCommandDeps {
  io?: CommandIO;
  docker?: {
    checkDockerInstalled: typeof checkDockerInstalled;
    getContainerStatus: typeof getContainerStatus;
    restartContainers: typeof restartContainers;
    stopContainers: typeof stopContainers;
    getContainerLogs: typeof getContainerLogs;
  };
  confirm?: (message: string) => Promise<boolean>;
  loadConfig?: typeof loadGlobalConfig;
  createMcpClient?: (options: { baseUrl?: string; transport?: McpTransport }) => McpClient;
  emitError?: (response: ReturnType<typeof buildErrorResponse>) => void;
  permissionChecker?: (backupFile: string, user?: string) => Promise<PermissionSummary>;
  composeDown?: (composeFile: string) => Promise<CommandResult>;
}

interface BackupEntity {
  source_project?: string;
}

interface PermissionSummary {
  total: number;
  allowed: number;
  denied: number;
  projects: Record<string, { total: number; allowed: number; denied: number }>;
}

const SERVER_STATUS_SERVICES = [
  { label: "MongoDB", container: "c4a-mongodb", ports: "27017" },
  { label: "Neo4j", container: "c4a-neo4j", ports: "7474/7687" },
  { label: "Milvus", container: "c4a-milvus", ports: "19530" },
  { label: "Ollama", container: "c4a-ollama", ports: "11434" },
];

const SERVER_CONTAINERS = SERVER_STATUS_SERVICES.map((item) => item.container);

const SERVER_CONTAINER_ALIASES: Record<string, string> = {
  mongodb: "c4a-mongodb",
  neo4j: "c4a-neo4j",
  milvus: "c4a-milvus",
  ollama: "c4a-ollama",
};

function printHelp(io: CommandIO): void {
  io.log("c4a server <command>");
  io.log("可用子命令: status, restart, stop, logs, backup, restore, clean, check-permissions");
}

function resolveContainerName(input: string): string {
  return SERVER_CONTAINER_ALIASES[input] ?? input;
}

function formatContainerSummary(
  service: { label: string; container: string; ports: string },
  item?: ContainerStatus,
): string {
  const state =
    item?.state === "running"
      ? "运行中"
      : item?.state === "exited"
        ? "已停止"
        : item?.state === "not_found"
          ? "未创建"
          : "未知";
  const health =
    item?.health === "healthy"
      ? "健康"
      : item?.health === "unhealthy"
        ? "异常"
        : item?.health === "starting"
          ? "启动中"
          : "未知";
  const ports = item?.ports ?? service.ports;
  return `${service.label} (${service.container}) | ${ports} | ${state} | ${health}`;
}

function buildBackupFilename(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const name = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `c4a-backup-${name}.tar.gz`;
}

function extractTarJson(archive: Buffer): string {
  if (archive.length < 512) {
    throw new Error("备份文件格式错误");
  }
  const sizeRaw = archive.toString("utf-8", 124, 136).replace(/\0.*$/, "").trim();
  const size = Number.parseInt(sizeRaw, 8);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("备份文件格式错误");
  }
  const start = 512;
  const end = start + size;
  if (end > archive.length) {
    throw new Error("备份文件格式错误");
  }
  return archive.toString("utf-8", start, end);
}

async function readBackupEntities(backupFile: string): Promise<BackupEntity[]> {
  const raw = await readFile(backupFile);
  const isGzip = backupFile.endsWith(".gz");
  const buffer = isGzip ? gunzipSync(raw) : raw;
  const isTar = backupFile.endsWith(".tar.gz") || backupFile.endsWith(".tgz");
  const jsonText = isTar ? extractTarJson(buffer) : buffer.toString("utf-8");
  const data = JSON.parse(jsonText) as { entities?: BackupEntity[] };
  if (!Array.isArray(data.entities)) {
    throw new Error("备份文件缺少 entities 字段");
  }
  return data.entities;
}

function summarizePermissions(entities: BackupEntity[]): PermissionSummary {
  const projects: PermissionSummary["projects"] = {};
  for (const entity of entities) {
    const project = entity.source_project || "unknown";
    if (!projects[project]) {
      projects[project] = { total: 0, allowed: 0, denied: 0 };
    }
    projects[project].total += 1;
    projects[project].allowed += 1;
  }
  const totals = Object.values(projects).reduce(
    (acc, stats) => {
      acc.total += stats.total;
      acc.allowed += stats.allowed;
      acc.denied += stats.denied;
      return acc;
    },
    { total: 0, allowed: 0, denied: 0 },
  );
  return { ...totals, projects };
}

async function runComposeDown(composeFile: string): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    execFile(
      "docker",
      ["compose", "-f", composeFile, "down", "-v"],
      { encoding: "utf-8" },
      (error, stdout, stderr) => {
        if (error) {
          resolveResult({
            stdout: stdout ?? "",
            stderr: stderr ?? (error as Error).message,
            exitCode: typeof (error as NodeJS.ErrnoException).code === "number" ? (error as NodeJS.ErrnoException).code : 1,
          });
          return;
        }
        resolveResult({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
      },
    );
  });
}

export async function serverCommand(
  args: string[],
  deps: ServerCommandDeps = {},
): Promise<void> {
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
  const permissionChecker = deps.permissionChecker ?? (async (backupFile: string) => {
    const entities = await readBackupEntities(backupFile);
    return summarizePermissions(entities);
  });

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
      const statuses = await docker.getContainerStatus(SERVER_CONTAINERS);
      const statusMap = new Map(statuses.map((item) => [item.name, item]));
      io.log("服务状态:");
      for (const service of SERVER_STATUS_SERVICES) {
        const item = statusMap.get(service.container);
        io.log(formatContainerSummary(service, item));
      }
      return;
    }
      case "restart": {
      const result = await docker.restartContainers(SERVER_CONTAINERS);
      if (result.exitCode !== 0) {
        emitError(
          buildErrorResponse("C4A-SERVER-003", result.stderr || "重启失败"),
        );
        process.exitCode = 1;
        return;
      }
      io.log("已重启 C4A 服务容器。");
      return;
    }
      case "stop": {
      const result = await docker.stopContainers(SERVER_CONTAINERS);
      if (result.exitCode !== 0) {
        emitError(
          buildErrorResponse("C4A-SERVER-004", result.stderr || "停止失败"),
        );
        process.exitCode = 1;
        return;
      }
      io.log("已停止 C4A 服务容器。");
      return;
    }
      case "logs": {
      const target = positionals[1];
      const containerName = target ? resolveContainerName(target) : undefined;
      const tail = typeof options.tail === "string" ? Number(options.tail) : 200;
      const result = await docker.getContainerLogs(containerName, {
        tail: Number.isFinite(tail) ? tail : 200,
        timestamps: true,
      });
      if (result.exitCode !== 0) {
        emitError(
          buildErrorResponse("C4A-SERVER-005", result.stderr || "获取日志失败"),
        );
        process.exitCode = 1;
        return;
      }
      io.log(result.stdout.trim() || "暂无日志");
      return;
    }
      case "backup": {
      const output =
        typeof options.output === "string" && options.output
          ? options.output
          : buildBackupFilename();
      const status =
        typeof options.status === "string" && ["published", "approved", "all"].includes(options.status)
          ? options.status
          : "published";
      const format =
        typeof options.format === "string" && ["tar.gz", "json"].includes(options.format)
          ? options.format
          : "tar.gz";
      const client = createMcpClient({ baseUrl: config?.server?.url, transport: "stdio" });
      const result = await client.request<{ success: boolean; file?: string; error?: string }>(
        "c4a_store_backup",
        { output, status_filter: status, format, include_metadata: true },
      );
      if (!result.success) {
        emitError(
          buildErrorResponse("C4A-SERVER-006", result.error ?? "备份失败"),
        );
        process.exitCode = 1;
        return;
      }
      io.log(`备份完成: ${result.file ?? output}`);
      return;
    }
      case "restore": {
      const input =
        typeof options.input === "string"
          ? options.input
          : typeof positionals[1] === "string"
            ? positionals[1]
            : "";
      if (!input) {
        emitError(
          buildErrorResponse("C4A-SERVER-007", "缺少备份文件路径", {
            field: "input",
            suggestion: "例如: c4a server restore ./backup.tar.gz",
          }),
        );
        process.exitCode = 1;
        return;
      }
      const permissionSummary = await permissionChecker(
        input,
        typeof options.user === "string" ? options.user : undefined,
      );
      if (permissionSummary.denied > 0) {
        io.log("⚠️  权限预检查发现不可导入实体：");
        for (const [project, stats] of Object.entries(permissionSummary.projects)) {
          if (stats.denied > 0) {
            io.log(`- ${project}: 无权限 ${stats.denied} 个实体`);
          }
        }
      }
      const confirmed = options.yes === true ? true : await confirm("恢复操作会覆盖现有数据，确认继续？");
      if (!confirmed) {
        io.log("已取消恢复操作。");
        return;
      }
      const conflictPolicy =
        typeof options["conflict-policy"] === "string" ? options["conflict-policy"] : "skip";
      const validateChecksums =
        typeof options["validate-checksums"] === "string"
          ? options["validate-checksums"] !== "false"
          : true;
      const client = createMcpClient({ baseUrl: config?.server?.url, transport: "stdio" });
      const result = await client.request<{ success: boolean; error?: string }>(
        "c4a_store_restore",
        {
          input,
          conflict_policy: conflictPolicy as "skip" | "override" | "merge" | "error",
          validate_checksums: validateChecksums,
        },
      );
      if (!result.success) {
        emitError(
          buildErrorResponse("C4A-SERVER-008", result.error ?? "恢复失败"),
        );
        process.exitCode = 1;
        return;
      }
      io.log("恢复完成。");
      return;
    }
      case "clean": {
      const confirmed = options.yes === true ? true : await confirm("清理将删除所有服务数据，确认继续？");
      if (!confirmed) {
        io.log("已取消清理操作。");
        return;
      }
      const composeFile = resolve(import.meta.dirname, "../../../..", "docker", "docker-compose.yml");
      if (!existsSync(composeFile)) {
        emitError(
          buildErrorResponse("C4A-SERVER-009", "未找到 docker-compose.yml，无法执行清理"),
        );
        process.exitCode = 1;
        return;
      }
      const result = await composeDown(composeFile);
      if (result.exitCode !== 0) {
        emitError(
          buildErrorResponse("C4A-SERVER-010", result.stderr || "清理失败"),
        );
        process.exitCode = 1;
        return;
      }
      io.log("已清理服务数据。");
      return;
    }
      case "check-permissions": {
      const backupFile =
        typeof options.backup === "string"
          ? options.backup
          : typeof positionals[1] === "string"
            ? positionals[1]
            : "";
      if (!backupFile) {
        emitError(
          buildErrorResponse("C4A-SERVER-011", "缺少备份文件参数 --backup", {
            field: "backup",
            suggestion: "例如: c4a server check-permissions --backup ./backup.tar.gz",
          }),
        );
        process.exitCode = 1;
        return;
      }
      const summary = await permissionChecker(
        backupFile,
        typeof options.user === "string" ? options.user : undefined,
      );
      const outputJson = options.format === "json";
      if (outputJson) {
        io.log(JSON.stringify(summary, null, 2));
        return;
      }
      io.log("权限预检查结果:");
      for (const [project, stats] of Object.entries(summary.projects)) {
        const label = stats.denied > 0 ? "❌" : "✅";
        io.log(`${label} ${project}: 可导入 ${stats.allowed} / 无权限 ${stats.denied}`);
      }
      io.log(`总计: 可导入 ${summary.allowed} / 无权限 ${summary.denied}`);
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
    emitError(
      buildErrorResponse("C4A-SERVER-999", (error as Error).message || "命令执行失败"),
    );
    process.exitCode = 1;
  }
}
