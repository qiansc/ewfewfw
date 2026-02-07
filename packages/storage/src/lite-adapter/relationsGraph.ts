/**
 * LiteAdapter 关系图更新
 */

import type { AdapterContext } from './types.js';
import type { RelationsChangeSet } from './relationsPersist.js';

/**
 * 更新内存图和缓存
 */
export function updateGraph(ctx: AdapterContext, changeset: RelationsChangeSet): void {
  const toGraphRootId = (value: string | null | undefined): string | null =>
    value === '' || value === null || value === undefined ? null : value;
  const db = ctx.store.getDatabase();

  const fetchEntityType = (rootId: string | null | undefined, id: string): string | null => {
    const dbRootId = rootId ?? '';
    const row = db
      .prepare(
        `
        SELECT e.type
        FROM entities e
        JOIN entity_versions v ON e.uuid = v.entity_uuid
        WHERE e.root_id = ? AND e.id = ? AND v.version = '0.0.0'
        LIMIT 1
      `
      )
      .get(dbRootId, id) as { type?: string } | undefined;
    return row?.type ?? null;
  };

  for (const rel of changeset.removed) {
    ctx.graph.removeRelation(
      toGraphRootId(rel.fromRootId),
      rel.fromId,
      toGraphRootId(rel.toRootId),
      rel.toId,
      rel.relType
    );
  }

  for (const rel of changeset.added) {
    const fromType = fetchEntityType(rel.fromRootId, rel.fromId);
    const toType = fetchEntityType(rel.toRootId, rel.toId);
    ctx.graph.addRelation(
      toGraphRootId(rel.fromRootId),
      rel.fromId,
      toGraphRootId(rel.toRootId),
      rel.toId,
      rel.relType,
      fromType,
      toType
    );
  }

  for (const key of changeset.cacheKeys) {
    ctx.cache.invalidate(key);
  }
}
