/**
 * C4A 哈希工具
 *
 * 用于计算实体内容哈希，支持冲突检测和变更追踪
 */

import { createHash } from 'node:crypto';
import { computeContentHash, normalizeForHash } from './contentHash.js';

/**
 * 计算内容的 SHA-256 哈希值
 */
export function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export { normalizeForHash, computeContentHash };

/**
 * 比较两个实体的内容是否相同
 */
export function isContentEqual(
  entity1: Record<string, unknown>,
  entity2: Record<string, unknown>,
): boolean {
  return computeContentHash(entity1) === computeContentHash(entity2);
}

/**
 * 计算字符串的短哈希（用于显示）
 */
export function shortHash(content: string, length: number = 8): string {
  return computeHash(content).substring(0, length);
}
