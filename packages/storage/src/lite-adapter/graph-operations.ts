/**
 * LiteAdapter 图查询操作
 */

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
import { expandEntityCacheKeys, normalizeRootId, toEntityCacheKey } from './cache-keys.js';

function resolveRootAndId(
  ctx: AdapterContext,
  params: { uuid?: string; root_id?: string; id?: string }
): { rootId: string | null; id: string } {
  if (params.uuid) {
    const row = ctx.store
      .getDatabase()
      .prepare(
        `
        SELECT e.root_id, e.id
        FROM entities e
        WHERE e.uuid = ?
        LIMIT 1
      `
      )
      .get(params.uuid) as { root_id?: string; id?: string } | undefined;
    if (!row?.id) {
      throw new Error(`Entity not found for uuid: ${params.uuid}`);
    }
    return { rootId: normalizeRootId(row.root_id ?? null), id: row.id };
  }

  if (!params.id) {
    throw new Error('id is required');
  }

  const rootId = normalizeRootId(
    params.root_id ?? (params as { root_id?: string | null }).root_id ?? ctx.config.defaultProject ?? null
  );
  return { rootId, id: params.id };
}

function resolveUuidByRootId(
  ctx: AdapterContext,
  rootId: string | null,
  id: string
): string | null {
  const row = ctx.store
    .getDatabase()
    .prepare(
      `
      SELECT e.uuid
      FROM entities e
      JOIN entity_versions v ON e.uuid = v.entity_uuid
      WHERE e.root_id = ? AND e.id = ? AND v.version = '0.0.0'
      LIMIT 1
    `
    )
    .get(rootId ?? '', id) as { uuid?: string } | undefined;
  return row?.uuid ?? null;
}

/**
 * 查询依赖关系
 */
export async function queryDeps(ctx: AdapterContext, params: DepsParams): Promise<DepsResult> {
  const depth = params.depth || 1;
  const direction = params.direction || 'both';
  const { rootId, id } = resolveRootAndId(ctx, params);

  const cacheKey = `deps:${toEntityCacheKey(rootId, id)}:${direction}:${depth}`;
  const cached = ctx.cache.get(cacheKey);
  if (cached) {
    return {
      nodes: cached as DepsNode[],
      degraded: false,
    };
  }

  const results = ctx.graph.queryDeps(rootId, id, direction, depth);

  const depsNodes = results.map((r) => ({
    uuid: r.uuid ?? resolveUuidByRootId(ctx, r.root_id ?? null, r.id) ?? '',
    id: r.id,
    root_id: r.root_id ?? '',
    type: (r.type ?? 'component') as EntityType,
    distance: r.distance,
    relation_type: r.relation_type ?? 'DEPENDS_ON',
  }));

  const relatedEntities = [
    ...expandEntityCacheKeys(rootId, id),
    ...results.flatMap((r) => expandEntityCacheKeys(r.root_id ?? null, r.id)),
  ];
  ctx.cache.set(cacheKey, depsNodes, relatedEntities);

  return {
    nodes: depsNodes,
    degraded: false,
  };
}

/**
 * 查询影响分析
 */
export async function queryImpact(
  ctx: AdapterContext,
  params: ImpactParams
): Promise<ImpactResult> {
  const depth = params.depth || 2;
  const { rootId, id } = resolveRootAndId(ctx, params);

  const cacheKey = `impact:${toEntityCacheKey(rootId, id)}:${depth}`;
  const cached = ctx.cache.get(cacheKey);
  if (cached) {
    return {
      nodes: cached as ImpactNode[],
      degraded: false,
    };
  }

  const results = ctx.graph.queryDeps(rootId, id, 'downstream', depth);

  const reason =
    params.change_type === 'remove'
      ? 'breaking'
      : params.change_type
        ? 'potential'
        : undefined;

  const impactNodes = results.map((r) => ({
    uuid: r.uuid ?? resolveUuidByRootId(ctx, r.root_id ?? null, r.id) ?? '',
    id: r.id,
    root_id: r.root_id ?? '',
    type: (r.type ?? 'component') as EntityType,
    distance: r.distance,
    impact_level: (r.distance === 1 ? 'direct' : 'indirect') as 'direct' | 'indirect',
    reason,
  }));

  const relatedEntities = [
    ...expandEntityCacheKeys(rootId, id),
    ...results.flatMap((r) => expandEntityCacheKeys(r.root_id ?? null, r.id)),
  ];
  ctx.cache.set(cacheKey, impactNodes, relatedEntities);

  return {
    nodes: impactNodes,
    degraded: false,
  };
}
