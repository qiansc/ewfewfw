/**
 * LiteAdapter 搜索操作 (v0.3.1)
 */

import type { SQLQueryBindings } from 'bun:sqlite';
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

export async function search(ctx: AdapterContext, params: SearchParams): Promise<SearchResult> {
  const db = ctx.store.getDatabase();
  const limit = params.limit || 10;
  const offset = params.offset ?? 0;
  const vectorStore = ctx.store.getVectorStore();
  const ftsEnabled = ctx.store.isFtsEnabled();

  const vectorEnabled =
    ctx.config.enableVectorSearch && ctx.store.isVectorSearchEnabled() && vectorStore !== null;

  if (vectorEnabled && vectorStore) {
    try {
      const vectorResults = await vectorSearch(ctx, params, limit, offset);
      if (vectorResults.items.length > 0) {
        return {
          items: vectorResults.items,
          degraded: false,
          search_mode: 'vector',
          total: vectorResults.total,
          has_more: vectorResults.has_more,
        };
      }
    } catch {
      // fallthrough to text search
    }
  }

  if (ftsEnabled) {
    const ftsResults = safeFtsSearch(db, params, limit, offset);
    if (ftsResults) {
      return {
        items: ftsResults.items,
        degraded: vectorEnabled,
        degraded_reason: vectorEnabled ? 'NO_VECTOR_RESULTS' : undefined,
        degraded_message: vectorEnabled ? '向量搜索无结果，已降级到全文搜索' : undefined,
        search_mode: 'fulltext',
        total: ftsResults.total,
        has_more: ftsResults.has_more,
      };
    }
  }

  const likeResults = likeSearch(db, params, limit, offset);
  return {
    items: likeResults.items,
    degraded: true,
    degraded_reason: 'FULLTEXT_SEARCH_UNAVAILABLE',
    degraded_message: '向量搜索不可用或无结果，已降级到 LIKE 模糊匹配',
    search_mode: 'like',
    total: likeResults.total,
    has_more: likeResults.has_more,
  };
}

async function vectorSearch(
  ctx: AdapterContext,
  params: SearchParams,
  limit: number,
  offset: number
): Promise<{ items: SearchResultItem[]; total: number; has_more: boolean }> {
  const db = ctx.store.getDatabase();
  const vectorStore = ctx.store.getVectorStore();
  if (!vectorStore) {
    return { items: [], total: 0, has_more: false };
  }

  const rootId = params.root_id ?? (params as { root_id?: string | null }).root_id;
  const results = await semanticSearch(
    db,
    vectorStore,
    params.query,
    { rootId: rootId ?? undefined, versions: params.versions },
    limit + offset
  );

  const sliced = results.slice(offset, offset + limit);
  const items = sliced.map((item) => {
    const meta = db
      .prepare(
        `SELECT status, updated_at, created_at, source_repo, external_url FROM metadata WHERE entity_uuid = ?`
      )
      .get(item.uuid) as
      | {
          status: string;
          updated_at: string;
          created_at: string;
          source_repo: string | null;
          external_url: string | null;
        }
      | undefined;
    return {
      id: item.id,
      type: item.type as EntityType,
      score: 1 - item.distance,
      snippet: extractSnippet(JSON.parse(item.data), params.query),
      metadata: {
        status: (meta?.status ?? 'published') as EntityStatus,
        updated_at: meta?.updated_at,
        created_at: meta?.created_at,
        source_repo: meta?.source_repo ?? undefined,
        external_url: meta?.external_url ?? undefined,
      },
    };
  });

  return {
    items,
    total: results.length,
    has_more: results.length > offset + limit,
  };
}

function safeFtsSearch(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  params: SearchParams,
  limit: number,
  offset: number
): { items: SearchResultItem[]; total: number; has_more: boolean } | null {
  try {
    return ftsSearch(db, params, limit, offset);
  } catch {
    return null;
  }
}

function ftsSearch(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  params: SearchParams,
  limit: number,
  offset: number
): { items: SearchResultItem[]; total: number; has_more: boolean } {
  const { whereClause, joinClause, joinBindings, whereBindings } = buildFilter(params);

  const query = `
    SELECT e.uuid, e.id, e.root_id, e.type, e.data,
           m.status, m.updated_at, m.created_at, m.source_repo, m.external_url,
           bm25(entities_fts) as score
    FROM entities_fts
    JOIN entities e ON e.uuid = entities_fts.entity_uuid
    JOIN metadata m ON m.entity_uuid = e.uuid
    ${joinClause}
    WHERE entities_fts.search_text MATCH ?
    ${whereClause}
    ORDER BY score ASC
    LIMIT ? OFFSET ?
  `;

  const rows = db
    .prepare(query)
    .all(...joinBindings, params.query, ...whereBindings, limit, offset) as Array<{
    uuid: string;
    id: string;
    root_id: string;
    type: string;
    data: string;
    status: string;
    updated_at: string;
    created_at: string;
    source_repo: string | null;
    external_url: string | null;
    score: number;
  }>;

  const items = rows.map((row) => ({
    id: row.id,
    type: row.type as EntityType,
    score: row.score,
    snippet: extractSnippet(JSON.parse(row.data), params.query),
    metadata: {
      status: row.status as EntityStatus,
      updated_at: row.updated_at,
      created_at: row.created_at,
      source_repo: row.source_repo ?? undefined,
      external_url: row.external_url ?? undefined,
    },
  }));

  return {
    items,
    total: rows.length,
    has_more: rows.length >= limit,
  };
}

function likeSearch(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  params: SearchParams,
  limit: number,
  offset: number
): { items: SearchResultItem[]; total: number; has_more: boolean } {
  const { whereClause, joinClause, joinBindings, whereBindings } = buildFilter(params);
  const query = `
    SELECT e.uuid, e.id, e.root_id, e.type, e.data,
           m.status, m.updated_at, m.created_at, m.source_repo, m.external_url
    FROM entities e
    JOIN metadata m ON m.entity_uuid = e.uuid
    ${joinClause}
    WHERE e.data LIKE ?
    ${whereClause}
    LIMIT ? OFFSET ?
  `;

  const rows = db
    .prepare(query)
    .all(...joinBindings, `%${params.query}%`, ...whereBindings, limit, offset) as Array<{
    uuid: string;
    id: string;
    root_id: string;
    type: string;
    data: string;
    status: string;
    updated_at: string;
    created_at: string;
    source_repo: string | null;
    external_url: string | null;
  }>;

  const items = rows.map((row) => ({
    id: row.id,
    type: row.type as EntityType,
    score: 0,
    snippet: extractSnippet(JSON.parse(row.data), params.query),
    metadata: {
      status: row.status as EntityStatus,
      updated_at: row.updated_at,
      created_at: row.created_at,
      source_repo: row.source_repo ?? undefined,
      external_url: row.external_url ?? undefined,
    },
  }));

  return {
    items,
    total: rows.length,
    has_more: rows.length >= limit,
  };
}

function buildFilter(params: SearchParams): {
  whereClause: string;
  joinClause: string;
  joinBindings: SQLQueryBindings[];
  whereBindings: SQLQueryBindings[];
} {
  const where: string[] = [];
  const whereBindings: SQLQueryBindings[] = [];
  const joinBindings: SQLQueryBindings[] = [];
  let joinClause = '';

  const rootId = params.root_id ?? (params as { root_id?: string | null }).root_id;
  if (rootId !== undefined) {
    where.push('e.root_id = ?');
    whereBindings.push(rootId);
  }

  if (params.scope && params.scope !== 'all') {
    where.push('e.type = ?');
    whereBindings.push(params.scope);
  }

  if (params.versions && params.versions.length > 0) {
    const placeholders = params.versions.map(() => '?').join(', ');
    joinClause = `JOIN entity_versions v ON v.entity_uuid = e.uuid AND v.version IN (${placeholders})`;
    joinBindings.push(...params.versions);
  }

  const whereClause = where.length > 0 ? `AND ${where.join(' AND ')}` : '';
  return { whereClause, joinClause, joinBindings, whereBindings };
}
