/**
 * C4A 哈希工具
 *
 * 用于计算实体内容哈希，支持冲突检测和变更追踪
 */

import { createHash } from 'node:crypto';

/**
 * 计算内容的 SHA-256 哈希值
 */
export function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * 规范化对象用于哈希计算
 * - 移除不参与哈希的字段（如时间戳、哈希本身）
 * - 对键进行排序以保证一致性
 * - 处理 undefined 值
 */
export function normalizeForHash(obj: Record<string, unknown>): Record<string, unknown> {
  // 不参与哈希计算的字段
  const excludeFields = new Set([
    'created_at',
    'updated_at',
    'content_hash',
    'uuid',
    'root_id',
    'versions',
    'requirement_id',
    '_id',
    '__v',
  ]);

  const normalize = (value: unknown): unknown => {
    if (value === null || value === undefined) {
      return null;
    }

    if (Array.isArray(value)) {
      return value.map(normalize);
    }

    if (typeof value === 'object' && value !== null) {
      const sorted: Record<string, unknown> = {};
      const keys = Object.keys(value as Record<string, unknown>).sort();

      for (const key of keys) {
        if (!excludeFields.has(key)) {
          const v = (value as Record<string, unknown>)[key];
          if (v !== undefined) {
            sorted[key] = normalize(v);
          }
        }
      }
      return sorted;
    }

    return value;
  };

  return normalize(obj) as Record<string, unknown>;
}

/**
 * 计算实体内容哈希
 * 用于同步时的冲突检测
 */
export function computeContentHash(entity: Record<string, unknown>): string {
  const normalized = normalizeForHash(entity);
  const json = JSON.stringify(normalized);
  return computeHash(json);
}

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
