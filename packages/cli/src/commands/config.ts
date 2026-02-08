import { homedir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "@c4a/storage";
import {
  loadGlobalConfig,
  saveGlobalConfig,
  removeGlobalConfig,
  type GlobalConfig,
  resolveHomeDir,
} from "../core/config.js";
import { type Prompter } from "../core/firstRun.js";
import { parseArgs } from "../utils/args.js";
import { buildErrorResponse, printErrorResponse } from "../utils/errorResponse.js";
import { promptConfirm, promptInput } from "../utils/prompt.js";

interface CommandIO {
  log: (message: string) => void;
  error: (message: string) => void;
}

interface ConfigCommandDeps {
  io?: CommandIO;
  loadGlobalConfig?: typeof loadGlobalConfig;
  saveGlobalConfig?: typeof saveGlobalConfig;
  removeGlobalConfig?: typeof removeGlobalConfig;
  prompter?: Prompter;
  ensureLocalStore?: (dbPath: string) => Promise<void>;
  checkServerUrl?: (url: string) => Promise<boolean>;
  emitError?: (response: ReturnType<typeof buildErrorResponse>) => void;
}

const DEFAULT_SERVER_URL = "http://localhost:8055";

function normalizeHttpUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

function resolveDefaultDbPath(): string {
  return join(resolveHomeDir(), ".c4a", "store.db");
}

async function ensureLocalStore(dbPath: string): Promise<void> {
  const store = SQLiteStore.getInstance({ dbPath });
  store.getDatabase();
  store.close();
}

async function defaultCheckServerUrl(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/health`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

function createDefaultPrompter(): Prompter {
  return {
    input: async (label, options) => {
      while (true) {
        const value = await promptInput(label, options?.defaultValue);
        if (!options?.required || value.trim()) {
          return value.trim();
        }
        console.error("输入不能为空，请重试。");
      }
    },
    confirm: async (label, defaultValue = false) => promptConfirm(label, defaultValue),
    select: async (label, options, defaultIndex = 0) => {
      const choices = options.map((item, index) => `${index + 1}) ${item.label}`).join("\n");
      while (true) {
        const answer = await promptInput(`${label}\n${choices}`, String(defaultIndex + 1));
        const index = Number(answer) - 1;
        if (!Number.isNaN(index) && options[index]) {
          return options[index].value;
        }
        console.error("无效选择，请输入选项编号。");
      }
    },
  };
}

function printHelp(io: CommandIO): void {
  io.log("c4a config <command>");
  io.log("命令:");
  io.log("  mode              交互式切换工作模式");
  io.log("  show              查看当前全局配置");
  io.log("  set [options]     设置配置项");
  io.log("  reset             重置全局配置");
  io.log("");
  io.log("选项:");
  io.log("  --mode=local|remote      设置工作模式");
  io.log("  --server_url=<url>       设置 MCP 服务地址");
}

async function handleShow(
  io: CommandIO,
  loadConfig: typeof loadGlobalConfig,
  emitError: (response: ReturnType<typeof buildErrorResponse>) => void,
): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    emitError(
      buildErrorResponse("C4A-CONFIG-001", "未检测到全局配置", {
        suggestion: "请运行 c4a config mode 或 c4a init 进行初始化",
      }),
    );
    process.exitCode = 1;
    return;
  }

  const configPath = join(homedir(), ".c4a", "config.yaml");
  io.log(`全局配置 (${configPath}):`);
  io.log(`  模式: ${config.mode ?? "未设置"}`);
  io.log(`  服务地址: ${config.server_url ?? DEFAULT_SERVER_URL}`);
  io.log(`  数据库: ${config.local?.db_path ?? resolveDefaultDbPath()}`);
}

async function handleMode(
  io: CommandIO,
  deps: ConfigCommandDeps,
): Promise<void> {
  const prompter = deps.prompter ?? createDefaultPrompter();
  const loadConfig = deps.loadGlobalConfig ?? loadGlobalConfig;
  const saveConfig = deps.saveGlobalConfig ?? saveGlobalConfig;
  const ensureLocal = deps.ensureLocalStore ?? ensureLocalStore;
  const checkServerUrl = deps.checkServerUrl ?? defaultCheckServerUrl;

  const current = await loadConfig();
  const currentMode = current?.mode ?? "local";
  io.log(`当前模式: ${currentMode}`);

  const mode = await prompter.select(
    "选择工作模式:",
    [
      { label: "local   - 轻量，无服务，数据存储在 ~/.c4a/", value: "local" },
      { label: "remote  - 连接 MCP 服务（本机或远程）", value: "remote" },
    ],
    currentMode === "remote" ? 1 : 0,
  );

  let serverUrl = current?.server_url ?? DEFAULT_SERVER_URL;
  if (mode === "remote") {
    while (true) {
      const inputUrl = await prompter.input("MCP 服务地址", {
        defaultValue: serverUrl,
        required: true,
      });
      serverUrl = normalizeHttpUrl(inputUrl);
      io.log("连接测试 ...");
      if (await checkServerUrl(serverUrl)) {
        io.log("连接测试 ✅");
        break;
      }
      io.error("连接失败，请检查服务地址后重试。");
    }
  }

  const nextConfig: GlobalConfig = {
    version: "0.3.2",
    mode,
    server_url: serverUrl,
    local: { db_path: current?.local?.db_path ?? resolveDefaultDbPath() },
  };

  if (mode === "local") {
    await ensureLocal(nextConfig.local?.db_path ?? resolveDefaultDbPath());
  }

  await saveConfig(nextConfig);
  io.log(`✓ 已切换到 ${mode} 模式`);
}

async function handleSet(
  args: string[],
  deps: ConfigCommandDeps,
): Promise<void> {
  const io = deps.io ?? console;
  const emitError = deps.emitError ?? printErrorResponse;
  const loadConfig = deps.loadGlobalConfig ?? loadGlobalConfig;
  const saveConfig = deps.saveGlobalConfig ?? saveGlobalConfig;
  const ensureLocal = deps.ensureLocalStore ?? ensureLocalStore;
  const checkServerUrl = deps.checkServerUrl ?? defaultCheckServerUrl;

  const { options } = parseArgs(args);
  const modeOption = typeof options.mode === "string" ? options.mode : undefined;
  const serverUrlOption = typeof options.server_url === "string" ? options.server_url : undefined;

  if (!modeOption && !serverUrlOption) {
    emitError(
      buildErrorResponse("C4A-CONFIG-002", "未提供任何配置项", {
        suggestion: "请使用 --mode 或 --server_url 设置配置",
      }),
    );
    process.exitCode = 1;
    return;
  }

  const current = await loadConfig();
  const nextMode = modeOption ?? current?.mode ?? "local";
  if (nextMode !== "local" && nextMode !== "remote") {
    emitError(
      buildErrorResponse("C4A-CONFIG-003", `不支持的模式: ${String(nextMode)}`),
    );
    process.exitCode = 1;
    return;
  }

  let nextServerUrl = current?.server_url ?? DEFAULT_SERVER_URL;
  if (serverUrlOption) {
    nextServerUrl = normalizeHttpUrl(serverUrlOption);
  }

  if (nextMode === "remote") {
    if (!nextServerUrl) {
      emitError(
        buildErrorResponse("C4A-CONFIG-004", "remote 模式需要配置 server_url"),
      );
      process.exitCode = 1;
      return;
    }
    io.log("连接测试 ...");
    if (!(await checkServerUrl(nextServerUrl))) {
      emitError(
        buildErrorResponse("C4A-CONFIG-005", "无法连接到 MCP 服务", {
          actual: nextServerUrl,
        }),
      );
      process.exitCode = 1;
      return;
    }
  }

  const nextConfig: GlobalConfig = {
    version: "0.3.2",
    mode: nextMode,
    server_url: nextServerUrl,
    local: { db_path: current?.local?.db_path ?? resolveDefaultDbPath() },
  };

  if (nextMode === "local") {
    await ensureLocal(nextConfig.local?.db_path ?? resolveDefaultDbPath());
  }

  await saveConfig(nextConfig);
  io.log("已更新全局配置。");
}

async function handleReset(
  io: CommandIO,
  deps: ConfigCommandDeps,
): Promise<void> {
  const confirm = deps.prompter?.confirm ?? promptConfirm;
  const removeConfig = deps.removeGlobalConfig ?? removeGlobalConfig;

  const confirmed = await confirm("确认重置全局配置?", false);
  if (!confirmed) {
    io.log("已取消操作。");
    return;
  }

  await removeConfig();
  io.log("✓ 全局配置已重置");
}

export async function configCommand(
  args: string[],
  deps: ConfigCommandDeps = {},
): Promise<void> {
  const io: CommandIO = deps.io ?? console;
  const emitError = deps.emitError ?? printErrorResponse;

  const { positionals, options } = parseArgs(args);
  const subcommand = positionals[0];

  if (!subcommand || subcommand === "help" || options.help) {
    printHelp(io);
    return;
  }

  switch (subcommand) {
    case "show":
      await handleShow(io, deps.loadGlobalConfig ?? loadGlobalConfig, emitError);
      return;
    case "mode":
      await handleMode(io, deps);
      return;
    case "set":
      await handleSet(args.slice(1), deps);
      return;
    case "reset":
      await handleReset(io, deps);
      return;
    default:
      emitError(
        buildErrorResponse("C4A-CONFIG-999", `未知子命令: ${subcommand}`, {
          suggestion: "运行 c4a config help 查看可用子命令",
        }),
      );
      process.exitCode = 1;
  }
}
