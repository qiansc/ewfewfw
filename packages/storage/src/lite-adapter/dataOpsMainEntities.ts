import { randomUUID } from 'node:crypto';
import type { StorageOperations } from '../data-ops/types.js';
import type { EntityType } from '../adapter.js';
import type { Database } from './dataOpsTypes.js';

export function createMainEntityOperations(
  db: Database
): Pick<
  StorageOperations,
  | 'getEntityContentHash'
  | 'insertEntity'
  | 'updateEntity'
  | 'listEntitiesForExport'
  | 'listEntitiesForPlanSync'
> {

  const getEntityContentHash: StorageOperations['getEntityContentHash'] = (params) => {
    if (params.requirementId) {
      const row = db.prepare(
        `
          SELECT m.content_hash
          FROM entities e
          JOIN metadata m ON e.uuid = m.entity_uuid
          WHERE e.id = ? AND e.root_id = ? AND e.requirement_id = ?
          LIMIT 1
        `
      ).get(params.entityId, params.rootId, params.requirementId) as
        | { content_hash: string }
        | undefined;
      return row?.content_hash ?? null;
    }
    const row = db.prepare(
      `
        SELECT m.content_hash
        FROM entities e
        JOIN metadata m ON e.uuid = m.entity_uuid
        WHERE e.id = ? AND e.root_id = ? AND (e.requirement_id IS NULL OR e.requirement_id = '')
        LIMIT 1
      `
    ).get(params.entityId, params.rootId) as { content_hash: string } | undefined;
    return row?.content_hash ?? null;
  };

  const insertEntity: StorageOperations['insertEntity'] = (params) => {
    const requirementId = params.requirementId ?? null;
    const status = params.status ?? 'published';
    const uuid = randomUUID();
    db.prepare(
      `
        INSERT INTO entities (
          uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id, orphaned, orphaned_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL)
      `
    ).run(
      uuid,
      params.rootId,
      params.entityId,
      params.entityType,
      params.entityKind ?? null,
      params.entityScope ?? null,
      params.entityPerspective ?? null,
      JSON.stringify(params.data),
      requirementId
    );

    db.prepare(
      `
        INSERT INTO metadata (entity_uuid, status, content_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
    ).run(uuid, status, params.contentHash, params.createdAt, params.updatedAt);

    db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(
      uuid,
      '0.0.0'
    );

    resolveDanglingRelations(db, params.rootId, params.entityId);
  };

  const updateEntity: StorageOperations['updateEntity'] = (params) => {
    const requirementId = params.requirementId ?? null;
    const condition = requirementId
      ? { clause: 'e.requirement_id = ?', args: [requirementId] }
      : { clause: "(e.requirement_id IS NULL OR e.requirement_id = '')", args: [] };

    db.prepare(
      `
        UPDATE entities
        SET type = ?, data = ?
        WHERE id = ? AND root_id = ? AND ${condition.clause}
      `
    ).run(
      params.entityType,
      JSON.stringify(params.data),
      params.entityId,
      params.rootId,
      ...condition.args
    );

    const result = db.prepare(
      `
        UPDATE metadata
        SET content_hash = ?, updated_at = ?
        WHERE entity_uuid IN (
          SELECT uuid FROM entities e
          WHERE e.id = ? AND e.root_id = ? AND ${condition.clause}
        )
      `
    ).run(
      params.contentHash,
      params.updatedAt,
      params.entityId,
      params.rootId,
      ...condition.args
    );

    return { affectedRows: result.changes ?? 0 };
  };

  const listEntitiesForExport: StorageOperations['listEntitiesForExport'] = (params) => {
    const statusCondition = buildStatusCondition(params.statusFilter);
    return db.prepare(
      `
        SELECT e.id, e.type, e.data, m.status, m.content_hash, m.updated_at
        FROM entities e
        JOIN metadata m ON e.uuid = m.entity_uuid
        WHERE (e.requirement_id IS NULL OR e.requirement_id = '') ${statusCondition}
      `
    ).all() as Array<{
      id: string;
      type: EntityType;
      data: string;
      status: string;
      content_hash: string;
      updated_at?: string;
    }>;
  };

  const listEntitiesForPlanSync: StorageOperations['listEntitiesForPlanSync'] = (params) => {
    const statusCondition = buildStatusCondition(params.statusFilter);
    return db.prepare(
      `
        SELECT e.id, e.type, e.data, m.content_hash
        FROM entities e
        JOIN metadata m ON e.uuid = m.entity_uuid
        WHERE (e.requirement_id = ? OR e.requirement_id IS NULL OR e.requirement_id = '') ${statusCondition}
      `
    ).all(params.requirementId ?? null) as Array<{
      id: string;
      type: EntityType;
      data: string;
      content_hash: string;
    }>;
  };

  return {
    getEntityContentHash,
    insertEntity,
    updateEntity,
    listEntitiesForExport,
    listEntitiesForPlanSync,
  };
}

function resolveDanglingRelations(db: Database, rootId: string, entityId: string): void {
  const rows = db.prepare(
    `
    SELECT id, to_root_id, properties
    FROM relations
    WHERE to_id = ?
      AND (status IS NULL OR status != 'deleted')
  `
  ).all(entityId) as Array<{
    id: string;
    to_root_id: string | null;
    properties: string | null;
  }>;

  if (rows.length === 0) return;

  const now = new Date().toISOString();
  const updateStmt = db.prepare(
    `
    UPDATE relations
    SET to_root_id = ?, properties = ?, updated_at = ?
    WHERE id = ?
  `
  );

  for (const row of rows) {
    let props: Record<string, unknown> = {};
    if (row.properties) {
      try {
        props = JSON.parse(row.properties) as Record<string, unknown>;
      } catch {
        props = {};
      }
    }

    const isDangling = props.resolved === false || props.resolve_status === 'pending';
    if (!isDangling) continue;

    const toRootId = row.to_root_id ?? '';
    const targetRootId =
      typeof props.target_root_id === 'string' ? props.target_root_id : null;
    const shouldResolve =
      toRootId === rootId || toRootId === '' || targetRootId === rootId;

    if (!shouldResolve) continue;

    delete props.resolved;
    if (props.resolve_status === 'pending') {
      delete props.resolve_status;
    }

    const nextRootId = toRootId === '' ? rootId : toRootId;
    const nextProps = Object.keys(props).length > 0 ? JSON.stringify(props) : null;
    updateStmt.run(nextRootId, nextProps, now, row.id);
  }
}

function buildStatusCondition(statusFilter: 'published' | 'approved' | 'all'): string {
  if (statusFilter === 'published') {
    return "AND m.status = 'published'";
  }
  if (statusFilter === 'approved') {
    return "AND m.status IN ('published', 'approved')";
  }
  return '';
}
