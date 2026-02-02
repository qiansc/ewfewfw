/**
 * LiteAdapter 搜索操作
 */

import type { SQLQueryBindings } from 'bun:sqlite';
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
  const offset = params.offset ?? 0;
  const vectorStore = ctx.store.getVectorStore();
  const ftsEnabled = ctx.store.isFtsEnabled();

  // 检查向量搜索是否可用
  const vectorEnabled =
    ctx.config.enableVectorSearch && ctx.store.isVectorSearchEnabled() && vectorStore !== null;

  // 尝试使用向量搜索
  if (vectorEnabled && vectorStore) {
    try {
      const vectorResults = await vectorSearch(db, vectorStore, params, proposalId, limit, offset);
      if (vectorResults.items.length > 0) {
        return {
          items: vectorResults.items,
          degraded: false,
          search_mode: 'vector',
          total: vectorResults.total,
          has_more: vectorResults.has_more,
        };
      }
      // 向量搜索无结果，降级到文本搜索
      if (ftsEnabled) {
        const ftsResults = safeFtsSearch(db, params, proposalId, limit, offset);
        if (!ftsResults) {
          const likeResults = likeSearch(db, params, proposalId, limit, offset);
          return {
            items: likeResults.items,
            degraded: true,
            degraded_reason: 'FULLTEXT_SEARCH_UNAVAILABLE',
            degraded_message: '向量搜索无结果且 FTS5 不可用，已降级到 LIKE 模糊匹配',
            search_mode: 'like',
            total: likeResults.total,
            has_more: likeResults.has_more,
          };
        }
        return {
          items: ftsResults.items,
          degraded: true,
          degraded_reason: 'NO_VECTOR_RESULTS',
          degraded_message: '向量搜索无结果，已降级到全文搜索',
          search_mode: 'fulltext',
          total: ftsResults.total,
          has_more: ftsResults.has_more,
        };
      }
      const likeResults = likeSearch(db, params, proposalId, limit, offset);
      return {
        items: likeResults.items,
        degraded: true,
        degraded_reason: 'FULLTEXT_SEARCH_UNAVAILABLE',
        degraded_message: '向量搜索无结果且 FTS5 不可用，已降级到 LIKE 模糊匹配',
        search_mode: 'like',
        total: likeResults.total,
        has_more: likeResults.has_more,
      };
    } catch {
      // 向量搜索失败，降级到全文搜索/LIKE
      if (ftsEnabled) {
        const ftsResults = safeFtsSearch(db, params, proposalId, limit, offset);
        if (!ftsResults) {
          const likeResults = likeSearch(db, params, proposalId, limit, offset);
          return {
            items: likeResults.items,
            degraded: true,
            degraded_reason: 'FULLTEXT_SEARCH_UNAVAILABLE',
            degraded_message: 'USearch 和 FTS5 均不可用，已降级到 LIKE 模糊匹配',
            search_mode: 'like',
            total: likeResults.total,
            has_more: likeResults.has_more,
          };
        }
        return {
          items: ftsResults.items,
          degraded: true,
          degraded_reason: 'VECTOR_SEARCH_FAILED',
          degraded_message: '向量搜索执行失败，已降级到全文搜索',
          search_mode: 'fulltext',
          total: ftsResults.total,
          has_more: ftsResults.has_more,
        };
      }
      const likeResults = likeSearch(db, params, proposalId, limit, offset);
      return {
        items: likeResults.items,
        degraded: true,
        degraded_reason: 'FULLTEXT_SEARCH_UNAVAILABLE',
        degraded_message: 'USearch 和 FTS5 均不可用，已降级到 LIKE 模糊匹配',
        search_mode: 'like',
        total: likeResults.total,
        has_more: likeResults.has_more,
      };
    }
  }

  // USearch 不可用，使用全文搜索/LIKE
  const shouldHaveVector = ctx.config.enableVectorSearch;
  if (ftsEnabled) {
    const ftsResults = safeFtsSearch(db, params, proposalId, limit, offset);
    if (!ftsResults) {
      const likeResults = likeSearch(db, params, proposalId, limit, offset);
      return {
        items: likeResults.items,
        degraded: true,
        degraded_reason: 'FULLTEXT_SEARCH_UNAVAILABLE',
        degraded_message: 'USearch 和 FTS5 均不可用，已降级到 LIKE 模糊匹配',
        search_mode: 'like',
        total: likeResults.total,
        has_more: likeResults.has_more,
      };
    }
    return {
      items: ftsResults.items,
      degraded: shouldHaveVector,
      degraded_reason: shouldHaveVector ? 'VECTOR_SEARCH_UNAVAILABLE' : undefined,
      degraded_message: shouldHaveVector ? 'USearch 不可用，使用全文搜索替代' : undefined,
      search_mode: 'fulltext',
      total: ftsResults.total,
      has_more: ftsResults.has_more,
    };
  }
  const likeResults = likeSearch(db, params, proposalId, limit, offset);
  return {
    items: likeResults.items,
    degraded: true,
    degraded_reason: 'FULLTEXT_SEARCH_UNAVAILABLE',
    degraded_message: 'USearch 和 FTS5 均不可用，已降级到 LIKE 模糊匹配',
    search_mode: 'like',
    total: likeResults.total,
    has_more: likeResults.has_more,
  };
}

// ============================================================
// 内部辅助函数
// ============================================================

type TextSearchResult = {
  items: SearchResultItem[];
  total: number;
  has_more: boolean;
};

/**
 * 向量语义搜索
 */
async function vectorSearch(
  db: ReturnType<SQLiteStore['getDatabase']>,
  vectorStore: NonNullable<ReturnType<SQLiteStore['getVectorStore']>>,
  params: SearchParams,
  proposalId: string | null,
  limit: number,
  offset: number
): Promise<TextSearchResult> {
  const searchLimit = limit + offset + 1;
  const results = await semanticSearch(db, vectorStore, params.query, proposalId, searchLimit);
  const hasMore = results.length > offset + limit;
  const sliced = results.slice(offset, offset + limit);

  const items = sliced.map((row) => {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    return {
      id: row.id,
      type: row.type as EntityType,
      score: 1 - row.distance, // 距离转换为相似度分数
      snippet: extractSnippet(data, params.query),
      metadata: {
        source_project: row.source_project,
      },
    };
  });

  const total = offset + items.length + (hasMore ? 1 : 0);

  return {
    items,
    total,
    has_more: hasMore,
  };
}

/**
 * 全文搜索（FTS5 降级方案）
 */
function ftsSearch(
  db: ReturnType<SQLiteStore['getDatabase']>,
  params: SearchParams,
  proposalId: string | null,
  limit: number,
  offset: number
): TextSearchResult {
  const dbProposalId = proposalId ?? '';
  const conditions: string[] = [];
  const values: SQLQueryBindings[] = [];

  conditions.push("(e.proposal_id = ? OR e.proposal_id IS NULL OR e.proposal_id = '')");
  values.push(dbProposalId);
  conditions.push("m.status NOT IN ('archived', 'deprecated')");
  conditions.push('entities_fts MATCH ?');
  values.push(params.query);

  if (params.scope && params.scope !== 'all') {
    conditions.push('e.type = ?');
    values.push(params.scope);
  }

  const whereClause = conditions.join(' AND ');

  const results = db.prepare(`
    WITH ranked AS (
      SELECT
        e.id,
        e.source_project,
        e.proposal_id,
        e.type,
        e.data,
        m.status,
        m.updated_at,
        m.content_hash,
        bm25(entities_fts) AS fts_rank,
        ROW_NUMBER() OVER (
          PARTITION BY e.source_project, e.id
          ORDER BY
            CASE
              WHEN e.proposal_id = ? THEN 1
              WHEN e.proposal_id IS NULL OR e.proposal_id = '' THEN 2
              ELSE 3
            END
        ) AS rn
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id = m.proposal_id
      JOIN entities_fts ON e.id = entities_fts.entity_id
        AND e.source_project = entities_fts.source_project
        AND e.proposal_id = entities_fts.proposal_id
      WHERE ${whereClause}
    )
    SELECT id, source_project, proposal_id, type, data, status, updated_at, content_hash, fts_rank
    FROM ranked
    WHERE rn = 1
    ORDER BY fts_rank
    LIMIT ? OFFSET ?
  `).all(dbProposalId, ...values, limit, offset) as Array<{
    id: string;
    type: EntityType;
    data: string;
    status: EntityStatus;
    updated_at: string;
    content_hash: string;
    source_project: string;
    fts_rank: number;
  }>;

  const total = countFtsMatches(db, params, proposalId);
  const items = results.map((row) => {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    const rank = Number(row.fts_rank ?? 0);
    const score = rank <= 0 ? 1 : 1 / (1 + rank);
    return {
      id: row.id,
      type: row.type,
      score,
      snippet: extractSnippet(data, params.query),
      metadata: {
        status: row.status,
        updated_at: row.updated_at,
        content_hash: row.content_hash,
        source_project: row.source_project,
      },
    };
  });

  return {
    items,
    total,
    has_more: offset + items.length < total,
  };
}

function safeFtsSearch(
  db: ReturnType<SQLiteStore['getDatabase']>,
  params: SearchParams,
  proposalId: string | null,
  limit: number,
  offset: number
): TextSearchResult | null {
  try {
    return ftsSearch(db, params, proposalId, limit, offset);
  } catch {
    try {
      return ftsSearchFallback(db, params, proposalId, limit, offset);
    } catch {
      return null;
    }
  }
}

function ftsSearchFallback(
  db: ReturnType<SQLiteStore['getDatabase']>,
  params: SearchParams,
  proposalId: string | null,
  limit: number,
  offset: number
): TextSearchResult {
  const dbProposalId = proposalId ?? '';
  const conditions: string[] = [];
  const values: SQLQueryBindings[] = [];

  conditions.push("(e.proposal_id = ? OR e.proposal_id IS NULL OR e.proposal_id = '')");
  values.push(dbProposalId);
  conditions.push("m.status NOT IN ('archived', 'deprecated')");
  conditions.push('entities_fts MATCH ?');
  values.push(params.query);

  if (params.scope && params.scope !== 'all') {
    conditions.push('e.type = ?');
    values.push(params.scope);
  }

  const whereClause = conditions.join(' AND ');

  const results = db.prepare(`
    WITH ranked AS (
      SELECT
        e.id,
        e.source_project,
        e.proposal_id,
        e.type,
        e.data,
        m.status,
        m.updated_at,
        m.content_hash,
        0.0 AS fts_rank,
        ROW_NUMBER() OVER (
          PARTITION BY e.source_project, e.id
          ORDER BY
            CASE
              WHEN e.proposal_id = ? THEN 1
              WHEN e.proposal_id IS NULL OR e.proposal_id = '' THEN 2
              ELSE 3
            END
        ) AS rn
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id = m.proposal_id
      JOIN entities_fts ON e.id = entities_fts.entity_id
        AND e.source_project = entities_fts.source_project
        AND e.proposal_id = entities_fts.proposal_id
      WHERE ${whereClause}
    )
    SELECT id, source_project, proposal_id, type, data, status, updated_at, content_hash, fts_rank
    FROM ranked
    WHERE rn = 1
    ORDER BY id
    LIMIT ? OFFSET ?
  `).all(dbProposalId, ...values, limit, offset) as Array<{
    id: string;
    type: EntityType;
    data: string;
    status: EntityStatus;
    updated_at: string;
    content_hash: string;
    source_project: string;
    fts_rank: number;
  }>;

  const total = countFtsMatches(db, params, proposalId);
  const items = results.map((row) => {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    return {
      id: row.id,
      type: row.type,
      score: 1,
      snippet: extractSnippet(data, params.query),
      metadata: {
        status: row.status,
        updated_at: row.updated_at,
        content_hash: row.content_hash,
        source_project: row.source_project,
      },
    };
  });

  return {
    items,
    total,
    has_more: offset + items.length < total,
  };
}

/**
 * 文本搜索（LIKE 降级方案）
 */
function likeSearch(
  db: ReturnType<SQLiteStore['getDatabase']>,
  params: SearchParams,
  proposalId: string | null,
  limit: number,
  offset: number
): TextSearchResult {
  const conditions: string[] = [];
  const values: SQLQueryBindings[] = [];

  // 基于 LIKE 的简单搜索
  conditions.push("(e.data LIKE ? OR e.id LIKE ?)");
  values.push(`%${params.query}%`, `%${params.query}%`);

  // proposal_id 过滤
  if (proposalId) {
    conditions.push('(e.proposal_id = ? OR e.proposal_id IS NULL OR e.proposal_id = \'\')');
    values.push(proposalId);
  } else {
    conditions.push('(e.proposal_id IS NULL OR e.proposal_id = \'\')');
  }

  // scope 过滤
  if (params.scope && params.scope !== 'all') {
    conditions.push('e.type = ?');
    values.push(params.scope);
  }

  conditions.push("m.status NOT IN ('archived', 'deprecated')");

  const whereClause = conditions.join(' AND ');

  const results = db.prepare(`
    WITH ranked AS (
      SELECT
        e.id,
        e.source_project,
        e.proposal_id,
        e.type,
        e.data,
        m.status,
        m.updated_at,
        m.content_hash,
        ROW_NUMBER() OVER (
          PARTITION BY e.source_project, e.id
          ORDER BY
            CASE
              WHEN e.proposal_id = ? THEN 1
              WHEN e.proposal_id IS NULL OR e.proposal_id = '' THEN 2
              ELSE 3
            END
        ) AS rn
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id = m.proposal_id
      WHERE ${whereClause}
    )
    SELECT id, source_project, proposal_id, type, data, status, updated_at, content_hash
    FROM ranked
    WHERE rn = 1
    ORDER BY id
    LIMIT ? OFFSET ?
  `).all(...values, proposalId ?? '', limit, offset) as Array<{
    id: string;
    type: EntityType;
    data: string;
    status: EntityStatus;
    updated_at: string;
    content_hash: string;
    source_project: string;
  }>;

  const total = countLikeMatches(db, params, proposalId);
  const items = results.map((row, index) => {
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

  return {
    items,
    total,
    has_more: offset + items.length < total,
  };
}

function countFtsMatches(
  db: ReturnType<SQLiteStore['getDatabase']>,
  params: SearchParams,
  proposalId: string | null
): number {
  const dbProposalId = proposalId ?? '';
  const conditions: string[] = [];
  const values: SQLQueryBindings[] = [];

  conditions.push("(e.proposal_id = ? OR e.proposal_id IS NULL OR e.proposal_id = '')");
  values.push(dbProposalId);
  conditions.push("m.status NOT IN ('archived', 'deprecated')");
  conditions.push('entities_fts MATCH ?');
  values.push(params.query);

  if (params.scope && params.scope !== 'all') {
    conditions.push('e.type = ?');
    values.push(params.scope);
  }

  const whereClause = conditions.join(' AND ');

  const row = db
    .prepare(
      `
      WITH ranked AS (
        SELECT
          e.id,
          e.source_project,
          e.proposal_id,
          ROW_NUMBER() OVER (
            PARTITION BY e.source_project, e.id
            ORDER BY
              CASE
                WHEN e.proposal_id = ? THEN 1
                WHEN e.proposal_id IS NULL OR e.proposal_id = '' THEN 2
                ELSE 3
              END
          ) AS rn
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id = m.proposal_id
        JOIN entities_fts ON e.id = entities_fts.entity_id
          AND e.source_project = entities_fts.source_project
          AND e.proposal_id = entities_fts.proposal_id
        WHERE ${whereClause}
      )
      SELECT COUNT(*) AS total FROM ranked WHERE rn = 1
    `
    )
    .get(dbProposalId, ...values) as { total?: number } | undefined;

  return Number(row?.total ?? 0);
}

function countLikeMatches(
  db: ReturnType<SQLiteStore['getDatabase']>,
  params: SearchParams,
  proposalId: string | null
): number {
  const conditions: string[] = [];
  const values: SQLQueryBindings[] = [];

  conditions.push("(e.data LIKE ? OR e.id LIKE ?)");
  values.push(`%${params.query}%`, `%${params.query}%`);

  if (proposalId) {
    conditions.push('(e.proposal_id = ? OR e.proposal_id IS NULL OR e.proposal_id = \'\')');
    values.push(proposalId);
  } else {
    conditions.push('(e.proposal_id IS NULL OR e.proposal_id = \'\')');
  }

  if (params.scope && params.scope !== 'all') {
    conditions.push('e.type = ?');
    values.push(params.scope);
  }

  conditions.push("m.status NOT IN ('archived', 'deprecated')");

  const whereClause = conditions.join(' AND ');

  const row = db
    .prepare(
      `
      WITH ranked AS (
        SELECT
          e.id,
          e.source_project,
          e.proposal_id,
          ROW_NUMBER() OVER (
            PARTITION BY e.source_project, e.id
            ORDER BY
              CASE
                WHEN e.proposal_id = ? THEN 1
                WHEN e.proposal_id IS NULL OR e.proposal_id = '' THEN 2
                ELSE 3
              END
          ) AS rn
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id = m.proposal_id
        WHERE ${whereClause}
      )
      SELECT COUNT(*) AS total FROM ranked WHERE rn = 1
    `
    )
    .get(proposalId ?? '', ...values) as { total?: number } | undefined;

  return Number(row?.total ?? 0);
}
