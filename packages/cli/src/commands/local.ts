import { existsSync } from "node:fs";
import { stat, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAdapter, loadConfig, SQLiteStore } from "@c4a/storage";
import type { StorageAdapter } from "@c4a/storage";
import { loadGlobalConfig, getInstalledModes } from "../core/config.js";
import { parseArgs } from "../utils/args.js";
import { buildErrorResponse, printErrorResponse } from "../utils/errorResponse.js";
import { promptConfirm } from "../utils/prompt.js";

interface CommandIO {
  log: (message: string) => void;
  error: (message: string) => void;
}

interface LocalCommandDeps {
  io?: CommandIO;
  adapterFactory?: (mode: "local") => Promise<StorageAdapter>;
  confirm?: (message: string) => Promise<boolean>;
  loadConfig?: typeof loadConfig;
  loadGlobalConfig?: typeof loadGlobalConfig;
  resolveDbPath?: (globalConfig?: Awaited<ReturnType<typeof loadGlobalConfig>> | null) => string;
  fileOps?: {
    existsSync: typeof existsSync;
    stat: typeof stat;
    rm: typeof rm;
  };
  vacuum?: (dbPath: string) => Promise<void>;
  emitError?: (response: ReturnType<typeof buildErrorResponse>) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = -1;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function buildBackupFilename(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const name = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `c4a-backup-${name}.tar.gz`;
}

function resolveDbPathWithConfig(
  loader: typeof loadConfig,
  globalConfig?: Awaited<ReturnType<typeof loadGlobalConfig>> | null,
): string {
  const config = loader(process.cwd());
  return (
    config.local?.dbPath ??
    globalConfig?.local?.db_path ??
    join(homedir(), ".c4a", "store.db")
  );
}

async function defaultVacuum(dbPath: string): Promise<void> {
  const store = SQLiteStore.getInstance({ dbPath });
  const db = store.getDatabase();
  db.exec("VACUUM;");
  store.close();
}

function printHelp(io: CommandIO): void {
  io.log("c4a local <command>");
  io.log("可用子命令: status, validate, repair, backup, restore, clean, vacuum");
}

export async function localCommand(
  args: string[],
  deps: LocalCommandDeps = {},
): Promise<void> {
  const io: CommandIO = deps.io ?? console;
  const adapterFactory = deps.adapterFactory ?? ((mode) => getAdapter({ forceMode: mode }));
  const confirm = deps.confirm ?? promptConfirm;
  const loadGlobal = deps.loadGlobalConfig ?? loadGlobalConfig;
  const resolveDbPath =
    deps.resolveDbPath ??
    ((globalConfig?: Awaited<ReturnType<typeof loadGlobalConfig>> | null) =>
      resolveDbPathWithConfig(deps.loadConfig ?? loadConfig, globalConfig));
  const fileOps = deps.fileOps ?? { existsSync, stat, rm };
  const vacuum = deps.vacuum ?? defaultVacuum;
  const emitError = deps.emitError ?? printErrorResponse;

  const { positionals, options } = parseArgs(args);
  const subcommand = positionals[0];

  if (!subcommand || subcommand === "help" || options.help) {
    printHelp(io);
    return;
  }

  const globalConfig = await loadGlobal();
  const installed = getInstalledModes(globalConfig);
  if (!installed.includes("local")) {
    emitError(
      buildErrorResponse("C4A-LOCAL-001", "未检测到 Local 模式安装记录", {
        suggestion: "请先运行 c4a install local",
      }),
    );
    process.exitCode = 1;
    return;
  }

  try {
    switch (subcommand) {
      case "status": {
      const dbPath = resolveDbPath(globalConfig);
      if (!fileOps.existsSync(dbPath)) {
        emitError(
          buildErrorResponse("C4A-LOCAL-002", "数据库不存在", {
            actual: dbPath,
            suggestion: "请先运行 c4a install local 初始化数据库",
          }),
        );
        process.exitCode = 1;
        return;
      }
      const stats = await fileOps.stat(dbPath);
      io.log(`数据库: ${dbPath}`);
      io.log(`大小: ${formatBytes(stats.size)}`);
      io.log(`更新时间: ${stats.mtime.toISOString()}`);

      const adapter = await adapterFactory("local");
      await adapter.initialize();
      try {
        const byType = await adapter.list({ group_by: "type" });
        const byStatus = await adapter.list({ group_by: "status" });
        if (byType.groups) {
          io.log("实体类型统计:");
          for (const [key, value] of Object.entries(byType.groups)) {
            io.log(`- ${key}: ${value.count}`);
          }
        }
        if (byStatus.groups) {
          io.log("状态统计:");
          for (const [key, value] of Object.entries(byStatus.groups)) {
            io.log(`- ${key}: ${value.count}`);
          }
        }
        return;
      } finally {
        await adapter.close();
      }
    }
      case "validate": {
      const format = typeof options.format === "string" ? options.format : "text";
      const quiet = options.quiet === true;
      const adapter = await adapterFactory("local");
      await adapter.initialize();
      try {
        const result = await adapter.validate({});
        if (format === "json") {
          io.log(JSON.stringify(result, null, 2));
          return;
        }
        if (!result.success) {
          emitError(
            buildErrorResponse("C4A-LOCAL-003", result.error ?? "校验失败"),
          );
          process.exitCode = 1;
          return;
        }
        if (!quiet && result.summary) {
          io.log(
            `通过: ${result.summary.passed}, 警告: ${result.summary.warnings}, 错误: ${result.summary.errors}`,
          );
        }
        if (!quiet && result.checks) {
          for (const [name, check] of Object.entries(result.checks)) {
            io.log(`${name}: ${check.status}`);
          }
        }
        return;
      } finally {
        await adapter.close();
      }
    }
      case "repair": {
      const dryRun = options["dry-run"] === true;
      const entityIds =
        typeof options["entity-ids"] === "string"
          ? options["entity-ids"].split(",").map((item) => item.trim()).filter(Boolean)
          : undefined;
      const adapter = await adapterFactory("local");
      await adapter.initialize();
      try {
        const result = await adapter.repair({ dry_run: dryRun, entity_ids: entityIds });
        if (!result.success) {
          emitError(
            buildErrorResponse("C4A-LOCAL-004", result.message ?? "修复失败"),
          );
          process.exitCode = 1;
          return;
        }
        io.log(`已扫描 ${result.scanned} 个实体`);
        io.log(`发现 ${result.inconsistencies.length} 项问题`);
        return;
      } finally {
        await adapter.close();
      }
    }
      case "backup": {
      const output =
        typeof options.output === "string" && options.output
          ? options.output
          : buildBackupFilename();
      const status =
        (typeof options.status === "string" && ["published", "approved", "all"].includes(options.status)
          ? options.status
          : "published") as "published" | "approved" | "all";
      const format =
        (typeof options.format === "string" && ["tar.gz", "json"].includes(options.format)
          ? options.format
          : "tar.gz") as "tar.gz" | "json";
      const adapter = await adapterFactory("local");
      await adapter.initialize();
      try {
        const result = await adapter.backup({ output, status_filter: status, format });
        if (!result.success) {
          emitError(
            buildErrorResponse("C4A-LOCAL-005", result.error ?? "备份失败"),
          );
          process.exitCode = 1;
          return;
        }
        io.log(`备份完成: ${result.file ?? output}`);
        return;
      } finally {
        await adapter.close();
      }
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
          buildErrorResponse("C4A-LOCAL-006", "缺少备份文件路径", {
            field: "input",
            suggestion: "例如: c4a local restore ./backup.tar.gz",
          }),
        );
        process.exitCode = 1;
        return;
      }
      const confirmed = options.yes === true ? true : await confirm("恢复操作会覆盖现有数据，确认继续？");
      if (!confirmed) {
        io.log("已取消恢复操作。");
        return;
      }
      const conflictPolicy =
        typeof options["conflict-policy"] === "string" ? options["conflict-policy"] : undefined;
      const validateChecksums =
        typeof options["validate-checksums"] === "string"
          ? options["validate-checksums"] !== "false"
          : true;
      const adapter = await adapterFactory("local");
      await adapter.initialize();
      try {
        const result = await adapter.restore({
          input,
          conflict_policy: conflictPolicy as "skip" | "override" | "merge" | "error" | undefined,
          validate_checksums: validateChecksums,
        });
        if (!result.success) {
          emitError(
            buildErrorResponse("C4A-LOCAL-007", result.error ?? "恢复失败"),
          );
          process.exitCode = 1;
          return;
        }
        io.log("恢复完成。");
        return;
      } finally {
        await adapter.close();
      }
    }
      case "clean": {
      const confirmed = options.yes === true ? true : await confirm("清理将删除本地数据库，确认继续？");
      if (!confirmed) {
        io.log("已取消清理操作。");
        return;
      }
      const dbPath = resolveDbPath(globalConfig);
      if (!fileOps.existsSync(dbPath)) {
        io.log("数据库文件不存在，无需清理。");
        return;
      }
      await fileOps.rm(dbPath, { force: true });
      const dir = dirname(dbPath);
      await fileOps.rm(join(dir, "c4a.usearch"), { force: true });
      await fileOps.rm(join(dir, "c4a.keymap.json"), { force: true });
      io.log("已清理本地数据库文件。");
      return;
    }
      case "vacuum": {
      const dbPath = resolveDbPath(globalConfig);
      if (!fileOps.existsSync(dbPath)) {
        emitError(
          buildErrorResponse("C4A-LOCAL-008", "数据库不存在", {
            actual: dbPath,
            suggestion: "请先运行 c4a install local 初始化数据库",
          }),
        );
        process.exitCode = 1;
        return;
      }
      await vacuum(dbPath);
      io.log("数据库压缩完成。");
      return;
    }
      default: {
      emitError(
        buildErrorResponse("C4A-LOCAL-009", `未知子命令: ${subcommand}`, {
          suggestion: "运行 c4a local help 查看可用子命令",
        }),
      );
      process.exitCode = 1;
      return;
      }
    }
  } catch (error) {
    emitError(
      buildErrorResponse("C4A-LOCAL-999", (error as Error).message || "命令执行失败"),
    );
    process.exitCode = 1;
  }
}
