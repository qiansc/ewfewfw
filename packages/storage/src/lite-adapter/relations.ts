/**
 * LiteAdapter 关系解析与保存
 */

import type { AdapterContext, ParsedRelation } from './types.js';
import { parseRelations } from './relationsParse.js';
import { persistRelations, type RelationsChangeSet } from './relationsPersist.js';
import { updateGraph } from './relationsGraph.js';

export { parseRelations } from './relationsParse.js';
export { persistRelations, type RelationsChangeSet } from './relationsPersist.js';
export { updateGraph } from './relationsGraph.js';

/**
 * 保存关系到数据库并更新内存图 (旧版兼容接口)
 * @deprecated 请使用 persistRelations 和 updateGraph 分开处理
 */
export function saveRelations(
  ctx: AdapterContext,
  rootId: string | null | undefined,
  entityId: string,
  entityUuid: string,
  relations: ParsedRelation[],
  options?: { inTransaction?: boolean }
): void {
  const run = (): void => {
    const changeset: RelationsChangeSet = persistRelations(ctx, rootId, entityId, entityUuid, relations);
    updateGraph(ctx, changeset);
  };

  if (options?.inTransaction) {
    run();
    return;
  }

  const db = ctx.store.getDatabase();
  db.transaction(run)();
}
