import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { SQLiteStore, initEmbedder } from "@c4a/storage";
import {
  loadGlobalConfig,
  saveGlobalConfig,
  loadProjectConfig,
  type CliMode,
  type GlobalConfig,
} from "../core/config.js";
import {
  checkDockerInstalled,
  getContainerStatus,
  type CommandResult,
} from "../utils/docker.js";
import { parseArgs } from "../utils/args.js";
import { buildErrorResponse, printErrorResponse } from "../utils/errorResponse.js";

type InstallMode = CliMode | "skip";

interface CommandIO {
  log: (message: string) => void;
  error: (message: string) => void;
}

interface Prompter {
  select: <T extends string>(
    label: string,
    options: Array<{ label: string; value: T }>,
    defaultIndex?: number,
  ) => Promise<T>;
  confirm: (label: string, defaultValue?: boolean) => Promise<boolean>;
  close?: () => void | Promise<void>;
}

interface InstallDeps {
  io?: CommandIO;
  prompter?: Prompter;
  now?: () => Date;
  loadGlobalConfig?: typeof loadGlobalConfig;
  saveGlobalConfig?: typeof saveGlobalConfig;
  loadProjectConfig?: typeof loadProjectConfig;
  ensureDir?: (path: string) => Promise<void>;
  createLocalDb?: (dbPath: string) => Promise<void>;
  downloadEmbeddingModel?: () => Promise<void>;
  docker?: {
    checkDockerInstalled: typeof checkDockerInstalled;
    getContainerStatus: typeof getContainerStatus;
  };
  installDocker?: () => Promise<boolean>;
  composeUp?: (composeFile: string) => Promise<CommandResult>;
  waitForHealthy?: (timeoutMs: number, intervalMs: number) => Promise<boolean>;
  emitError?: (response: ReturnType<typeof buildErrorResponse>) => void;
}

const SERVER_CONTAINERS = [
  "c4a-mongodb",
  "c4a-neo4j",
  "c4a-milvus",
  "c4a-ollama",
];

function resolveHomeDir(): string {
  return process.env.C4A_HOME || homedir();
}

function resolveGlobalDir(): string {
  return join(resolveHomeDir(), ".c4a");
}

function resolveDbPath(): string {
  return join(resolveGlobalDir(), "store.db");
}

async function ensureDir(path: string): Promise<void> {
  if (!existsSync(path)) {
    await mkdir(path, { recursive: true });
  }
}

async function createLocalDb(dbPath: string): Promise<void> {
  const store = SQLiteStore.getInstance({ dbPath });
  store.close();
}

async function downloadEmbeddingModel(): Promise<void> {
  await initEmbedder();
}

async function composeUp(composeFile: string): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    execFile(
      "docker",
      ["compose", "-f", composeFile, "up", "-d"],
      { encoding: "utf-8" },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          const exitCode = typeof code === "number" ? code : 1;
          resolveResult({
            stdout: stdout ?? "",
            stderr: stderr ?? (error as Error).message,
            exitCode,
          });
          return;
        }
        resolveResult({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
      },
    );
  });
}

async function waitForHealthyServices(
  docker: { getContainerStatus: typeof getContainerStatus },
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const statuses = await docker.getContainerStatus(SERVER_CONTAINERS);
    const allRunning = statuses.every(
      (status) =>
        status.state === "running" &&
        (status.health ? status.health === "healthy" : true),
    );
    if (allRunning) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function createDefaultPrompter(): Prompter {
  const rl = createInterface({ input, output });
  return {
    select: async (label, options, defaultIndex = 0) => {
      console.log(label);
      options.forEach((option, index) => {
        const prefix = index === defaultIndex ? ">" : " ";
        console.log(`  ${prefix} ${option.label}`);
      });
      const answer = (await rl.question(`选择 [${defaultIndex + 1}]: `)).trim();
      if (!answer) {
        return options[defaultIndex].value;
      }
      const index = Number(answer);
      if (!Number.isNaN(index) && index >= 1 && index <= options.length) {
        return options[index - 1].value;
      }
      return options[defaultIndex].value;
    },
    confirm: async (label, defaultValue = false) => {
      const hint = defaultValue ? "Y/n" : "y/N";
      const answer = (await rl.question(`${label} (${hint}): `)).trim().toLowerCase();
      if (!answer) return defaultValue;
      return ["y", "yes"].includes(answer);
    },
    close: () => rl.close(),
  };
}

async function installLocal(
  deps: Required<
    Pick<
      InstallDeps,
      "ensureDir" | "createLocalDb" | "downloadEmbeddingModel" | "saveGlobalConfig" | "now"
    >
  >,
  globalConfig: GlobalConfig,
  io: CommandIO,
): Promise<void> {
  const globalDir = resolveGlobalDir();
  const dbPath = resolveDbPath();
  await deps.ensureDir(globalDir);
  io.log(`创建目录: ${globalDir}`);
  await deps.createLocalDb(dbPath);
  io.log(`初始化数据库: ${dbPath}`);
  await deps.downloadEmbeddingModel();
  io.log("已下载 embedding 模型: all-MiniLM-L6-v2");

  const nextConfig: GlobalConfig = {
    ...globalConfig,
    version: "0.3.1",
    local: {
      db_path: dbPath,
      embedding_model: "all-MiniLM-L6-v2",
      installed_at: deps.now().toISOString(),
    },
  };
  await deps.saveGlobalConfig(nextConfig);
  io.log("✅ Local 模式安装完成");
}

async function installServer(
  deps: Required<
    Pick<
      InstallDeps,
      | "ensureDir"
      | "saveGlobalConfig"
      | "now"
      | "composeUp"
      | "waitForHealthy"
      | "emitError"
    >
  >,
  globalConfig: GlobalConfig,
  io: CommandIO,
): Promise<void> {
  const globalDir = resolveGlobalDir();
  await deps.ensureDir(globalDir);

  const composeFile = resolve(import.meta.dirname, "../../../..", "docker", "docker-compose.server.yml");
  const result = await deps.composeUp(composeFile);
  if (result.exitCode !== 0) {
    deps.emitError(
      buildErrorResponse("C4A-INSTALL-003", result.stderr || "启动 Docker 服务失败"),
    );
    process.exitCode = 1;
    return;
  }
  io.log("已启动 Docker 服务容器，等待健康检查...");
  const healthy = await deps.waitForHealthy(120000, 3000);
  if (!healthy) {
    deps.emitError(
      buildErrorResponse("C4A-INSTALL-004", "服务健康检查超时", {
        suggestion: "请检查 docker logs 或重试安装",
      }),
    );
    process.exitCode = 1;
    return;
  }

  const nextConfig: GlobalConfig = {
    ...globalConfig,
    version: "0.3.1",
    server: {
      url: "http://localhost:8055",
      installed_at: deps.now().toISOString(),
      services: {
        mongodb: "localhost:27017",
        neo4j: "localhost:7474",
        milvus: "localhost:19530",
        ollama: "localhost:11434",
      },
    },
  };
  await deps.saveGlobalConfig(nextConfig);
  io.log("✅ Server 模式安装完成");
}

export async function installCommand(
  args: string[],
  deps: InstallDeps = {},
): Promise<void> {
  const io: CommandIO = deps.io ?? console;
  const prompter = deps.prompter ?? createDefaultPrompter();
  const now = deps.now ?? (() => new Date());
  const loadGlobalConfigFn = deps.loadGlobalConfig ?? loadGlobalConfig;
  const saveGlobalConfigFn = deps.saveGlobalConfig ?? saveGlobalConfig;
  const loadProjectConfigFn = deps.loadProjectConfig ?? loadProjectConfig;
  const ensureDirFn = deps.ensureDir ?? ensureDir;
  const createLocalDbFn = deps.createLocalDb ?? createLocalDb;
  const downloadEmbeddingModelFn = deps.downloadEmbeddingModel ?? downloadEmbeddingModel;
  const docker = deps.docker ?? { checkDockerInstalled, getContainerStatus };
  const installDocker = deps.installDocker;
  const composeUpFn = deps.composeUp ?? composeUp;
  const waitForHealthyFn =
    deps.waitForHealthy ??
    ((timeoutMs, intervalMs) => waitForHealthyServices(docker, timeoutMs, intervalMs));
  const emitError = deps.emitError ?? printErrorResponse;

  try {
    const { positionals } = parseArgs(args);
    const modeArg = positionals[0] as InstallMode | undefined;
    let mode: InstallMode | undefined = modeArg;

    if (!mode) {
      mode = await prompter.select<InstallMode>(
        "选择安装模式:",
        [
          { label: "local  - 本地模式 (SQLite)", value: "local" },
          { label: "server - 服务器模式 (Docker)", value: "server" },
          { label: "remote - 仅记录 Remote 模式", value: "remote" },
          { label: "skip  - 暂不安装", value: "skip" },
        ],
        0,
      );
    }

    if (mode === "skip") {
      io.log("已跳过安装。");
      return;
    }

    if (mode !== "remote") {
      const projectConfig = await loadProjectConfigFn();
      if (projectConfig?.mode === "remote") {
        io.log("⚠️  当前项目处于 Remote 模式");
        if (projectConfig.remote?.url) {
          io.log(`远程服务: ${projectConfig.remote.url}`);
        }
        io.log("切换到本地存储模式需要重新同步数据。");
        const confirmed = await prompter.confirm("是否继续安装本地存储模式?", false);
        if (!confirmed) {
          io.log("已取消安装。");
          return;
        }
      }
    }

    const globalConfig = (await loadGlobalConfigFn()) ?? {};

    if (mode === "remote") {
      const nextConfig: GlobalConfig = {
        ...globalConfig,
        version: "0.3.1",
        remote: {
          ...globalConfig.remote,
          selected_at: now().toISOString(),
        },
      };
      await saveGlobalConfigFn(nextConfig);
      io.log("已记录 Remote 模式选择。");
      return;
    }

    if (mode === "local") {
      await installLocal(
        {
          ensureDir: ensureDirFn,
          createLocalDb: createLocalDbFn,
          downloadEmbeddingModel: downloadEmbeddingModelFn,
          saveGlobalConfig: saveGlobalConfigFn,
          now,
        },
        globalConfig,
        io,
      );
      return;
    }

    if (mode === "server") {
      const hasDocker = await docker.checkDockerInstalled();
      if (!hasDocker) {
        const confirmed = await prompter.confirm("Docker 未安装，是否自动安装?", true);
        if (!confirmed) {
          emitError(
            buildErrorResponse("C4A-INSTALL-002", "Docker 未安装或不可用", {
              suggestion: "请安装 Docker Desktop 后重试",
            }),
          );
          process.exitCode = 1;
          return;
        }
        if (!installDocker || !(await installDocker())) {
          emitError(
            buildErrorResponse("C4A-INSTALL-005", "自动安装 Docker 失败", {
              suggestion: "请手动安装 Docker 后重试",
            }),
          );
          process.exitCode = 1;
          return;
        }
      }
      await installServer(
        {
          ensureDir: ensureDirFn,
          saveGlobalConfig: saveGlobalConfigFn,
          now,
          composeUp: composeUpFn,
          waitForHealthy: waitForHealthyFn,
          emitError,
        },
        globalConfig,
        io,
      );
      return;
    }

    emitError(
      buildErrorResponse("C4A-INSTALL-001", `未知安装模式: ${String(mode)}`),
    );
    process.exitCode = 1;
  } catch (error) {
    emitError(
      buildErrorResponse("C4A-INSTALL-999", (error as Error).message || "安装失败"),
    );
    process.exitCode = 1;
  } finally {
    if (prompter.close) {
      await prompter.close();
    }
  }
}
