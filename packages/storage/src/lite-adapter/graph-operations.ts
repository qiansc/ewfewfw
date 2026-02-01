/**
 * LiteAdapter 图查询操作
 */

import type { SQLiteStore } from '../sqlite-store.js';
import type { InMemoryGraph } from '../in-memory-graph.js';
import type { GraphQueryCache } from '../graph-query-cache.js';
import type {
  EntityType,
  DepsParams,
  DepsNode,
  DepsResult,
  ImpactParams,
  ImpactNode,
  ImpactResult,
} from '../adapter.js';
import type { AdapterContext } from './types.js';
import { expandEntityCacheKeys, normalizeProject, toEntityCacheKey } from './cache-keys.js';

// ============================================================
// QueryDeps 操作
// ============================================================

/**
 * 查询依赖关系
 */
export async function queryDeps(ctx: AdapterContext, params: DepsParams): Promise<DepsResult> {
  const proposalId = params.proposal_id ?? null;
  const depth = params.depth || 1;
  const direction = params.direction || 'both';
  const normalizedProject = normalizeProject(
    params.source_project ?? ctx.config.defaultProject ?? null
  );
  const cacheProposal = proposalId ?? '';

  // 查缓存
  const cacheKey = `deps:${toEntityCacheKey(normalizedProject, params.id)}:${direction}:${depth}:${cacheProposal}`;
  const cached = ctx.cache.get(cacheKey);
  if (cached) {
    return {
      nodes: cached as DepsNode[],
      degraded: false,
    };
  }

  // 确保图数据是最新的
  if (ctx.graph.getProposalId() !== proposalId) {
    const db = ctx.store.getDatabase();
    ctx.graph.load(db, proposalId);
  }

  // 使用内存图查询依赖
  const results = ctx.graph.queryDeps(normalizedProject, params.id, direction, depth);

  const depsNodes = results.map((r) => ({
    id: r.id,
    source_project: r.project,
    type: (r.type ?? 'component') as EntityType,
    distance: r.distance,
    relation_type: r.relation_type ?? 'DEPENDS_ON',
  }));

  // 写缓存（包含相关实体用于失效）
  const relatedEntities = [
    ...expandEntityCacheKeys(normalizedProject, params.id),
    ...results.flatMap((r) => expandEntityCacheKeys(r.project, r.id)),
  ];
  ctx.cache.set(cacheKey, depsNodes, relatedEntities);

  return {
    nodes: depsNodes,
    degraded: false,
  };
}

// ============================================================
// QueryImpact 操作
// ============================================================

/**
 * 查询影响分析
 */
export async function queryImpact(
  ctx: AdapterContext,
  params: ImpactParams
): Promise<ImpactResult> {
  const proposalId = params.proposal_id ?? null;
  const depth = params.depth || 2;
  const normalizedProject = normalizeProject(
    params.source_project ?? ctx.config.defaultProject ?? null
  );
  const cacheProposal = proposalId ?? '';

  // 查缓存
  const cacheKey = `impact:${toEntityCacheKey(normalizedProject, params.id)}:${depth}:${cacheProposal}`;
  const cached = ctx.cache.get(cacheKey);
  if (cached) {
    return {
      nodes: cached as ImpactNode[],
      degraded: false,
    };
  }

  // 确保图数据是最新的
  if (ctx.graph.getProposalId() !== proposalId) {
    const db = ctx.store.getDatabase();
    ctx.graph.load(db, proposalId);
  }

  // 影响分析：查询下游依赖
  const results = ctx.graph.queryDeps(normalizedProject, params.id, 'downstream', depth);

  const reason =
    params.change_type === 'remove'
      ? 'breaking'
      : params.change_type
        ? 'potential'
        : undefined;

  const impactNodes = results.map((r) => ({
    id: r.id,
    source_project: r.project,
    type: (r.type ?? 'component') as EntityType,
    distance: r.distance,
    impact_level: (r.distance === 1 ? 'direct' : 'indirect') as 'direct' | 'indirect',
    reason,
  }));

  // 写缓存
  const relatedEntities = [
    ...expandEntityCacheKeys(normalizedProject, params.id),
    ...results.flatMap((r) => expandEntityCacheKeys(r.project, r.id)),
  ];
  ctx.cache.set(cacheKey, impactNodes, relatedEntities);

  return {
    nodes: impactNodes,
    degraded: false,
  };
}
