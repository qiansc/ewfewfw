/**
 * LiteAdapter ReadHistory 操作
 */

import type { SQLQueryBindings } from 'bun:sqlite';
import type { ReadHistoryParams, ReadHistoryResult, HistoryItem } from '../adapter.js';
import type { AdapterContext } from './types.js';

// ============================================================
// ReadHistory 操作
// ============================================================

/**
 * 读取实体变更历史
 * 设计文档: store-utils.md §3.11
 */
export async function readHistory(
  ctx: AdapterContext,
  params: ReadHistoryParams
): Promise<ReadHistoryResult> {
  const db = ctx.store.getDatabase();
  const limit = params.limit ?? 100;
  const order = params.order ?? 'desc';

  const conditions: string[] = [];
  const values: SQLQueryBindings[] = [];

  if (params.entity_id) {
    conditions.push('entity_id = ?');
    values.push(params.entity_id);
  }

  if (params.feat_id) {
    // 兼容旧参数：当前 entity_history 不记录 feat_id
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderClause = `ORDER BY changed_at ${order.toUpperCase()}`;

  const rows = db.prepare(`
    SELECT entity_id, action, changed_fields, changed_by, changed_at
    FROM entity_history
    ${whereClause}
    ${orderClause}
    LIMIT ?
  `).all(...values, limit) as Array<{
    entity_id: string;
    feat_id: string | null;
    action: string;
    changed_fields: string | null;
    changed_by: string | null;
    changed_at: string;
  }>;

  const items: HistoryItem[] = rows.map(row => ({
    entity_id: row.entity_id,
    feat_id: null,
    action: normalizeAction(row.action),
    changed_fields: row.changed_fields ? JSON.parse(row.changed_fields) : undefined,
    changed_by: row.changed_by ?? undefined,
    changed_at: row.changed_at,
  }));

  // 获取总数
  const countResult = db.prepare(`
    SELECT COUNT(*) as total FROM entity_history ${whereClause}
  `).get(...values) as { total: number };

  return {
    success: true,
    items,
    total: countResult.total,
  };
}

function normalizeAction(action: string): HistoryItem['action'] {
  if (action === 'create' || action === 'update' || action === 'delete' || action === 'archive') {
    return action;
  }
  return 'update';
}
