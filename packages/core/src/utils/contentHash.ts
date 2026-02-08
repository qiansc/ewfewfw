/**
 * 内容哈希（用于同步/冲突检测）
 */

import { createHash } from 'node:crypto';

const EXCLUDE_FIELDS = new Set([
  'created_at',
  'updated_at',
  'content_hash',
  'requirement_id',
  '_id',
  '__v',
]);

export function normalizeForHash(value: Record<string, unknown>): Record<string, unknown> {
  const normalize = (input: unknown): unknown => {
    if (input === null || input === undefined) {
      return undefined;
    }
    if (Array.isArray(input)) {
      return input.map((item) => {
        const normalized = normalize(item);
        return normalized === undefined ? null : normalized;
      });
    }
    if (input && typeof input === 'object') {
      const record = input as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) {
        if (EXCLUDE_FIELDS.has(key)) continue;
        const next = normalize(record[key]);
        if (next !== undefined) {
          normalized[key] = next;
        }
      }
      return normalized;
    }
    return input;
  };

  return normalize(value) as Record<string, unknown>;
}

export function computeContentHash(data: Record<string, unknown>): string {
  const normalized = normalizeForHash(data);
  const content = JSON.stringify(normalized);
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
