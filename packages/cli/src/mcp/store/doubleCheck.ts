/**
 * Double Check 机制 - CLI 本地文件写入保护
 *
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-sync.md §Double Check
 *
 * 背景：从 c4a_store_plan_sync 获取操作计划到 CLI 执行写入之间存在时间窗口。
 * 如果用户在此期间修改了本地文件，直接执行 download 或 delete_local 会导致用户修改丢失。
 */
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

/**
 * 写入操作类型
 */
export interface WriteAction {
  /** 操作类型 */
  op: "download" | "delete_local";
  /** 相对路径 */
  path: string;
  /** 计划生成时的本地文件 Hash */
  expected_hash?: string | null;
  /** download 时的远程内容 */
  content?: string;
}

/**
 * 写入结果
 */
export interface WriteResult {
  success: boolean;
  error?: "LOCAL_FILE_CHANGED" | "FILE_ALREADY_EXISTS" | "WRITE_ERROR";
  message?: string;
  suggestion?: string;
  local_hash?: string | null;
  expected_hash?: string | null;
}

/**
 * 计算内容的 SHA-256 Hash
 */
export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * 读取本地文件并计算 Hash
 * @returns Hash 值，文件不存在返回 null
 */
export async function getFileHash(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return computeHash(content);
  } catch {
    return null; // 文件不存在
  }
}

/**
 * 执行写入操作（带 Double Check 保护）
 *
 * @param action - 写入操作
 * @param projectRoot - 项目根目录
 * @returns 写入结果
 */
export async function executeWriteAction(
  action: WriteAction,
  projectRoot: string
): Promise<WriteResult> {
  const filePath = resolve(projectRoot, action.path);

  // 1. Double Check：重新计算本地文件 Hash
  const currentHash = await getFileHash(filePath);

  // 2. 比对 Hash，检测时间窗口内的修改
  if (action.op === "download") {
    // 下载操作
    if (action.expected_hash === undefined || action.expected_hash === null) {
      // 新建文件：检查文件是否已存在
      if (currentHash !== null) {
        return {
          success: false,
          error: "FILE_ALREADY_EXISTS",
          message: `文件 ${action.path} 在同步计划生成后被创建`,
          suggestion: "请重新执行同步以获取最新计划",
          local_hash: currentHash,
          expected_hash: null,
        };
      }
    } else {
      // 覆盖已有文件：Hash 比对
      if (action.expected_hash !== currentHash) {
        return {
          success: false,
          error: "LOCAL_FILE_CHANGED",
          message: `文件 ${action.path} 在同步计划生成后被修改`,
          suggestion: "请重新执行同步以获取最新计划",
          local_hash: currentHash,
          expected_hash: action.expected_hash,
        };
      }
    }

    // 3. Hash 一致，安全执行写入
    try {
      // 确保目录存在
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, action.content!, "utf-8");
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: "WRITE_ERROR",
        message: `写入文件失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else if (action.op === "delete_local") {
    // 删除操作：Hash 比对
    if (action.expected_hash !== currentHash) {
      return {
        success: false,
        error: "LOCAL_FILE_CHANGED",
        message: `文件 ${action.path} 在同步计划生成后被修改`,
        suggestion: "请重新执行同步以获取最新计划",
        local_hash: currentHash,
        expected_hash: action.expected_hash,
      };
    }

    // Hash 一致，安全执行删除
    try {
      await unlink(filePath);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: "WRITE_ERROR",
        message: `删除文件失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return { success: false, error: "WRITE_ERROR", message: "未知操作类型" };
}

/**
 * 批量执行写入操作
 *
 * @param actions - 写入操作列表
 * @param projectRoot - 项目根目录
 * @returns 执行结果列表
 */
export async function executeBatchWriteActions(
  actions: WriteAction[],
  projectRoot: string
): Promise<{ results: WriteResult[]; hasConflicts: boolean }> {
  const results: WriteResult[] = [];
  let hasConflicts = false;

  for (const action of actions) {
    const result = await executeWriteAction(action, projectRoot);
    results.push(result);
    if (!result.success) {
      hasConflicts = true;
    }
  }

  return { results, hasConflicts };
}
