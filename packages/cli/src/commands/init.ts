import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { detectGitRemote } from "../utils/git.js";
import {
  loadGlobalConfig,
  saveProjectConfig,
  getInstalledModes,
  type CliMode,
  type ProjectConfig,
  type AdrPolicyConfig,
  type SkillsConfig,
} from "../core/config.js";
import { buildErrorResponse, printErrorResponse } from "../utils/errorResponse.js";

interface SelectOption<T extends string> {
  label: string;
  value: T;
}

interface Prompter {
  input: (label: string, options?: { required?: boolean; defaultValue?: string }) => Promise<string>;
  confirm: (label: string, defaultValue?: boolean) => Promise<boolean>;
  select: <T extends string>(
    label: string,
    options: Array<SelectOption<T>>,
    defaultIndex?: number
  ) => Promise<T>;
  close?: () => void | Promise<void>;
}

interface InitDependencies {
  prompter?: Prompter;
  detectGitRemote?: typeof detectGitRemote;
  loadGlobalConfig?: typeof loadGlobalConfig;
  saveProjectConfig?: typeof saveProjectConfig;
  ensureContextDirs?: typeof ensureContextDirs;
  writeCursorConfig?: (servers: McpServerMap) => Promise<void>;
  writeClaudeConfig?: (servers: McpServerMap) => Promise<void>;
  writeOpenCodeConfig?: (servers: McpServerMap) => Promise<void>;
}

const CONTEXT_DIRS = [
  ".context",
  ".context/.schemas",
  ".context/assets",
  ".context/business/products",
  ".context/business/processes",
  ".context/business/sors",
  ".context/technical/adrs",
  ".context/technical/systems",
  ".context/technical/containers",
  ".context/technical/components",
  ".context/technical/contracts",
  ".context/technical/processes",
  ".context/technical/sors",
];

async function loadPackageName(): Promise<string | null> {
  try {
    const packagePath = join(process.cwd(), "package.json");
    if (!existsSync(packagePath)) {
      return null;
    }
    const content = await readFile(packagePath, "utf-8");
    const data = JSON.parse(content) as { name?: unknown };
    return typeof data.name === "string" && data.name.trim() ? data.name.trim() : null;
  } catch {
    return null;
  }
}

function normalizeMcpUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.endsWith("/mcp")) {
    return trimmed;
  }
  return `${trimmed}/mcp`;
}

async function promptInput(
  rl: ReturnType<typeof createInterface>,
  label: string,
  options?: { required?: boolean; defaultValue?: string }
): Promise<string> {
  const required = options?.required ?? false;
  const defaultValue = options?.defaultValue;
  const suffix = defaultValue ? ` (${defaultValue})` : "";

  while (true) {
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    if (answer) {
      return answer;
    }
    if (!answer && defaultValue) {
      return defaultValue;
    }
    if (!required) {
      return "";
    }
  }
}

async function promptConfirm(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue = false
): Promise<boolean> {
  const hint = defaultValue ? "Y/n" : "y/N";
  while (true) {
    const answer = (await rl.question(`${label} (${hint}): `)).trim().toLowerCase();
    if (!answer) {
      return defaultValue;
    }
    if (["y", "yes"].includes(answer)) {
      return true;
    }
    if (["n", "no"].includes(answer)) {
      return false;
    }
  }
}

async function promptSelect<T extends string>(
  rl: ReturnType<typeof createInterface>,
  label: string,
  options: Array<SelectOption<T>>,
  defaultIndex = 0
): Promise<T> {
  console.log(label);
  options.forEach((option, index) => {
    const prefix = index === defaultIndex ? ">" : " ";
    console.log(`  ${prefix} ${option.label}`);
  });

  while (true) {
    const answer = (await rl.question(`选择 [${defaultIndex + 1}]: `)).trim();
    if (!answer) {
      return options[defaultIndex].value;
    }
    const index = Number(answer);
    if (!Number.isNaN(index) && index >= 1 && index <= options.length) {
      return options[index - 1].value;
    }
  }
}

interface McpServerConfig {
  url: string;
}

type McpServerMap = Record<string, McpServerConfig>;

function buildMcpServers(mode: CliMode, remoteUrl?: string): McpServerMap {
  if (mode === "remote") {
    const url = normalizeMcpUrl(remoteUrl ?? "");
    return {
      "c4a-store-mcp": { url },
      "c4a-query-mcp": { url },
      "c4a-visual-mcp": { url },
    };
  }
  return {
    "c4a-store-mcp": { url: "http://localhost:8051/mcp" },
    "c4a-query-mcp": { url: "http://localhost:8054/mcp" },
    "c4a-visual-mcp": { url: "http://localhost:8053/mcp" },
  };
}

function buildCursorRules(): string {
  return [
    "# C4A Rules",
    "",
    "- 架构知识保存在 `.context/` 目录",
    "- 使用 `c4a init` 初始化项目配置",
    "- 使用 `c4a version pull/push` 同步本地文件与数据库",
  ].join("\n");
}

async function writeCursorConfig(servers: McpServerMap): Promise<void> {
  const cursorDir = join(process.cwd(), ".cursor");
  if (!existsSync(cursorDir)) {
    await mkdir(cursorDir, { recursive: true });
  }
  const mcpConfig = {
    mcpServers: servers,
  };
  await writeFile(join(cursorDir, "mcp.json"), JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
  await writeFile(join(process.cwd(), ".cursorrules"), buildCursorRules() + "\n", "utf-8");
}

async function writeClaudeConfig(servers: McpServerMap): Promise<void> {
  const rootDir = process.cwd();
  const claudeDir = join(rootDir, ".claude");
  if (!existsSync(claudeDir)) {
    await mkdir(claudeDir, { recursive: true });
  }

  const mcpConfig = {
    mcpServers: Object.fromEntries(
      Object.entries(servers).map(([name, server]) => [name, { type: "http", url: server.url }])
    ),
  };
  await writeFile(
    join(rootDir, ".mcp.json"),
    JSON.stringify(mcpConfig, null, 2) + "\n",
    "utf-8"
  );

  const settings = {
    enabledMcpjsonServers: Object.keys(servers),
  };
  await writeFile(
    join(claudeDir, "settings.local.json"),
    JSON.stringify(settings, null, 2) + "\n",
    "utf-8"
  );
}

async function writeOpenCodeConfig(servers: McpServerMap): Promise<void> {
  const opencodeDir = join(process.cwd(), ".opencode");
  if (!existsSync(opencodeDir)) {
    await mkdir(opencodeDir, { recursive: true });
  }
  const mcp = Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [name, { type: "remote", url: server.url }])
  );
  const config = {
    $schema: "https://opencode.ai/config.json",
    instructions: [],
    mcp,
    agent: {
      c4a: {
        mode: "primary",
        prompt: "C4A assistant for this repository.",
      },
    },
    default_agent: "c4a",
  };
  await writeFile(
    join(opencodeDir, "opencode.json"),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8"
  );
}

async function ensureContextDirs(): Promise<void> {
  for (const dir of CONTEXT_DIRS) {
    const fullPath = join(process.cwd(), dir);
    if (!existsSync(fullPath)) {
      await mkdir(fullPath, { recursive: true });
    }
  }
}

function createDefaultPrompter(): Prompter {
  const rl = createInterface({ input, output });
  return {
    input: (label, options) => promptInput(rl, label, options),
    confirm: (label, defaultValue) => promptConfirm(rl, label, defaultValue),
    select: (label, options, defaultIndex) => promptSelect(rl, label, options, defaultIndex),
    close: () => rl.close(),
  };
}

export async function initCommand(
  args: string[],
  dependencies: InitDependencies = {}
): Promise<void> {
  void args;
  const prompter = dependencies.prompter ?? createDefaultPrompter();
  const detectGitRemoteFn = dependencies.detectGitRemote ?? detectGitRemote;
  const loadGlobalConfigFn = dependencies.loadGlobalConfig ?? loadGlobalConfig;
  const saveProjectConfigFn = dependencies.saveProjectConfig ?? saveProjectConfig;
  const ensureContextDirsFn = dependencies.ensureContextDirs ?? ensureContextDirs;
  const writeCursorConfigFn = dependencies.writeCursorConfig ?? writeCursorConfig;
  const writeClaudeConfigFn = dependencies.writeClaudeConfig ?? writeClaudeConfig;
  const writeOpenCodeConfigFn = dependencies.writeOpenCodeConfig ?? writeOpenCodeConfig;

  try {
    console.log("\nC4A 项目初始化\n");

    const packageName = await loadPackageName();
    const rootId = await prompter.input("包标识 (root_id)", {
      required: true,
      defaultValue: packageName ?? undefined,
    });

    const detectedRepo = await detectGitRemoteFn();
    let repoId = "";
    if (detectedRepo) {
      repoId = await prompter.input("仓库标识 (repo_id)", {
        required: true,
        defaultValue: detectedRepo,
      });
    } else {
      console.log("未检测到 Git remote，请手动输入仓库标识（用于数据溯源）。");
      repoId = await prompter.input("仓库标识 (repo_id)", { required: true });
    }

    const globalConfig = await loadGlobalConfigFn();
    const installedModes = getInstalledModes(globalConfig);
    let defaultMode: CliMode = "remote";
    if (installedModes.includes("local")) {
      defaultMode = "local";
    }

    const mode = await prompter.select(
      "选择项目使用的模式:",
      [
        { label: "local  - 使用本地数据库", value: "local" },
        { label: "remote - 使用远程服务", value: "remote" },
      ],
      defaultMode === "local" ? 0 : 1
    );

    if (mode === "local" && !installedModes.includes(mode)) {
      printErrorResponse(
        buildErrorResponse(
          "C4A-INIT-001",
          `${mode} 模式尚未初始化，请先完成 ${mode} 模式准备或选择 remote 模式`,
          { suggestion: `完成 ${mode} 模式准备或选择 remote 模式` },
          [
            { action: "select", label: "选择 remote 模式", params: { mode: "remote" } },
          ]
        )
      );
      process.exitCode = 1;
      return;
    }

    const autoExport = await prompter.confirm("数据库变更后自动导出到 .context/?", false);

    const ideChoice = await prompter.select(
      "选择 AI IDE:",
      [
        { label: "Cursor", value: "cursor" },
        { label: "Claude Code", value: "claude" },
        { label: "OpenCode", value: "opencode" },
        { label: "全部安装", value: "all" },
      ],
      0
    );

    const configureAdr = await prompter.confirm("配置 ADR 策略?", false);
    let adrPolicy: AdrPolicyConfig | undefined;
    if (configureAdr) {
      const enforce = await prompter.confirm("是否强制要求 ADR?", false);
      const scopeInput = await prompter.input(
        "ADR 适用范围 (system,container,component，逗号分隔，留空跳过)"
      );
      const onMissing = await prompter.select(
        "缺少 ADR 时的处理:",
        [
          { label: "error", value: "error" },
          { label: "warning", value: "warning" },
          { label: "ignore", value: "ignore" },
        ],
        0
      );
      const scope = scopeInput
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      adrPolicy = {
        enforce,
        on_missing: onMissing,
        scope: scope.length > 0 ? (scope as AdrPolicyConfig["scope"]) : undefined,
      };
    }

    let remoteUrl = "";
    if (mode === "remote") {
      remoteUrl = await prompter.input("远程 MCP 服务地址", { required: true });
    }

    const skills: SkillsConfig =
      ideChoice === "all"
        ? { cursor: true, claude: true, opencode: true }
        : {
            cursor: ideChoice === "cursor",
            claude: ideChoice === "claude",
            opencode: ideChoice === "opencode",
          };

    await ensureContextDirsFn();

    const projectConfig: ProjectConfig = {
      root_id: rootId,
      repo_id: repoId,
      mode,
      skills,
      adr_policy: adrPolicy,
      sync: { auto_export: autoExport },
      remote: remoteUrl ? { url: remoteUrl } : undefined,
    };

    await saveProjectConfigFn(projectConfig);

    const mcpServers = buildMcpServers(mode, remoteUrl);

    if (skills.cursor) {
      await writeCursorConfigFn(mcpServers);
    }
    if (skills.claude) {
      await writeClaudeConfigFn(mcpServers);
    }
    if (skills.opencode) {
      await writeOpenCodeConfigFn(mcpServers);
    }

    console.log("\n初始化完成");
  } catch (error) {
    printErrorResponse(
      buildErrorResponse("C4A-INIT-999", (error as Error).message || "初始化失败")
    );
    process.exitCode = 1;
  } finally {
    if (prompter.close) {
      await prompter.close();
    }
  }
}
