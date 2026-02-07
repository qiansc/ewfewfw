/**
 * C4A 工具函数
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * 解析 YAML 字符串为 DSL 对象
 */
export function parseDSL<T>(content: string): T {
  return parseYaml(content) as T;
}

/**
 * 将 DSL 对象序列化为 YAML
 */
export function stringifyDSL(data: unknown): string {
  return stringifyYaml(data, { indent: 2 });
}

/**
 * 生成唯一 ID
 */
export function generateId(prefix: string = "c4a"): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * 获取当前 ISO 时间戳
 */
export function now(): string {
  return new Date().toISOString();
}

export * from "./id.js";
export * from "./security.js";
export * from "./hash.js";
export * from "./uuid.js";
export * from "./version.js";
