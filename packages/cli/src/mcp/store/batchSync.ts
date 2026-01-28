/**
 * 大批量同步优化 - CLI 分批 + 会话管理
 *
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-sync.md §3.5.2
 *
 * 设计原则：分批同步是基础设施细节，不应暴露给 Agent。
 * Agent 只需调用一个 MCP 工具，CLI 内部处理复杂性。
 */
import { readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";

// ============================================================
// 类型定义
// ============================================================

/**
 * 本地文件信息
 */
export interface LocalFile {
  entity_id: string;
  path: string;
  content_hash: string;
  type: string;
  updated_at: string;
}

/**
 * 同步会话状态（本地保存）
 */
export interface SyncSessionState {
  session_id: string;
  uploaded_entities: string[];
  last_updated: string;
}

/**
 * 同步计划项
 */
export interface SyncPlanItem {
  entity_id: string;
  path: string;
  reason: string;
}

/**
 * 同步计划
 */
export interface SyncPlan {
  to_upload: SyncPlanItem[];
  to_download: Array<SyncPlanItem & { content: string }>;
  conflicts: SyncPlanItem[];
}

/**
 * 会话创建响应
 */
export interface SessionResponse {
  session_id: string;
  expires_at: string;
  plan: SyncPlan;
}

/**
 * 上传进度响应
 */
export interface UploadProgressResponse {
  uploaded: number;
  total_uploaded: number;
  pending: number;
  progress: number;
}

/**
 * 提交响应
 */
export interface CommitResponse {
  success: boolean;
  committed: string[];
  new_snapshot: Record<string, unknown>;
}

/**
 * 会话状态响应
 */
export interface SessionStatusResponse {
  status: "pending" | "uploading" | "committed" | "expired";
  uploaded_count: number;
  total_count: number;
}

/**
 * 同步选项
 */
export interface BatchSyncOptions {
  batchSize?: number;
  sessionTtl?: number;
  onProgress?: (progress: number, message: string) => void;
}

// ============================================================
// 常量
// ============================================================

/** 自动切换到分批模式的阈值 */
export const BATCH_THRESHOLD = 100;

/** 默认批次大小 */
export const DEFAULT_BATCH_SIZE = 50;

/** 默认会话 TTL（秒） */
export const DEFAULT_SESSION_TTL = 1800;

/** 会话状态文件名 */
export const SESSION_STATE_FILE = ".sync-session.json";

// ============================================================
// HTTP 客户端（内部使用）
// ============================================================

/**
 * HTTP 客户端配置
 */
export interface HttpClientConfig {
  baseUrl: string;
  timeout?: number;
}

/**
 * 创建 HTTP 客户端
 */
export function createHttpClient(config: HttpClientConfig) {
  const { baseUrl, timeout = 30000 } = config;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          `HTTP ${response.status}: ${(error as { message?: string }).message || response.statusText}`
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
    get: <T>(path: string) => request<T>("GET", path),
    delete: <T>(path: string) => request<T>("DELETE", path),
  };
}

// ============================================================
// 会话状态管理
// ============================================================

/**
 * 保存会话状态到本地
 */
export async function saveSessionState(
  projectRoot: string,
  state: SyncSessionState
): Promise<void> {
  const filePath = resolve(projectRoot, SESSION_STATE_FILE);
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * 加载本地会话状态
 */
export async function loadSessionState(
  projectRoot: string
): Promise<SyncSessionState | null> {
  const filePath = resolve(projectRoot, SESSION_STATE_FILE);
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as SyncSessionState;
  } catch {
    return null;
  }
}

/**
 * 清除本地会话状态
 */
export async function clearSessionState(projectRoot: string): Promise<void> {
  const filePath = resolve(projectRoot, SESSION_STATE_FILE);
  try {
    await unlink(filePath);
  } catch {
    // 文件不存在，忽略
  }
}

// ============================================================
// 分批同步核心逻辑
// ============================================================

/**
 * 分批同步
 *
 * @param files - 本地文件列表
 * @param serverUrl - Server URL
 * @param projectRoot - 项目根目录
 * @param options - 同步选项
 */
export async function batchSync(
  files: LocalFile[],
  serverUrl: string,
  projectRoot: string,
  options: BatchSyncOptions = {}
): Promise<CommitResponse> {
  const {
    batchSize = DEFAULT_BATCH_SIZE,
    sessionTtl = DEFAULT_SESSION_TTL,
    onProgress,
  } = options;

  const http = createHttpClient({ baseUrl: serverUrl });

  // 1. 创建会话
  onProgress?.(0, "创建同步会话...");
  const session = await http.post<SessionResponse>("/sync/session", {
    local_manifest: {
      files: files.map((f) => ({
        entity_id: f.entity_id,
        content_hash: f.content_hash,
        path: f.path,
        type: f.type,
        updated_at: f.updated_at,
      })),
    },
    options: { batch_size: batchSize, session_ttl: sessionTtl },
  });

  // 保存会话状态
  await saveSessionState(projectRoot, {
    session_id: session.session_id,
    uploaded_entities: [],
    last_updated: new Date().toISOString(),
  });

  // 2. 分批上传
  const toUpload = session.plan.to_upload;
  const uploadedEntities: string[] = [];

  for (let i = 0; i < toUpload.length; i += batchSize) {
    const batch = toUpload.slice(i, i + batchSize);

    // 读取文件内容
    const filesWithContent = await Promise.all(
      batch.map(async (item) => ({
        entity_id: item.entity_id,
        content: await readFile(resolve(projectRoot, item.path), "utf-8"),
      }))
    );

    // 上传批次
    const result = await http.post<UploadProgressResponse>(
      `/sync/session/${session.session_id}/upload`,
      { files: filesWithContent }
    );

    // 更新已上传列表
    uploadedEntities.push(...batch.map((b) => b.entity_id));

    // 更新本地状态
    await saveSessionState(projectRoot, {
      session_id: session.session_id,
      uploaded_entities: uploadedEntities,
      last_updated: new Date().toISOString(),
    });

    // 报告进度
    onProgress?.(result.progress, `已上传 ${result.total_uploaded}/${toUpload.length}`);
  }

  // 3. 提交
  onProgress?.(95, "提交变更...");
  const commitResult = await http.post<CommitResponse>(
    `/sync/session/${session.session_id}/commit`,
    {}
  );

  // 清除会话状态
  await clearSessionState(projectRoot);

  onProgress?.(100, "同步完成");
  return commitResult;
}

/**
 * 恢复中断的同步
 */
export async function resumeSync(
  serverUrl: string,
  projectRoot: string,
  options: BatchSyncOptions = {}
): Promise<CommitResponse | null> {
  const { onProgress } = options;
  const http = createHttpClient({ baseUrl: serverUrl });

  // 加载本地会话状态
  const state = await loadSessionState(projectRoot);
  if (!state) {
    return null;
  }

  // 检查会话状态
  onProgress?.(0, "检查会话状态...");
  const status = await http.get<SessionStatusResponse>(
    `/sync/session/${state.session_id}/status`
  );

  if (status.status === "expired") {
    await clearSessionState(projectRoot);
    return null;
  }

  if (status.status === "committed") {
    await clearSessionState(projectRoot);
    return { success: true, committed: [], new_snapshot: {} };
  }

  // 继续上传（需要重新获取计划）
  onProgress?.(
    (status.uploaded_count / status.total_count) * 100,
    `恢复同步: ${status.uploaded_count}/${status.total_count}`
  );

  // 提交
  const commitResult = await http.post<CommitResponse>(
    `/sync/session/${state.session_id}/commit`,
    {}
  );

  await clearSessionState(projectRoot);
  return commitResult;
}

/**
 * 取消同步会话
 */
export async function cancelSync(
  serverUrl: string,
  projectRoot: string
): Promise<boolean> {
  const http = createHttpClient({ baseUrl: serverUrl });
  const state = await loadSessionState(projectRoot);

  if (!state) {
    return false;
  }

  try {
    await http.delete(`/sync/session/${state.session_id}`);
  } catch {
    // 会话可能已过期
  }

  await clearSessionState(projectRoot);
  return true;
}

/**
 * 判断是否需要分批同步
 */
export function shouldUseBatchSync(fileCount: number): boolean {
  return fileCount > BATCH_THRESHOLD;
}
