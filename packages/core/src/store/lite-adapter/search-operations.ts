/**
 * LiteAdapter 搜索操作
 */

import type { SQLiteStore } from '../sqlite-store.js';
import { semanticSearch } from '../vector-search.js';
import type {
  EntityType,
  EntityStatus,
  SearchParams,
  SearchResult,
  SearchResultItem,
} from '../adapter.js';
import type { AdapterContext } from './types.js';
import { extractSnippet } from './helpers.js';

// ============================================================
// Search 操作
// ============================================================

/**
 * 搜索实体
 */
export async function search(ctx: AdapterContext, params: SearchParams): Promise<SearchResult> {
  const db = ctx.store.getDatabase();
  const proposalId = params.proposal_id ?? null;
  const limit = params.limit || 10;

  // 检查向量搜索是否可用
  const vectorEnabled = ctx.config.enableVectorSearch && ctx.store.isVectorSearchEnabled();

  // 尝试使用向量搜索
  if (vectorEnabled) {
    try {
      const vectorResults = await vectorSearch(db, params.query, proposalId, limit);
      if (vectorResults.length > 0) {
        return {
          items: vectorResults,
          degraded: false,
          search_mode: 'vector',
        };
      }
      // 向量搜索无结果，降级到文本搜索
      const textResults = textSearch(db, params, proposalId, limit);
      return {
        items: textResults,
        degraded: true,
        degraded_reason: 'NO_VECTOR_RESULTS',
        degraded_message: '向量搜索无结果，已降级到全文搜索',
        search_mode: 'fulltext',
      };
    } catch {
      // 向量搜索失败，降级到文本搜索
      const textResults = textSearch(db, params, proposalId, limit);
      return {
        items: textResults,
        degraded: true,
        degraded_reason: 'VECTOR_SEARCH_FAILED',
        degraded_message: '向量搜索执行失败，已降级到全文搜索',
        search_mode: 'fulltext',
      };
    }
  }

  // sqlite-vec 不可用，使用文本搜索
  const textResults = textSearch(db, params, proposalId, limit);
  const shouldHaveVector = ctx.config.enableVectorSearch;
  return {
    items: textResults,
    degraded: shouldHaveVector,
    degraded_reason: shouldHaveVector ? 'VECTOR_SEARCH_UNAVAILABLE' : undefined,
    degraded_message: shouldHaveVector ? 'sqlite-vec 不可用，使用全文搜索替代' : undefined,
    search_mode: 'fulltext',
  };
}

// ============================================================
// 内部辅助函数
// ============================================================

/**
 * 向量语义搜索
 */
async function vectorSearch(
  db: ReturnType<SQLiteStore['getDatabase']>,
  query: string,
  proposalId: string | null,
  limit: number
): Promise<SearchResultItem[]> {
  const results = await semanticSearch(db, query, proposalId, limit);

  return results.map((row) => {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    return {
      id: row.id,
      type: row.type as EntityType,
      score: 1 - row.distance, // 距离转换为相似度分数
      snippet: extractSnippet(data, query),
      metadata: {
        source_project: row.source_project,
      },
    };
  });
}

/**
 * 文本搜索（降级方案）
 */
function textSearch(
  db: ReturnType<SQLiteStore['getDatabase']>,
  params: SearchParams,
  proposalId: string | null,
  limit: number
): SearchResultItem[] {
  const conditions: string[] = [];
  const values: unknown[] = [];

  // 基于 LIKE 的简单搜索
  conditions.push("(e.data LIKE ? OR e.id LIKE ?)");
  values.push(`%${params.query}%`, `%${params.query}%`);

  // proposal_id 过滤
  if (proposalId) {
    conditions.push('(e.proposal_id = ? OR e.proposal_id IS NULL)');
    values.push(proposalId);
  } else {
    conditions.push('e.proposal_id IS NULL');
  }

  // scope 过滤
  if (params.scope && params.scope !== 'all') {
    conditions.push('e.type = ?');
    values.push(params.scope);
  }

  const whereClause = conditions.join(' AND ');

  const results = db.prepare(`
    SELECT e.id, e.type, e.data, m.status, m.updated_at, m.content_hash, m.source_project
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE ${whereClause}
    LIMIT ?
  `).all(...values, limit) as Array<{
    id: string;
    type: EntityType;
    data: string;
    status: EntityStatus;
    updated_at: string;
    content_hash: string;
    source_project: string;
  }>;

  return results.map((row, index) => {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    return {
      id: row.id,
      type: row.type,
      score: 1 - index * 0.1, // 简单的排名分数
      snippet: extractSnippet(data, params.query),
      metadata: {
        status: row.status,
        updated_at: row.updated_at,
        content_hash: row.content_hash,
        source_project: row.source_project,
      },
    };
  });
}
