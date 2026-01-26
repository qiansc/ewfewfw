/**
 * C4A YAML 工具
 *
 * 用于 DSL 文件的解析和序列化
 */

import { parse, stringify } from 'yaml';

// ============================================================================
// YAML 解析
// ============================================================================

/**
 * 解析 YAML 字符串
 */
export function parseYAML<T = unknown>(content: string): T {
  return parse(content) as T;
}

/**
 * 安全解析 YAML，返回结果或错误
 */
export function parseYAMLSafe<T = unknown>(
  content: string,
): { success: true; data: T } | { success: false; error: string } {
  try {
    const data = parse(content) as T;
    return { success: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ============================================================================
// YAML 序列化
// ============================================================================

/**
 * YAML 序列化选项
 */
export interface StringifyOptions {
  /** 缩进空格数 */
  indent?: number;
  /** 是否使用流式风格 */
  flowLevel?: number;
  /** 行宽限制 */
  lineWidth?: number;
}

/**
 * 序列化为 YAML 字符串
 */
export function stringifyYAML(data: unknown, options?: StringifyOptions): string {
  return stringify(data, {
    indent: options?.indent ?? 2,
    lineWidth: options?.lineWidth ?? 120,
  });
}

// ============================================================================
// YAML 验证
// ============================================================================

/**
 * 验证 YAML 语法是否正确
 */
export function validateYAMLSyntax(content: string): {
  valid: boolean;
  error?: string;
} {
  const result = parseYAMLSafe(content);
  if (result.success) {
    return { valid: true };
  }
  return { valid: false, error: result.error };
}
