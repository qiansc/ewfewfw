/**
 * LiteAdapter 辅助方法
 */

import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import type { SQLiteStore } from '../sqlite-store.js';
import type { InMemoryGraph } from '../in-memory-graph.js';
import type { EntityType, EntityStatus, Entity } from '../adapter.js';
import type { EntityRow } from './types.js';
import { computeContentHash } from '../utils/contentHash.js';

// ============================================================
// 内容解析与格式化
// ============================================================

/**
 * 解析内容字符串
 */
export function parseContent(content: string, format: 'yaml' | 'json'): Record<string, unknown> {
  if (format === 'json') {
    return JSON.parse(content);
  }
  // YAML 解析
  return YAML.parse(content) as Record<string, unknown>;
}

/**
 * 格式化内容为字符串
 */
export function formatContent(data: Record<string, unknown>, format: 'yaml' | 'json'): string {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }
  // YAML 格式化
  return YAML.stringify(data, { indent: 2 });
}

// ============================================================
// 哈希计算
// ============================================================

/**
 * 计算内容哈希
 */
export function computeHash(data: Record<string, unknown>): string {
  return computeContentHash(data);
}

// ============================================================
// requirement_id 参数规范化
// ============================================================

/**
 * 规范化 requirement_id 参数（单值）
 */
export function normalizeRequirementId(
  requirementId: string | string[] | null | undefined
): string | null {
  if (Array.isArray(requirementId)) {
    return requirementId[0] || null;
  }
  return requirementId ?? null;
}

/**
 * 规范化 requirement_id 参数（保留数组形式）
 */
export function normalizeRequirementIdForQuery(
  requirementId: string | string[] | null | undefined
): string[] | null {
  if (requirementId === null || requirementId === undefined) {
    return null;
  }
  if (Array.isArray(requirementId)) {
    return requirementId.length > 0 ? requirementId : null;
  }
  return [requirementId];
}

/**
 * 将数据库行转换为 Entity 对象
 */
export function rowToEntity(row: EntityRow, versions: string[] = []): Entity {
  return {
    uuid: row.uuid,
    id: row.id,
    root_id: row.root_id,
    type: row.type as EntityType,
    kind: row.kind || undefined,
    scope: row.scope || undefined,
    perspective: row.perspective || undefined,
    data: JSON.parse(row.data),
    requirement_id: row.requirement_id || undefined,
    component_id: row.component_id || undefined,
    versions,
    metadata: {
      source_repo: row.source_repo || undefined,
      external_url: row.external_url ?? undefined,
      status: row.status as EntityStatus,
      content_hash: row.content_hash ?? undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by || undefined,
      updated_by: row.updated_by || undefined,
    },
  };
}

// ============================================================
// 搜索辅助
// ============================================================

/**
 * 从数据中提取搜索片段
 */
export function extractSnippet(data: Record<string, unknown>, query: string): string {
  const text = [
    data.name,
    data.description,
    data.title,
  ].filter(Boolean).join(' ');

  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);

  if (idx === -1) {
    return text.slice(0, 100);
  }

  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + query.length + 30);
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
}

/**
 * 生成搜索文本（用于向量化）
 */
export function generateSearchText(data: Record<string, unknown>): string {
  const parts = [
    data.name,
    data.description,
    data.title,
    Array.isArray(data.tags) ? data.tags.join(' ') : null,
  ].filter(Boolean);

  return parts.join(' ');
}
