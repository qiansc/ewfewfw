/**
 * 本地文件保护机制
 *
 * 防止 CLI 渲染的文件被意外覆盖用户的手动修改
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-feat-checklist.md §3.8.1
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { computeHash } from "./doubleCheck.js";

/**
 * C4A 文件头部元数据
 */
export interface C4AFileHeader {
  feat_id: string;
  rendered_at: string;
  content_hash: string;
}

/**
 * 渲染前检查结果
 */
export interface CheckBeforeRenderResult {
  canRender: boolean;
  reason?:
    | "file_not_exists"
    | "file_unchanged"
    | "file_modified"
    | "no_c4a_header";
  originalHash?: string;
  currentHash?: string;
  message?: string;
}

/**
 * 安全渲染结果
 */
export interface SafeRenderResult {
  success: boolean;
  filePath: string;
  action: "created" | "updated" | "skipped" | "force_overwritten";
  message?: string;
  error?: string;
}

/**
 * C4A 文件头部正则表达式
 */
const C4A_HEADER_REGEX =
  /<!--\s*C4A-GENERATED\s+feat_id:\s*(\S+)\s+rendered_at:\s*(\S+)\s+content_hash:\s*(\S+)\s+DO NOT EDIT:[^>]*-->/;

/**
 * 解析 C4A 文件头部
 *
 * @param content - 文件内容
 * @returns 头部元数据，如果不存在则返回 null
 */
export function parseC4AHeader(content: string): C4AFileHeader | null {
  const match = content.match(C4A_HEADER_REGEX);
  if (!match) {
    return null;
  }

  return {
    feat_id: match[1],
    rendered_at: match[2],
    content_hash: match[3],
  };
}

/**
 * 生成 C4A 文件头部
 *
 * @param featId - Feat ID
 * @param contentHash - 内容哈希（不含头部）
 * @returns 头部字符串
 */
export function generateC4AHeader(featId: string, contentHash: string): string {
  const now = new Date().toISOString();
  return `<!-- C4A-GENERATED
     feat_id: ${featId}
     rendered_at: ${now}
     content_hash: ${contentHash}
     DO NOT EDIT: 此文件由 C4A 自动生成，手动修改将在下次渲染时丢失
-->`;
}

/**
 * 生成带保护头部的文件内容
 *
 * @param featId - Feat ID
 * @param body - 文件主体内容
 * @returns 带头部的完整内容
 */
export function generateProtectedContent(featId: string, body: string): string {
  const bodyHash = computeHash(body);
  const header = generateC4AHeader(featId, bodyHash);
  return `${header}\n\n${body}`;
}

/**
 * 从带头部的内容中提取主体部分
 *
 * @param content - 完整文件内容
 * @returns 主体内容（不含头部）
 */
export function extractBody(content: string): string {
  // 移除 C4A 头部注释
  return content.replace(C4A_HEADER_REGEX, "").trim();
}

/**
 * 渲染前检查
 *
 * 检测文件是否可以安全渲染（覆盖）
 *
 * @param filePath - 文件路径
 * @returns 检查结果
 */
export function checkBeforeRender(filePath: string): CheckBeforeRenderResult {
  // 文件不存在，可以安全渲染
  if (!existsSync(filePath)) {
    return {
      canRender: true,
      reason: "file_not_exists",
    };
  }

  const content = readFileSync(filePath, "utf-8");
  const header = parseC4AHeader(content);

  // 文件存在但无 C4A 头部 → 可能是用户手动创建的
  if (!header) {
    return {
      canRender: false,
      reason: "no_c4a_header",
      message:
        `文件 ${filePath} 不是 C4A 生成的文件，拒绝覆盖。\n` +
        `如需重新生成，请先手动删除或重命名该文件。`,
    };
  }

  // 计算当前主体内容的哈希
  const body = extractBody(content);
  const currentHash = computeHash(body);

  // 比较哈希
  if (currentHash === header.content_hash) {
    // 文件未修改，可以安全渲染
    return {
      canRender: true,
      reason: "file_unchanged",
      originalHash: header.content_hash,
      currentHash,
    };
  }

  // 文件已被修改
  return {
    canRender: false,
    reason: "file_modified",
    originalHash: header.content_hash,
    currentHash,
    message:
      `文件 ${filePath} 已被手动修改，拒绝覆盖。\n` +
      `选项：\n` +
      `  1. 使用 --force 强制覆盖（丢失本地修改）\n` +
      `  2. 手动删除文件后重新渲染\n` +
      `  3. 通过 MCP 工具将修改同步到数据库`,
  };
}

/**
 * 安全渲染文件
 *
 * 整合检查和写入操作
 *
 * @param filePath - 目标文件路径
 * @param featId - Feat ID
 * @param body - 文件主体内容
 * @param options - 选项
 * @returns 渲染结果
 */
export function safeRenderFile(
  filePath: string,
  featId: string,
  body: string,
  options: { force?: boolean } = {}
): SafeRenderResult {
  const checkResult = checkBeforeRender(filePath);

  // 检查是否可以渲染
  if (!checkResult.canRender && !options.force) {
    return {
      success: false,
      filePath,
      action: "skipped",
      error: checkResult.message,
    };
  }

  // 确保目录存在
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // 生成带保护头部的内容
  const content = generateProtectedContent(featId, body);

  // 写入文件
  writeFileSync(filePath, content, "utf-8");

  // 确定操作类型
  let action: SafeRenderResult["action"];
  let message: string | undefined;

  if (checkResult.reason === "file_not_exists") {
    action = "created";
  } else if (options.force && !checkResult.canRender) {
    action = "force_overwritten";
    message = `警告：已强制覆盖被修改的文件 ${filePath}`;
  } else {
    action = "updated";
  }

  return {
    success: true,
    filePath,
    action,
    message,
  };
}

/**
 * 格式化用户友好的错误信息
 *
 * @param result - 检查结果
 * @param filePath - 文件路径
 * @returns 格式化的错误信息
 */
export function formatCheckError(
  result: CheckBeforeRenderResult,
  filePath: string
): string {
  if (result.canRender) {
    return "";
  }

  const lines: string[] = [];

  if (result.reason === "file_modified") {
    lines.push(`❌ 错误：文件 ${filePath} 已被手动修改`);
    lines.push("");
    lines.push("检测到本地修改：");
    lines.push(`  - 原始哈希: ${result.originalHash}`);
    lines.push(`  - 当前哈希: ${result.currentHash}`);
    lines.push("");
    lines.push("选项：");
    lines.push(`  1. c4a feat render <feat_id> --force  # 强制覆盖（丢失本地修改）`);
    lines.push(`  2. 手动删除文件后重新运行`);
    lines.push(
      `  3. 如需保留修改，请通过 Agent 使用 c4a_store_feat_checklist 更新数据库`
    );
  } else if (result.reason === "no_c4a_header") {
    lines.push(`❌ 错误：文件 ${filePath} 不是 C4A 生成的文件`);
    lines.push("");
    lines.push("该文件可能是手动创建的，为避免数据丢失，拒绝覆盖。");
    lines.push("");
    lines.push("选项：");
    lines.push(`  1. 手动删除或重命名该文件后重新运行`);
    lines.push(`  2. 使用 --force 强制覆盖（丢失原有内容）`);
  }

  return lines.join("\n");
}
