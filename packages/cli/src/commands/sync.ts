import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { EntityType } from "@c4a/storage";
import { DATA_ERROR_CODES } from "@c4a/core/types";
import { parseDSL } from "@c4a/core/utils";
import { calculateHash } from "../utils/hash.js";
import { loadProjectConfig } from "../core/config.js";
import { McpClient, type McpTransport } from "../core/mcp-client.js";

type SyncDirection = "import" | "export";
type SyncMode = "incremental" | "full";
type ConflictPolicy = "warn" | "skip" | "override" | "prompt";

interface SyncOptionsInput {
  direction?: SyncDirection;
  statusFilter?: "published" | "approved" | "all";
  mode?: SyncMode;
  format?: "yaml" | "json";
  conflictPolicy?: ConflictPolicy;
}

interface SyncArgs {
  proposalId?: string;
  options: SyncOptionsInput;
}

interface SyncSnapshot {
  synced_at: string;
  entities: Record<
    string,
    {
      content_hash: string;
      proposal_id?: string;
    }
  >;
}

interface LocalFileInfo {
  path: string;
  entity_id: string;
  type: EntityType;
  content_hash: string;
  updated_at: string;
  proposal_id?: string;
  content?: string;
}

interface LocalManifest {
  files: LocalFileInfo[];
}

interface SyncAction {
  op: "upload" | "download" | "conflict" | "delete_local" | "delete_remote" | "skip";
  entity_id: string;
  type?: EntityType;
  path?: string;
  content?: string;
  conflict_type?: "both_modified" | "local_deleted" | "remote_deleted";
  remote_content?: string;
  reason?: string;
}

interface PlanSyncResult {
  success: boolean;
  executed: boolean;
  actions: SyncAction[];
  new_snapshot: SyncSnapshot;
  stats: Record<string, number>;
  results?: {
    uploaded: string[];
    failed: string[];
  };
  error?: {
    message?: string;
  };
}

type McpClientLike = {
  request<T>(method: string, params: unknown): Promise<T>;
};

type SyncCommandDeps = {
  loadProjectConfig: typeof loadProjectConfig;
  createMcpClient: (options: { baseUrl?: string; transport?: McpTransport }) => McpClientLike;
  log: (message: string) => void;
  error: (message: string) => void;
  prompt: (message: string, options: string[]) => Promise<number>;
  now: () => Date;
};

const DEFAULT_DEPS: SyncCommandDeps = {
  loadProjectConfig,
  createMcpClient: (options) => new McpClient(options),
  log: (message) => console.log(message),
  error: (message) => console.error(message),
  prompt: async (message, options) => promptSelect(message, options),
  now: () => new Date(),
};

export async function syncCommand(
  args: string[],
  deps: SyncCommandDeps = DEFAULT_DEPS,
): Promise<void> {
  try {
    const parsed = parseSyncArgs(args);
    if (parsed instanceof Error) {
      deps.error(parsed.message);
      process.exitCode = 3;
      return;
    }

    const projectConfig = await deps.loadProjectConfig();
    if (!projectConfig?.mode) {
      deps.error("未检测到项目配置，请先运行 c4a init");
      process.exitCode = 3;
      return;
    }

    const mode = projectConfig.mode;
    deps.log("\n  同步架构知识 (双向)\n");

    if (mode === "local") {
      await syncLocal(projectConfig, parsed, deps);
      return;
    }

    await syncServerRemote(projectConfig, parsed, deps);
  } catch (error) {
    logSyncError(deps, formatError(error));
    process.exitCode = 1;
  }
}

export function parseSyncArgs(args: string[]): SyncArgs | Error {
  const options: SyncOptionsInput = {};
  let proposalId: string | undefined;

  const takeValue = (index: number): string | undefined => {
    if (index >= args.length) return undefined;
    return args[index];
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      const [rawKey, rawValue] = arg.includes("=") ? arg.split("=") : [arg, undefined];
      const key = rawKey.replace(/^--/, "");
      const value = rawValue ?? takeValue(i + 1);
      if (!rawValue && value) {
        i += 1;
      }

      switch (key) {
        case "direction":
          if (value === "import" || value === "export") {
            options.direction = value;
          } else {
            return new Error("direction 仅支持 import/export");
          }
          break;
        case "status-filter":
        case "status":
          if (value === "published" || value === "approved" || value === "all") {
            options.statusFilter = value;
          } else {
            return new Error("status-filter 仅支持 published/approved/all");
          }
          break;
        case "mode":
          if (value === "incremental" || value === "full") {
            options.mode = value;
          } else {
            return new Error("mode 仅支持 incremental/full");
          }
          break;
        case "format":
          if (value === "yaml" || value === "json") {
            options.format = value;
          } else {
            return new Error("format 仅支持 yaml/json");
          }
          break;
        case "conflict-policy":
          if (value === "warn" || value === "skip" || value === "override" || value === "prompt") {
            options.conflictPolicy = value;
          } else {
            return new Error("conflict-policy 仅支持 warn/skip/override/prompt");
          }
          break;
        default:
          return new Error(`未知参数: --${key}`);
      }
    } else if (!proposalId) {
      proposalId = arg;
    }
  }

  return { proposalId, options };
}

async function syncLocal(
  projectConfig: NonNullable<Awaited<ReturnType<typeof loadProjectConfig>>>,
  parsed: SyncArgs,
  deps: SyncCommandDeps,
): Promise<void> {
  const contextDir = resolve(process.cwd(), ".context");
  const client = deps.createMcpClient({ transport: "local" });
  const statusFilter = parsed.options.statusFilter ?? "published";
  const mode = parsed.options.mode ?? "incremental";
  const direction = parsed.options.direction;

  const lastSyncTime = await readLastSyncTime(contextDir);
  const fileChanges = await detectFileChanges(contextDir, lastSyncTime);
  const dbChanges = await detectDbChanges(client, projectConfig.project_id, lastSyncTime);

  if (direction) {
    await runStoreSync(client, direction, {
      status_filter: statusFilter,
      mode,
      format: parsed.options.format,
      conflict_policy: parsed.options.conflictPolicy,
    });
    return;
  }

  if (fileChanges > 0 && dbChanges === 0) {
    deps.log("检测到本地文件变更，正在导入到数据库...");
    await runStoreSync(client, "import", { status_filter: statusFilter, mode });
    return;
  }

  if (fileChanges === 0 && dbChanges > 0) {
    deps.log("检测到数据库变更，正在导出到本地文件...");
    await runStoreSync(client, "export", { status_filter: statusFilter, mode });
    return;
  }

  if (fileChanges === 0 && dbChanges === 0) {
    deps.log("未检测到变更，无需同步。");
    return;
  }

  deps.log("检测到双向变更：");
  deps.log(`  📁 本地: ${fileChanges} 个文件变更`);
  deps.log(`  ☁️  数据库: ${dbChanges} 个实体变更`);
  const choice = await deps.prompt("请选择同步方式:", [
    "先导入本地变更，再导出数据库变更（推荐）",
    "仅导入本地变更",
    "仅导出数据库变更",
    "取消同步",
  ]);
  if (choice === 0) {
    await runStoreSync(client, "import", { status_filter: statusFilter, mode });
    await runStoreSync(client, "export", { status_filter: statusFilter, mode });
    return;
  }
  if (choice === 1) {
    await runStoreSync(client, "import", { status_filter: statusFilter, mode });
    return;
  }
  if (choice === 2) {
    await runStoreSync(client, "export", { status_filter: statusFilter, mode });
    return;
  }
  deps.log("已取消同步。");
  return;
}

async function syncServerRemote(
  projectConfig: NonNullable<Awaited<ReturnType<typeof loadProjectConfig>>>,
  parsed: SyncArgs,
  deps: SyncCommandDeps,
): Promise<void> {
  const contextDir = resolve(process.cwd(), ".context");
  const serverUrl =
    projectConfig.mode === "server"
      ? (projectConfig as { server?: { url?: string } }).server?.url
      : undefined;
  const isRemote = projectConfig.mode === "remote";
  const baseUrl = isRemote ? projectConfig.remote?.url : serverUrl;
  const transport: McpTransport = "http";
  const client = deps.createMcpClient({ baseUrl, transport });

  const localManifest = await collectLocalManifestWithContent(contextDir);
  const snapshot = await readSyncState(contextDir);

  const response = await client.request<PlanSyncResult>("c4a_store_plan_sync", {
    local_manifest: localManifest,
    snapshot,
    options: {
      proposal_id: parsed.proposalId,
      status_filter: parsed.options.statusFilter ?? "all",
      conflict_policy: parsed.options.conflictPolicy ?? "prompt",
    },
    execute: true,
  });

  if (!response.success) {
    const message = response.error?.message ?? "同步失败";
    logSyncError(deps, message);
    process.exitCode = 1;
    return;
  }

  if (response.results?.uploaded?.length) {
    deps.log(`  ⬆️  已上传: ${response.results.uploaded.length} 个`);
  }
  deps.log(`  ⬇️  待下载: ${response.stats.to_download ?? 0} 个`);
  deps.log(`  ⚠️  冲突: ${response.stats.conflicts ?? 0} 个`);

  await executeRemainingActions(
    response.actions,
    contextDir,
    parsed.proposalId,
    projectConfig.project_id,
    deps,
    client,
  );
  await writeSyncState(contextDir, response.new_snapshot);
  deps.log("\n✅ 同步完成");
}

async function runStoreSync(
  client: McpClientLike,
  direction: SyncDirection,
  options: {
    status_filter?: "published" | "approved" | "all";
    mode?: SyncMode;
    format?: "yaml" | "json";
    conflict_policy?: ConflictPolicy;
  },
): Promise<void> {
  await client.request("c4a_store_sync", {
    direction,
    path: ".context",
    status_filter: options.status_filter,
    mode: options.mode,
    format: options.format,
    conflict_policy: options.conflict_policy,
  });
}

async function executeRemainingActions(
  actions: SyncAction[],
  contextDir: string,
  proposalId: string | undefined,
  sourceProject: string | undefined,
  deps: SyncCommandDeps,
  client: McpClientLike,
): Promise<void> {
  for (const action of actions) {
    switch (action.op) {
      case "download":
        if (!action.path || !action.content) break;
        await writeContent(contextDir, action.path, action.content);
        deps.log(`⬇️  下载: ${action.path}`);
        break;
      case "delete_local":
        if (!action.path) break;
        await deleteLocalFile(contextDir, action.path);
        deps.log(`🗑️  删除本地: ${action.path}`);
        break;
      case "delete_remote":
        await client.request("c4a_store_delete", {
          id: action.entity_id,
          proposal_id: proposalId ?? null,
        });
        deps.log(`🗑️  删除远程: ${action.entity_id}`);
        break;
      case "upload":
        await uploadLocalEntity(contextDir, action, proposalId, sourceProject, client);
        deps.log(`⬆️  上传: ${action.path ?? action.entity_id}`);
        break;
      case "conflict":
        await handleConflict(action, contextDir, proposalId, sourceProject, deps, client);
        break;
      case "skip":
      default:
        break;
    }
  }
}

async function handleConflict(
  conflict: SyncAction,
  contextDir: string,
  proposalId: string | undefined,
  sourceProject: string | undefined,
  deps: SyncCommandDeps,
  client: McpClientLike,
): Promise<void> {
  if (!conflict.path) return;
  deps.log(`\n⚠️  冲突: ${conflict.path}`);
  const conflictType = conflict.conflict_type ?? "both_modified";
  const choice = await deps.prompt("如何处理？", buildConflictOptions(conflictType));

  if (conflictType === "both_modified") {
    if (choice === 0) {
      await uploadLocalEntity(contextDir, conflict, proposalId, sourceProject, client);
      deps.log("已选择使用本地版本");
    } else if (choice === 1) {
      if (conflict.remote_content) {
        await writeContent(contextDir, conflict.path, conflict.remote_content);
        deps.log("已选择使用远程版本");
      }
    } else if (choice === 2) {
      await showDiff(contextDir, conflict);
      await handleConflict(conflict, contextDir, proposalId, sourceProject, deps, client);
    } else {
      deps.log("已跳过冲突");
    }
    return;
  }

  if (conflictType === "remote_deleted") {
    if (choice === 0) {
      await deleteLocalFile(contextDir, conflict.path);
    } else if (choice === 1) {
      await uploadLocalEntity(contextDir, conflict, proposalId, sourceProject, client);
    } else {
      deps.log("已跳过冲突");
    }
    return;
  }

  if (conflictType === "local_deleted") {
    if (choice === 0) {
      await client.request("c4a_store_delete", {
        id: conflict.entity_id,
        proposal_id: proposalId ?? null,
      });
    } else if (choice === 1 && conflict.remote_content) {
      await writeContent(contextDir, conflict.path, conflict.remote_content);
    } else {
      deps.log("已跳过冲突");
    }
  }
}

function buildConflictOptions(conflictType: SyncAction["conflict_type"]): string[] {
  if (conflictType === "remote_deleted") {
    return ["删除本地文件（与远程保持一致）", "重新上传到远程（恢复实体）", "跳过（保持现状）"];
  }
  if (conflictType === "local_deleted") {
    return ["删除远程实体（与本地保持一致）", "重新下载到本地（恢复文件）", "跳过（保持现状）"];
  }
  return ["使用本地版本（覆盖远程）", "使用远程版本（覆盖本地）", "查看差异（diff）", "跳过此文件"];
}

async function showDiff(contextDir: string, conflict: SyncAction): Promise<void> {
  if (!conflict.path) return;
  const localPath = join(contextDir, conflict.path);
  const localContent = existsSync(localPath) ? await readFile(localPath, "utf-8") : "";
  const remoteContent = conflict.remote_content ?? "";
  console.log("\n--- 本地版本 ---\n");
  console.log(localContent);
  console.log("\n--- 远程版本 ---\n");
  console.log(remoteContent);
}

async function uploadLocalEntity(
  contextDir: string,
  action: SyncAction,
  proposalId: string | undefined,
  sourceProject: string | undefined,
  client: McpClientLike,
): Promise<void> {
  if (!action.path || !action.type) return;
  const filePath = join(contextDir, action.path);
  const content = await readFile(filePath, "utf-8");
  await client.request("c4a_store_save", {
    type: action.type,
    content,
    format: "yaml",
    id: action.entity_id,
    proposal_id: proposalId ?? null,
    source_project: sourceProject,
  });
}

async function collectLocalManifestWithContent(contextDir: string): Promise<LocalManifest> {
  const files: LocalFileInfo[] = [];
  const entries = await walkDir(contextDir);
  for (const entry of entries) {
    const relativePath = relative(contextDir, entry.path);
    if (!isYamlFile(relativePath)) continue;
    if (shouldIgnoreSync(relativePath)) continue;

    const content = await readFile(entry.path, "utf-8");
    const parsed = parseDSL<Record<string, unknown>>(content);
    const info = parseEntityInfo(parsed, relativePath);
    if (!info) continue;
    if (info.type === "feat") continue;

    files.push({
      path: normalizePath(relativePath),
      entity_id: info.id,
      type: info.type,
      content_hash: calculateHash(content, "yaml"),
      updated_at: entry.mtime.toISOString(),
      proposal_id: info.proposalId,
      content,
    });
  }
  return { files };
}

function parseEntityInfo(
  parsed: Record<string, unknown>,
  relativePath: string,
): { id: string; type: EntityType | "feat"; proposalId?: string } | null {
  const rawType = parsed.type;
  if (typeof rawType !== "string") return null;
  const normalizedType = normalizeDslType(rawType);
  if (!normalizedType) return null;
  const id = extractEntityId(parsed, normalizedType, relativePath);
  if (!id) return null;
  const proposalId = extractProposalId(relativePath);
  return { id, type: normalizedType, proposalId };
}

function normalizeDslType(rawType: string): EntityType | "feat" | null {
  if (rawType === "software-system") return "system";
  if (rawType === "container") return "container";
  if (rawType === "component") return "component";
  if (rawType === "process") return "process";
  if (rawType === "sor") return "sor";
  if (rawType === "adr") return "adr";
  if (rawType === "contract") return "contract";
  if (rawType === "product") return "product";
  if (rawType === "feat") return "feat";
  return null;
}

function extractEntityId(
  parsed: Record<string, unknown>,
  type: EntityType | "feat",
  relativePath: string,
): string | null {
  if (type === "feat") {
    const id = parsed.id;
    return typeof id === "string" ? id : null;
  }

  const key = type === "system" ? "system" : type;
  const section = parsed[key] as Record<string, unknown> | undefined;
  if (section && typeof section.id === "string") {
    return section.id;
  }
  return deriveIdFromPath(relativePath);
}

function deriveIdFromPath(relativePath: string): string {
  const file = relativePath.split(sep).pop() ?? "";
  return file.replace(/\.c4a\.yaml$/i, "").replace(/\.yaml$/i, "");
}

function extractProposalId(relativePath: string): string | undefined {
  const segments = normalizePath(relativePath).split("/");
  const featIndex = segments.indexOf("feat");
  if (featIndex >= 0 && segments.length > featIndex + 1) {
    const featId = segments[featIndex + 1];
    if (featId.startsWith("feat-")) return featId;
  }
  return undefined;
}

function isYamlFile(relativePath: string): boolean {
  return relativePath.endsWith(".yaml") || relativePath.endsWith(".c4a.yaml");
}

function shouldIgnoreSync(relativePath: string): boolean {
  const file = relativePath.split(sep).pop() ?? "";
  if (file === "checklist.md") return true;
  if (file === "feat.yaml") return true;
  if (file === ".sync-state.json") return true;
  if (file === ".c4a.yaml") return true;
  return false;
}

async function readSyncState(contextDir: string): Promise<SyncSnapshot | null> {
  const filePath = join(contextDir, ".sync-state.json");
  if (!existsSync(filePath)) return null;
  const content = await readFile(filePath, "utf-8");
  try {
    return JSON.parse(content) as SyncSnapshot;
  } catch (error) {
    return null;
  }
}

async function writeSyncState(contextDir: string, snapshot: SyncSnapshot): Promise<void> {
  await writeFile(join(contextDir, ".sync-state.json"), JSON.stringify(snapshot, null, 2), "utf-8");
}

async function readLastSyncTime(contextDir: string): Promise<Date> {
  const snapshot = await readSyncState(contextDir);
  if (snapshot?.synced_at) {
    const parsed = new Date(snapshot.synced_at);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date(0);
}

async function detectFileChanges(contextDir: string, since: Date): Promise<number> {
  const files = await walkDir(contextDir);
  let count = 0;
  for (const entry of files) {
    const relativePath = relative(contextDir, entry.path);
    if (!isYamlFile(relativePath)) continue;
    if (shouldIgnoreSync(relativePath)) continue;
    if (entry.mtime > since) count += 1;
  }
  return count;
}

async function detectDbChanges(
  client: McpClientLike,
  projectId: string | undefined,
  since: Date,
): Promise<number> {
  const updatedAfter = since.toISOString();
  const result = await client.request<{ items?: Array<{ id: string }> }>("c4a_store_list", {
    project_id: projectId,
    updated_after: updatedAfter,
    limit: 1,
  });
  return result.items?.length ? result.items.length : 0;
}

async function walkDir(root: string): Promise<Array<{ path: string; mtime: Date }>> {
  const entries: Array<{ path: string; mtime: Date }> = [];
  if (!existsSync(root)) return entries;

  const items = await readdir(root, { withFileTypes: true });
  for (const item of items) {
    const fullPath = join(root, item.name);
    if (item.isDirectory()) {
      const nested = await walkDir(fullPath);
      entries.push(...nested);
    } else if (item.isFile()) {
      const info = await stat(fullPath);
      entries.push({ path: fullPath, mtime: info.mtime });
    }
  }
  return entries;
}

async function writeContent(contextDir: string, relativePath: string, content: string): Promise<void> {
  const targetPath = join(contextDir, relativePath);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf-8");
}

async function deleteLocalFile(contextDir: string, relativePath: string): Promise<void> {
  const targetPath = join(contextDir, relativePath);
  if (!existsSync(targetPath)) return;
  await unlink(targetPath);
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function logSyncError(deps: SyncCommandDeps, message: string): void {
  const response = {
    code: DATA_ERROR_CODES.VERSION_CONFLICT,
    message,
    details: {
      suggestion: "请确认本地与远程数据是否一致",
    },
    timestamp: new Date().toISOString(),
    recoverable_actions: [
      { action: "retry", label: "重试" },
      { action: "skip", label: "跳过" },
      { action: "force", label: "强制覆盖" },
    ],
  };
  deps.error(JSON.stringify(response, null, 2));
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function promptSelect(message: string, options: string[]): Promise<number> {
  if (!process.stdin.isTTY) return 0;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const promptText = `${message}\n${options.map((opt, idx) => `  ${idx + 1}. ${opt}`).join("\n")}\n选择: `;
    const answer = await rl.question(promptText);
    const index = Number.parseInt(answer, 10) - 1;
    if (Number.isNaN(index) || index < 0 || index >= options.length) {
      return 0;
    }
    return index;
  } finally {
    rl.close();
  }
}
