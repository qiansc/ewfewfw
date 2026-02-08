import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  CONTEXT_ROOT_DIR,
  getConfigPath,
  getEntityPath,
  stringifyDSL,
  computeContentHash,
} from "@c4a/core";
import type { EntityType } from "@c4a/core";
import type { C4aConfig } from "../utils/resolveConfig.js";

type McpClientLike = {
  request<T>(method: string, params: unknown): Promise<T>;
};

type StoreListResult = {
  items?: Array<{ uuid: string; id: string; type: string; content_hash?: string }>;
  pagination?: { has_more?: boolean };
  total?: number;
};

type StoreReadResult = {
  entity?: { uuid?: string; id: string; type: string; data?: Record<string, unknown> };
};

type SyncStateEntry = {
  content_hash: string;
};

type SyncStateSnapshot = {
  project_dir: string;
  synced_at: string;
  version: string;
  entities: Record<string, SyncStateEntry>;
};

export class PullEngineError extends Error {
  readonly code: string;
  readonly details?: { field?: string; expected?: string; actual?: string; suggestion?: string };

  constructor(
    code: string,
    message: string,
    details?: { field?: string; expected?: string; actual?: string; suggestion?: string },
  ) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export type PullResult = {
  canceled: boolean;
  version: string;
  rootId: string;
  entityCount: number;
  filesWritten: string[];
  contextDir: string;
  contextDirCreated: boolean;
  syncStatePath?: string;
  syncStateUpdated: boolean;
};

const LIST_LIMIT = 200;

function resolveHomeDir(): string {
  return process.env.C4A_HOME || homedir();
}

function getWorkspaceDir(projectDir: string): string {
  const absolutePath = resolve(projectDir);
  const hash = createHash("sha256").update(absolutePath).digest("hex").slice(0, 16);
  return join(resolveHomeDir(), ".c4a", "tmp", hash);
}

async function removeDslFiles(contextDir: string, configPath: string): Promise<number> {
  if (!existsSync(contextDir)) {
    return 0;
  }
  let removed = 0;
  const entries = await readdir(contextDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(contextDir, entry.name);
    if (entry.isDirectory()) {
      removed += await removeDslFiles(fullPath, configPath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".c4a.yaml")) continue;
    if (fullPath === configPath) continue;
    await rm(fullPath, { force: true });
    removed += 1;
  }
  return removed;
}

async function listEntities(
  client: McpClientLike,
  rootId: string,
  version: string,
): Promise<Array<{ uuid: string; id: string; type: string; content_hash?: string }>> {
  const items: Array<{ uuid: string; id: string; type: string; content_hash?: string }> = [];
  let offset = 0;
  while (true) {
    const result = await client.request<StoreListResult>("c4a_store_list", {
      root_id: rootId,
      version,
      type: "all",
      limit: LIST_LIMIT,
      offset,
    });
    const pageItems = result.items ?? [];
    items.push(...pageItems);
    const hasMore = result.pagination?.has_more ?? false;
    if (!hasMore || pageItems.length === 0) {
      break;
    }
    offset += pageItems.length;
  }
  return items;
}

async function ensureVersionExists(
  client: McpClientLike,
  rootId: string,
  version: string,
): Promise<void> {
  const result = await client.request<StoreListResult>("c4a_store_list", {
    root_id: rootId,
    version,
    type: "all",
    count_only: true,
  });
  if ((result.total ?? 0) === 0) {
    throw new PullEngineError("C4A-VER-001", "版本不存在", {
      field: "version",
      expected: "已存在的版本",
      actual: version,
      suggestion: "请先运行 c4a version list 或 c4a version create",
    });
  }
}

export async function pullVersion(options: {
  client: McpClientLike;
  config: C4aConfig;
  version?: string;
  confirmCreateContext?: (question: string) => Promise<boolean>;
}): Promise<PullResult> {
  const { client, config, version, confirmCreateContext } = options;
  const rootId = config.rootId;
  if (!rootId) {
    throw new PullEngineError("C4A-VER-999", "未配置 root_id，无法执行 pull");
  }

  const targetVersion = version ?? config.version ?? "0.0.0";
  if (version) {
    await ensureVersionExists(client, rootId, targetVersion);
  }

  const contextDir = join(config.rootDir, CONTEXT_ROOT_DIR);
  const configPath = join(config.rootDir, getConfigPath());
  let contextDirCreated = false;

  if (!config.hasContextDir) {
    const confirmed = await (confirmCreateContext
      ? confirmCreateContext("当前为极简模式，将创建 .context/ 目录用于 pull，是否继续？")
      : Promise.resolve(false));
    if (!confirmed) {
      return {
        canceled: true,
        version: targetVersion,
        rootId,
        entityCount: 0,
        filesWritten: [],
        contextDir,
        contextDirCreated: false,
        syncStateUpdated: false,
      };
    }
  }

  if (!existsSync(contextDir)) {
    await mkdir(contextDir, { recursive: true });
    contextDirCreated = true;
  }

  await removeDslFiles(contextDir, configPath);

  const entities = await listEntities(client, rootId, targetVersion);
  const filesWritten: string[] = [];
  const syncEntities: Record<string, SyncStateEntry> = {};

  for (const item of entities) {
    const readResult = await client.request<StoreReadResult>("c4a_store_read", {
      uuid: item.uuid,
      format: "object",
    });
    const entity = readResult.entity;
    if (!entity || !entity.data) {
      throw new PullEngineError("C4A-VER-999", `读取实体失败: ${item.id}`);
    }

    const outputRelative = getEntityPath(entity.id, entity.type as EntityType);
    const outputPath = join(config.rootDir, outputRelative);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, stringifyDSL(entity.data), "utf-8");
    filesWritten.push(outputPath);
    syncEntities[entity.id] = { content_hash: computeContentHash(entity.data) };
  }

  let syncStateUpdated = false;
  let syncStatePath: string | undefined;
  if (config.mode === "remote") {
    const workspaceDir = getWorkspaceDir(config.rootDir);
    await mkdir(workspaceDir, { recursive: true });
    syncStatePath = join(workspaceDir, ".sync-state.json");
    const snapshot: SyncStateSnapshot = {
      project_dir: config.rootDir,
      synced_at: new Date().toISOString(),
      version: targetVersion,
      entities: syncEntities,
    };
    await writeFile(syncStatePath, JSON.stringify(snapshot, null, 2), "utf-8");
    syncStateUpdated = true;
  }

  return {
    canceled: false,
    version: targetVersion,
    rootId,
    entityCount: entities.length,
    filesWritten,
    contextDir,
    contextDirCreated,
    syncStatePath,
    syncStateUpdated,
  };
}
