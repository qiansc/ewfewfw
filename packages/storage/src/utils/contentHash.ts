/**
 * 内容哈希（用于同步/冲突检测）
 */

import { createHash } from 'node:crypto';

const EXCLUDE_FIELDS = new Set([
  'created_at',
  'updated_at',
  'content_hash',
  'proposal_id',
  '_id',
  '__v',
]);

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (EXCLUDE_FIELDS.has(key)) continue;
      const next = record[key];
      if (next !== undefined) {
        normalized[key] = normalizeValue(next);
      }
    }
    return normalized;
  }
  return value;
}

export function computeContentHash(data: Record<string, unknown>): string {
  const normalized = normalizeValue(data);
  const content = JSON.stringify(normalized);
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
