import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";

export type CliMode = "local" | "server" | "remote";

export interface GlobalConfig {
  version?: string;
  local?: { installed_at?: string; db_path?: string; embedding_model?: string };
  server?: {
    installed_at?: string;
    url?: string;
    services?: {
      mongodb?: string;
      neo4j?: string;
      milvus?: string;
      ollama?: string;
      storage_backend?: string;
    };
  };
  remote?: { url?: string; selected_at?: string };
}

export interface SkillsConfig {
  cursor?: boolean;
  claude?: boolean;
  opencode?: boolean;
}

export interface AdrPolicyConfig {
  enforce?: boolean;
  scope?: Array<"system" | "container" | "component">;
  on_missing?: "error" | "warning" | "ignore";
}

export interface ProjectConfig {
  project_id?: string;
  repo_id?: string;
  mode?: CliMode;
  skills?: SkillsConfig;
  adr_policy?: AdrPolicyConfig;
  sync?: { auto_export?: boolean };
  server?: { url?: string };
  remote?: { url?: string };
}

const GLOBAL_CONFIG_DIR = ".c4a";
const GLOBAL_CONFIG_FILE = "config.yaml";
const PROJECT_CONFIG_PATH = join(".context", ".c4a.yaml");

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

async function writeYamlFile(filePath: string, data: unknown): Promise<void> {
  const content = stringify(data);
  await writeFile(filePath, content, "utf-8");
}

export async function loadGlobalConfig(): Promise<GlobalConfig | null> {
  const configPath = getGlobalConfigPath();
  return readYamlFile<GlobalConfig>(configPath);
}

export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  const configPath = getGlobalConfigPath();
  const dirPath = join(resolveHomeDir(), GLOBAL_CONFIG_DIR);
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
  await writeYamlFile(configPath, config);
}

export async function loadProjectConfig(): Promise<ProjectConfig | null> {
  return readYamlFile<ProjectConfig>(PROJECT_CONFIG_PATH);
}

export async function saveProjectConfig(config: ProjectConfig): Promise<void> {
  const contextDir = join(process.cwd(), ".context");
  if (!existsSync(contextDir)) {
    await mkdir(contextDir, { recursive: true });
  }
  await writeYamlFile(PROJECT_CONFIG_PATH, config);
}

export function getInstalledModes(
  config: GlobalConfig | null,
): Array<Exclude<CliMode, "remote">> {
  if (!config) {
    return [];
  }
  const modes: Array<Exclude<CliMode, "remote">> = [];
  if (config.local?.installed_at) {
    modes.push("local");
  }
  if (config.server?.installed_at) {
    modes.push("server");
  }
  return modes;
}
