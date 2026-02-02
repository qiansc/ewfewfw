/**
 * C4A 安全工具
 *
 * 输入验证（路径安全）与输出转义（HTML/Mermaid）
 */

import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { InputError, INPUT_ERROR_CODES } from '../types/errors.js';

type InputErrorCode = (typeof INPUT_ERROR_CODES)[keyof typeof INPUT_ERROR_CODES];

export interface PathValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: InputErrorCode; // C4A-INPUT-006 或 C4A-INPUT-007
}

const WINDOWS_DRIVE_REGEX = /^[a-zA-Z]:[\\/]/;

function normalizeInputPath(inputPath: string): string {
  let normalized = inputPath.replace(/\\/g, '/');
  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

function isOutsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel.startsWith('..') || isAbsolute(rel);
}

function buildInvalid(errorCode: InputErrorCode, error: string): PathValidationResult {
  return { valid: false, error, errorCode };
}

function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code);
  }
  return undefined;
}

async function resolveRealPathIfExists(targetPath: string): Promise<string | null> {
  try {
    await lstat(targetPath);
    return await realpath(targetPath);
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function assertRealPathWithinRoot(
  resolvedPath: string,
  realRoot: string,
): Promise<void> {
  const realResolved = await realpath(resolvedPath);
  if (isOutsideRoot(realRoot, realResolved)) {
    throw new InputError(INPUT_ERROR_CODES.PATH_TRAVERSAL, {
      field: 'path',
      actual: resolvedPath,
      expected: 'path within project root',
      suggestion: '检测到符号链接或路径逃逸',
    });
  }
}

/**
 * HTML 转义（用于可视化渲染）
 * 转义字符：& < > " '
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Mermaid 字符串转义（用于图表渲染）
 * 转义字符：" # ; 以及换行符
 */
export function escapeMermaidString(text: string): string {
  const map: Record<string, string> = {
    '"': '#quot;',
    '#': '#35;',
    ';': '#59;',
    '\n': '#10;',
    '\r': '#13;',
  };
  return text.replace(/["#;\n\r]/g, (char) => map[char]);
}

/**
 * 验证路径安全性
 *
 * 输入要求：
 * - inputPath 必须是相对路径（不以 / 或盘符开头）
 * - 允许 ./ 前缀，会被标准化移除
 * - 路径分隔符统一使用 /（Windows \ 会被转换）
 *
 * 校验规则：
 * - 禁止父目录引用（..）
 * - 禁止绝对路径（/ 开头或 Windows 盘符）
 * - 解析后必须在 projectRoot 内
 * - 检查符号链接是否逃逸出 projectRoot
 */
export async function validatePath(
  inputPath: string,
  projectRoot: string,
): Promise<PathValidationResult> {
  if (!inputPath || typeof inputPath !== 'string') {
    return buildInvalid(INPUT_ERROR_CODES.INVALID_PATH_CHARS, '路径不能为空');
  }

  const normalized = normalizeInputPath(inputPath);

  if (!normalized || normalized === '.') {
    return buildInvalid(INPUT_ERROR_CODES.INVALID_PATH_CHARS, '路径不能为空');
  }

  if (
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    WINDOWS_DRIVE_REGEX.test(normalized)
  ) {
    return buildInvalid(INPUT_ERROR_CODES.INVALID_PATH_CHARS, '不允许绝对路径');
  }

  const segments = normalized.split('/');
  if (segments.includes('..')) {
    return buildInvalid(INPUT_ERROR_CODES.INVALID_PATH_CHARS, '不允许父目录引用 (..)');
  }

  const resolvedRoot = resolve(projectRoot);
  const resolvedPath = resolve(resolvedRoot, normalized);

  if (isOutsideRoot(resolvedRoot, resolvedPath)) {
    return buildInvalid(INPUT_ERROR_CODES.PATH_TRAVERSAL, '路径必须在项目根目录内');
  }

  const realRoot = await realpath(resolvedRoot).catch(() => resolvedRoot);
  let realResolved: string | null = null;
  try {
    realResolved = await resolveRealPathIfExists(resolvedPath);
  } catch {
    return buildInvalid(INPUT_ERROR_CODES.PATH_TRAVERSAL, '无法解析路径');
  }

  if (realResolved && isOutsideRoot(realRoot, realResolved)) {
    return buildInvalid(INPUT_ERROR_CODES.PATH_TRAVERSAL, '符号链接指向项目外');
  }

  return { valid: true };
}

/**
 * TOCTOU 安全的文件读取
 *
 * 先验证路径，再读取文件。
 * 如果路径验证失败，抛出 InputError。
 */
export async function safeReadFile(
  inputPath: string,
  projectRoot: string,
): Promise<Buffer> {
  const validation = await validatePath(inputPath, projectRoot);
  if (!validation.valid) {
    const code = validation.errorCode || INPUT_ERROR_CODES.INVALID_PATH_CHARS;
    throw new InputError(code, {
      field: 'path',
      actual: inputPath,
      expected: 'relative path within project root',
      suggestion: validation.error,
    });
  }

  const normalized = normalizeInputPath(inputPath);
  const resolvedRoot = resolve(projectRoot);
  const resolvedPath = resolve(resolvedRoot, normalized);
  const realRoot = await realpath(resolvedRoot).catch(() => resolvedRoot);

  await assertRealPathWithinRoot(resolvedPath, realRoot);

  const fileHandle = await open(resolvedPath, constants.O_RDONLY);
  try {
    await assertRealPathWithinRoot(resolvedPath, realRoot);
    const data = await fileHandle.readFile();
    await assertRealPathWithinRoot(resolvedPath, realRoot);
    return data;
  } finally {
    await fileHandle.close();
  }
}
