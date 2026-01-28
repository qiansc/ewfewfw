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
  ImpactParams,
  ImpactNode,
} from '../adapter.js';
import type { AdapterContext } from './types.js';

// ============================================================
// QueryDeps 操作
// ============================================================

/**
 * 查询依赖关系
 */
export async function queryDeps(ctx: AdapterContext, params: DepsParams): Promise<DepsNode[]> {
  const proposalId = params.proposal_id ?? null;
  const depth = params.depth || 1;
  const direction = params.direction || 'both';

  // 查缓存
  const cacheKey = `deps:${params.id}:${direction}:${depth}:${proposalId}`;
  const cached = ctx.cache.get(cacheKey);
  if (cached) {
    return cached as DepsNode[];
  }

  // 确保图数据是最新的
  if (ctx.graph.getProposalId() !== proposalId) {
    const db = ctx.store.getDatabase();
    ctx.graph.load(db, proposalId);
  }

  // 使用内存图查询依赖
  const results = ctx.graph.queryDeps(null, params.id, direction, depth);

  const depsNodes = results.map((r) => ({
    id: r.id,
    type: 'component' as EntityType,
    distance: r.distance,
    relation_type: 'depends_on',
  }));

  // 写缓存（包含相关实体用于失效）
  const relatedEntities = [params.id, ...results.map(r => r.id)];
  ctx.cache.set(cacheKey, depsNodes, relatedEntities);

  return depsNodes;
}

// ============================================================
// QueryImpact 操作
// ============================================================

/**
 * 查询影响分析
 */
export async function queryImpact(ctx: AdapterContext, params: ImpactParams): Promise<ImpactNode[]> {
  const proposalId = params.proposal_id ?? null;
  const depth = params.depth || 2;

  // 查缓存
  const cacheKey = `impact:${params.id}:${depth}:${proposalId}`;
  const cached = ctx.cache.get(cacheKey);
  if (cached) {
    return cached as ImpactNode[];
  }

  // 确保图数据是最新的
  if (ctx.graph.getProposalId() !== proposalId) {
    const db = ctx.store.getDatabase();
    ctx.graph.load(db, proposalId);
  }

  // 影响分析：查询下游依赖
  const results = ctx.graph.queryDeps(null, params.id, 'downstream', depth);

  const impactNodes = results.map((r) => ({
    id: r.id,
    type: 'component' as EntityType,
    distance: r.distance,
    impact_level: (r.distance === 1 ? 'direct' : 'indirect') as 'direct' | 'indirect',
  }));

  // 写缓存
  const relatedEntities = [params.id, ...results.map(r => r.id)];
  ctx.cache.set(cacheKey, impactNodes, relatedEntities);

  return impactNodes;
}
