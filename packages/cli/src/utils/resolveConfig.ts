import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";

export interface C4aConfig {
  rootDir: string;
  configSource: "yaml" | "package.json";
  rootId: string;
  version: string;
  mode: "local" | "remote";
  autoPull: boolean;
  serverUrl?: string;
  hasContextDir: boolean;
}

type RawProjectConfig = {
  root_id?: string;
  version?: string;
  mode?: string;
  auto_pull?: boolean;
  server_url?: string;
  server?: { url?: string };
  remote?: { url?: string };
};

type RawGlobalConfig = {
  mode?: string;
  server_url?: string;
  server?: { url?: string };
  remote?: { url?: string };
};

type PackageJsonConfig = {
  c4a?: RawProjectConfig;
};

const PROJECT_CONFIG_PATH = join(".context", ".c4a.yaml");
const GLOBAL_CONFIG_DIR = ".c4a";
const GLOBAL_CONFIG_FILE = "config.yaml";

function resolveHomeDir(): string {
  return process.env.C4A_HOME || homedir();
}

function getGlobalConfigPath(): string {
  return join(resolveHomeDir(), GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_FILE);
}

async function readYamlFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    if (!content.trim()) {
      return null;
    }
    return parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    if (!content.trim()) {
      return null;
    }
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function normalizeMode(raw?: string): "local" | "remote" | undefined {
  if (raw === "local") {
    return "local";
  }
  if (raw === "remote" || raw === "server") {
    return "remote";
  }
  return undefined;
}

function resolveServerUrl(config?: {
  server_url?: string;
  server?: { url?: string };
  remote?: { url?: string };
}): string | undefined {
  const value = config?.server_url ?? config?.remote?.url ?? config?.server?.url;
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function buildConfig(
  rootDir: string,
  configSource: "yaml" | "package.json",
  projectConfig: RawProjectConfig,
  globalConfig: RawGlobalConfig | null,
): C4aConfig {
  const projectMode = normalizeMode(projectConfig.mode);
  const globalMode = normalizeMode(globalConfig?.mode);
  const projectServerUrl = resolveServerUrl(projectConfig);
  const globalServerUrl = resolveServerUrl(globalConfig ?? undefined);

  return {
    rootDir,
    configSource,
    rootId: projectConfig.root_id ?? "",
    version: projectConfig.version ?? "0.0.0",
    mode: projectMode ?? globalMode ?? "local",
    autoPull: projectConfig.auto_pull ?? false,
    serverUrl: projectServerUrl ?? globalServerUrl,
    hasContextDir: configSource === "yaml",
  };
}

export async function resolveC4aConfig(startDir: string = process.cwd()): Promise<C4aConfig | null> {
  const globalConfig = await readYamlFile<RawGlobalConfig>(getGlobalConfigPath());
  let currentDir = resolve(startDir);

  while (true) {
    const yamlPath = join(currentDir, PROJECT_CONFIG_PATH);
    if (existsSync(yamlPath)) {
      const projectConfig = (await readYamlFile<RawProjectConfig>(yamlPath)) ?? {};
      return buildConfig(currentDir, "yaml", projectConfig, globalConfig);
    }

    const packagePath = join(currentDir, "package.json");
    if (existsSync(packagePath)) {
      const packageJson = await readJsonFile<PackageJsonConfig>(packagePath);
      if (packageJson?.c4a) {
        return buildConfig(currentDir, "package.json", packageJson.c4a, globalConfig);
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}
