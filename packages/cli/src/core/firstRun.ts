import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "@c4a/storage";
import {
  loadGlobalConfig,
  saveGlobalConfig,
  type GlobalConfig,
  resolveHomeDir,
} from "./config.js";
import { promptConfirm, promptInput } from "../utils/prompt.js";

export interface Prompter {
  input: (label: string, options?: { defaultValue?: string; required?: boolean }) => Promise<string>;
  confirm: (label: string, defaultValue?: boolean) => Promise<boolean>;
  select: <T extends string>(
    label: string,
    options: Array<{ label: string; value: T }>,
    defaultIndex?: number
  ) => Promise<T>;
}

export interface FirstRunDeps {
  io?: { log: (message: string) => void; error: (message: string) => void };
  prompter?: Prompter;
  loadGlobalConfig?: typeof loadGlobalConfig;
  saveGlobalConfig?: typeof saveGlobalConfig;
  ensureLocalStore?: (dbPath: string) => Promise<void>;
  checkServerUrl?: (url: string) => Promise<boolean>;
}

const DEFAULT_VERSION = "0.3.2";
const DEFAULT_SERVER_URL = "http://localhost:8055";

function normalizeHttpUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

function getDefaultDbPath(): string {
  return join(resolveHomeDir(), ".c4a", "store.db");
}

async function defaultEnsureLocalStore(dbPath: string): Promise<void> {
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

function buildBaseConfig(): GlobalConfig {
  return {
    version: DEFAULT_VERSION,
    mode: "local",
    server_url: DEFAULT_SERVER_URL,
    local: { db_path: getDefaultDbPath() },
  };
}

export async function runFirstRunGuide(deps: FirstRunDeps = {}): Promise<GlobalConfig> {
  const io = deps.io ?? console;
  const prompter = deps.prompter ?? createDefaultPrompter();
  const saveConfig = deps.saveGlobalConfig ?? saveGlobalConfig;
  const ensureLocalStore = deps.ensureLocalStore ?? defaultEnsureLocalStore;
  const checkServerUrl = deps.checkServerUrl ?? defaultCheckServerUrl;

  io.log("\n欢迎使用 C4A — 知识驱动开发平台\n为 AI Agent 提供结构化的架构上下文\n");

  const mode = await prompter.select(
    "选择工作模式:",
    [
      { label: "local   - 轻量，无服务，数据存储在 ~/.c4a/", value: "local" },
      { label: "remote  - 连接 MCP 服务（本机或远程）", value: "remote" },
    ],
    0,
  );

  const baseConfig = buildBaseConfig();
  let serverUrl = baseConfig.server_url ?? DEFAULT_SERVER_URL;

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

  if (mode === "local") {
    const dbPath = baseConfig.local?.db_path ?? getDefaultDbPath();
    if (!existsSync(join(resolveHomeDir(), ".c4a"))) {
      await mkdir(join(resolveHomeDir(), ".c4a"), { recursive: true });
    }
    await ensureLocalStore(dbPath);
    io.log(`初始化数据库 ${dbPath} ✅`);
  }

  const finalConfig: GlobalConfig = {
    ...baseConfig,
    mode,
    server_url: serverUrl,
  };

  await saveConfig(finalConfig);
  io.log(`全局配置已保存: ${join(resolveHomeDir(), ".c4a", "config.yaml")}`);
  io.log("\n可以开始使用了，在项目目录下运行 c4a init 初始化项目。\n");
  if (mode === "remote") {
    io.log("提示: 如需在本机安装 C4A 服务，运行 c4a server install");
  }

  return finalConfig;
}

export async function ensureGlobalConfig(deps: FirstRunDeps = {}): Promise<GlobalConfig> {
  const loadConfig = deps.loadGlobalConfig ?? loadGlobalConfig;
  const existing = await loadConfig();
  if (existing) {
    return existing;
  }
  return runFirstRunGuide(deps);
}
