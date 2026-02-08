import type { GlobalConfig } from "../core/config.js";
import type { McpClient, McpTransport } from "../core/mcp-client.js";
import { buildErrorResponse } from "../utils/errorResponse.js";
import type { CommandIO, PermissionSummary } from "./serverTypes.js";
import { buildBackupFilename, formatBytes } from "./serverHelpers.js";

export async function handleBackup(params: {
  io: CommandIO;
  createMcpClient: (options: { baseUrl?: string; transport?: McpTransport }) => McpClient;
  config: GlobalConfig | null;
  options: Record<string, string | boolean>;
  emitError: (response: ReturnType<typeof buildErrorResponse>) => void;
}): Promise<void> {
  const { io, createMcpClient, config, options, emitError } = params;
  const output =
    typeof options.output === "string" && options.output ? options.output : buildBackupFilename();
  const status =
    typeof options.status === "string" && ["published", "approved", "all"].includes(options.status)
      ? options.status
      : "published";
  const format =
    typeof options.format === "string" && ["tar.gz", "json"].includes(options.format)
      ? options.format
      : "tar.gz";
  const baseUrl = config?.server_url ?? config?.remote?.url ?? config?.server?.url;
  const client = createMcpClient({ baseUrl, transport: "http" });
  io.log("正在备份服务器数据...");
  const result = await client.request<{
    success: boolean;
    file?: string;
    size?: number;
    format_version?: string;
    stats?: { entities: number; relations: number; vectors: number };
    error?: string;
  }>("c4a_store_backup", { output, status_filter: status, format, include_metadata: true });
  if (!result.success) {
    emitError(buildErrorResponse("C4A-SERVER-006", result.error ?? "备份失败"));
    process.exitCode = 1;
    return;
  }
  const file = result.file ?? output;
  io.log("✅ 备份完成");
  io.log(`文件: ${file}`);
  if (typeof result.size === "number") {
    io.log(`大小: ${formatBytes(result.size)}`);
  }
  if (result.stats) {
    io.log(`包含: ${result.stats.entities} 个实体, ${result.stats.relations} 个关系, ${result.stats.vectors} 个向量`);
  }
}

export async function handleRestore(params: {
  io: CommandIO;
  createMcpClient: (options: { baseUrl?: string; transport?: McpTransport }) => McpClient;
  config: GlobalConfig | null;
  options: Record<string, string | boolean>;
  positionals: string[];
  confirm: (message: string) => Promise<boolean>;
  emitError: (response: ReturnType<typeof buildErrorResponse>) => void;
  permissionChecker: (backupFile: string, user?: string) => Promise<PermissionSummary>;
  userId: string;
}): Promise<void> {
  const {
    io,
    createMcpClient,
    config,
    options,
    positionals,
    confirm,
    emitError,
    permissionChecker,
    userId,
  } = params;
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
  const permissionSummary = await permissionChecker(input, userId);
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
    typeof options["validate-checksums"] === "string" ? options["validate-checksums"] !== "false" : true;
  const baseUrl = config?.server_url ?? config?.remote?.url ?? config?.server?.url;
  const client = createMcpClient({ baseUrl, transport: "http" });
  io.log("正在恢复服务器数据...");
  const result = await client.request<{
    success: boolean;
    format_version?: string;
    compatible?: boolean;
    stats?: { entities: number; relations: number; vectors: number };
    conflicts?: Array<{ entity_id: string; reason: string; resolution: string }>;
    error?: string;
  }>("c4a_store_restore", {
    input,
    conflict_policy: conflictPolicy as "skip" | "override" | "merge" | "error",
    validate_checksums: validateChecksums,
  });
  if (!result.success) {
    emitError(buildErrorResponse("C4A-SERVER-008", result.error ?? "恢复失败"));
    process.exitCode = 1;
    return;
  }
  io.log("✅ 恢复完成");
  if (result.stats) {
    io.log(`实体: ${result.stats.entities}, 关系: ${result.stats.relations}, 向量: ${result.stats.vectors}`);
  }
  if (result.conflicts && result.conflicts.length > 0) {
    io.log(`冲突: ${result.conflicts.length} 条`);
  }
}

export async function handleCheckPermissions(params: {
  io: CommandIO;
  options: Record<string, string | boolean>;
  positionals: string[];
  emitError: (response: ReturnType<typeof buildErrorResponse>) => void;
  permissionChecker: (backupFile: string, user?: string) => Promise<PermissionSummary>;
  userId: string;
}): Promise<void> {
  const { io, options, positionals, emitError, permissionChecker, userId } = params;
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
  const summary = await permissionChecker(backupFile, userId);
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
}
