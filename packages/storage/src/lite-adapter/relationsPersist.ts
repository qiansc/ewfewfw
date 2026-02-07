/**
 * LiteAdapter 关系持久化
 */

import { randomUUID } from 'node:crypto';
import type { AdapterContext, ParsedRelation } from './types.js';
import { expandEntityCacheKeys } from './cache-keys.js';

function normalizeProperties(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function toDbValue(value: string | null | undefined): string {
  return value ?? '';
}

function resolveTargetUuid(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  rootId: string,
  id: string
): string | null {
  const row = db
    .prepare(
      `
      SELECT e.uuid
      FROM entities e
      JOIN entity_versions v ON e.uuid = v.entity_uuid
      WHERE e.root_id = ? AND e.id = ? AND v.version = '0.0.0'
      LIMIT 1
    `
    )
    .get(rootId, id) as { uuid?: string } | undefined;
  return row?.uuid ?? null;
}

export interface RelationsChangeSet {
  added: Array<{ fromRootId: string; fromId: string; toRootId: string; toId: string; relType: string }>;
  removed: Array<{ fromRootId: string; fromId: string; toRootId: string; toId: string; relType: string }>;
  cacheKeys: string[];
}

/**
 * 持久化关系到数据库 (不更新内存图)
 * 必须在事务中调用
 */
export function persistRelations(
  ctx: AdapterContext,
  rootId: string | null | undefined,
  entityId: string,
  entityUuid: string,
  relations: ParsedRelation[]
): RelationsChangeSet {
  const db = ctx.store.getDatabase();
  const now = new Date().toISOString();
  const dbRootId = rootId ?? '';

  const normalizedRelations = relations.map((rel) => {
    const fromRootId = toDbValue(rel.fromRootId ?? rootId);
    const fromId = rel.fromId ?? entityId;
    return {
      ...rel,
      fromRootId,
      fromId,
      toRootId: toDbValue(rel.toRootId),
      toId: rel.toId,
      relType: rel.relType,
    };
  });

  const preparedRelations = normalizedRelations.map((rel) => {
    const toUuid = resolveTargetUuid(db, rel.toRootId, rel.toId);
    return {
      ...rel,
      toUuid,
      properties: normalizeProperties(rel.properties ?? {}),
    };
  });

  const changeSet: RelationsChangeSet = {
    added: [],
    removed: [],
    cacheKeys: [],
  };

  const oldRelations = db.prepare(`
    SELECT from_root_id, from_id, to_root_id, to_id, rel_type
    FROM relations
    WHERE from_uuid = ? AND (status IS NULL OR status != 'deleted')
  `).all(entityUuid) as Array<{
    from_root_id: string;
    from_id: string;
    to_root_id: string;
    to_id: string;
    rel_type: string;
  }>;

  for (const rel of oldRelations) {
    changeSet.removed.push({
      fromRootId: rel.from_root_id,
      fromId: rel.from_id,
      toRootId: rel.to_root_id,
      toId: rel.to_id,
      relType: rel.rel_type,
    });
  }

  db.prepare(`
    DELETE FROM relations WHERE from_uuid = ?
  `).run(entityUuid);

  const insertStmt = db.prepare(`
    INSERT INTO relations (
      id,
      from_uuid,
      to_uuid,
      from_root_id,
      from_id,
      to_root_id,
      to_id,
      rel_type,
      status,
      properties,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rel of preparedRelations) {
    const relId = randomUUID();
    insertStmt.run(
      relId,
      entityUuid,
      rel.toUuid,
      rel.fromRootId,
      rel.fromId,
      rel.toRootId,
      rel.toId,
      rel.relType,
      'active',
      rel.properties ? JSON.stringify(rel.properties) : null,
      now,
      now
    );

    changeSet.added.push({
      fromRootId: rel.fromRootId,
      fromId: rel.fromId,
      toRootId: rel.toRootId,
      toId: rel.toId,
      relType: rel.relType,
    });
  }

  // Cache keys
  const cacheKeys = new Set<string>();
  const addCacheKeys = (rootId: string | null, id: string) => {
    for (const key of expandEntityCacheKeys(rootId, id)) {
      cacheKeys.add(key);
    }
  };

  addCacheKeys(dbRootId || null, entityId);

  for (const rel of preparedRelations) {
    addCacheKeys(rel.fromRootId || null, rel.fromId);
    addCacheKeys(rel.toRootId || null, rel.toId);
  }

  for (const rel of oldRelations) {
    addCacheKeys(rel.from_root_id || null, rel.from_id);
    addCacheKeys(rel.to_root_id || null, rel.to_id);
  }

  changeSet.cacheKeys = Array.from(cacheKeys);
  return changeSet;
}
