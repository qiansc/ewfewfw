/**
 * UUID 工具
 *
 * 目前使用 UUID v4（与 PRD 一致）
 */

import { randomUUID } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 生成 UUID v4
 */
export function generateUuid(): string {
  return randomUUID();
}

/**
 * 校验 UUID v4 格式
 */
export function isUuidV4(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}
