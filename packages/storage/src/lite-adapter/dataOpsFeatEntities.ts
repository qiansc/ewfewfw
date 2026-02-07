import type {
  FeatEntityConflictRow,
  FeatEntityContentHash,
  FeatMergeEntity,
  StorageOperations,
  VectorEntity,
} from '../data-ops/types.js';
import type { EntityRow } from './types.js';
import type { Database, GetFeat } from './dataOpsTypes.js';
import { rowToEntity } from './helpers.js';

export function createFeatEntityOperations(
  db: Database,
  getFeat: GetFeat
): Pick<
  StorageOperations,
  | 'getFeatEntityContentHashes'
  | 'listFeatEntitiesForConflict'
  | 'listFeatEntityProjects'
  | 'deleteFeatEntity'
  | 'listFeatEntitiesForMerge'
  | 'moveFeatEntitiesToMain'
  | 'listFeatEntitiesForVector'
  | 'deleteEntitiesByRequirementId'
  | 'deleteMetadataByRequirementId'
  | 'deleteRelationsByRequirementId'
  | 'getEntityInFeat'
> {
  const getFeatEntityContentHashes: StorageOperations['getFeatEntityContentHashes'] = (featId) => {
    const feat = getFeat(featId);
    if (!feat?.uuid) return [];
    return db.prepare(
      `
        SELECT e.id, m.content_hash
        FROM entities e
        JOIN metadata m ON e.uuid = m.entity_uuid
        WHERE e.requirement_id = ? AND e.type NOT IN ('feat', 'checklist')
        ORDER BY e.id
      `
    ).all(feat.uuid) as FeatEntityContentHash[];
  };

  const listFeatEntitiesForConflict: StorageOperations['listFeatEntitiesForConflict'] = (featId) => {
    const feat = getFeat(featId);
    if (!feat?.uuid) return [];
    return db.prepare(
      `
        SELECT e.id, e.root_id, e.type, e.kind, e.data, m.content_hash
        FROM entities e
        JOIN metadata m ON e.uuid = m.entity_uuid
        WHERE e.requirement_id = ? AND e.type NOT IN ('feat', 'checklist')
      `
    ).all(feat.uuid) as FeatEntityConflictRow[];
  };

  const listFeatEntityProjects: StorageOperations['listFeatEntityProjects'] = (featId, entityId) => {
    const feat = getFeat(featId);
    if (!feat?.uuid) return [];
    return db.prepare(
      `
        SELECT uuid FROM entities WHERE id = ? AND requirement_id = ?
      `
    ).all(entityId, feat.uuid) as Array<{ uuid: string }>;
  };

  const deleteFeatEntity: StorageOperations['deleteFeatEntity'] = (featId, entityId) => {
    const feat = getFeat(featId);
    if (!feat?.uuid) return;
    db.prepare(
      `
        DELETE FROM entities WHERE id = ? AND requirement_id = ?
      `
    ).run(entityId, feat.uuid);
  };

  const listFeatEntitiesForMerge: StorageOperations['listFeatEntitiesForMerge'] = (featId) => {
    const feat = getFeat(featId);
    if (!feat?.uuid) return [];
    return db.prepare(
      `
        SELECT e.id, e.root_id, e.type, e.kind, e.scope, e.perspective, e.data,
               m.status, m.content_hash, m.updated_at
        FROM entities e
        JOIN metadata m ON e.uuid = m.entity_uuid
        WHERE e.requirement_id = ? AND e.type NOT IN ('feat', 'checklist')
      `
    ).all(feat.uuid) as FeatMergeEntity[];
  };

  const moveFeatEntitiesToMain: StorageOperations['moveFeatEntitiesToMain'] = (featId, updatedAt) => {
    const feat = getFeat(featId);
    if (!feat?.uuid) return;
    const requirementId = feat.uuid;
    const rows = db.prepare(
      `
        SELECT uuid, root_id, id
        FROM entities
        WHERE requirement_id = ? AND type NOT IN ('feat', 'checklist')
      `
    ).all(requirementId) as Array<{ uuid: string; root_id: string; id: string }>;

    for (const row of rows) {
      const mainRows = db.prepare(
        `
          SELECT uuid FROM entities
          WHERE id = ? AND root_id = ? AND (requirement_id IS NULL OR requirement_id = '')
        `
      ).all(row.id, row.root_id) as Array<{ uuid: string }>;

      if (mainRows.length > 0) {
        const uuids = mainRows.map((item) => item.uuid);
        const placeholders = uuids.map(() => '?').join(', ');
        db.prepare(
          `
            DELETE FROM relations
            WHERE from_uuid IN (${placeholders}) OR to_uuid IN (${placeholders})
          `
        ).run(...uuids, ...uuids);
        db.prepare(`DELETE FROM metadata WHERE entity_uuid IN (${placeholders})`).run(...uuids);
        db.prepare(`DELETE FROM entity_versions WHERE entity_uuid IN (${placeholders})`).run(...uuids);
        db.prepare(
          `
            DELETE FROM entities
            WHERE id = ? AND root_id = ? AND (requirement_id IS NULL OR requirement_id = '')
          `
        ).run(row.id, row.root_id);
      }

      db.prepare(
        `
          UPDATE entities
          SET requirement_id = NULL
          WHERE uuid = ?
        `
      ).run(row.uuid);

      db.prepare(
        `
          UPDATE metadata
          SET status = 'published', updated_at = ?
          WHERE entity_uuid = ?
        `
      ).run(updatedAt, row.uuid);
    }
  };

  const listFeatEntitiesForVector: StorageOperations['listFeatEntitiesForVector'] = (featId) => {
    const feat = getFeat(featId);
    if (!feat?.uuid) return [];
    return db.prepare(
      `
        SELECT uuid, id, root_id, data
        FROM entities
        WHERE requirement_id = ? AND type NOT IN ('feat', 'checklist')
      `
    ).all(feat.uuid) as VectorEntity[];
  };

  const deleteEntitiesByRequirementId: StorageOperations['deleteEntitiesByRequirementId'] = (featId) => {
    db.prepare(`DELETE FROM entities WHERE requirement_id = ?`).run(featId);
  };

  const deleteMetadataByRequirementId: StorageOperations['deleteMetadataByRequirementId'] = (featId) => {
    const rows = db.prepare(`SELECT uuid FROM entities WHERE requirement_id = ?`).all(featId) as Array<{
      uuid: string;
    }>;
    if (rows.length === 0) return;
    const uuids = rows.map((row) => row.uuid);
    const placeholders = uuids.map(() => '?').join(', ');
    db.prepare(`DELETE FROM metadata WHERE entity_uuid IN (${placeholders})`).run(...uuids);
  };

  const deleteRelationsByRequirementId: StorageOperations['deleteRelationsByRequirementId'] = (featId) => {
    const rows = db.prepare(`SELECT uuid FROM entities WHERE requirement_id = ?`).all(featId) as Array<{
      uuid: string;
    }>;
    if (rows.length === 0) return;
    const uuids = rows.map((row) => row.uuid);
    const placeholders = uuids.map(() => '?').join(', ');
    db.prepare(
      `DELETE FROM relations WHERE from_uuid IN (${placeholders}) OR to_uuid IN (${placeholders})`
    ).run(...uuids, ...uuids);
  };

  const getEntityInFeat: StorageOperations['getEntityInFeat'] = (params) => {
    const feat = getFeat(params.featId);
    const requirementId = feat?.uuid ?? params.featId;
    const row = db
      .prepare(
        `
        SELECT e.uuid, e.root_id, e.id, e.type, e.kind, e.scope, e.perspective, e.data,
               e.requirement_id, e.component_id,
               m.status, m.content_hash, m.created_at, m.updated_at, m.source_repo, m.external_url,
               m.created_by, m.updated_by
        FROM entities e
        JOIN metadata m ON e.uuid = m.entity_uuid
        WHERE e.id = ? AND e.requirement_id = ?
        LIMIT 1
      `
      )
      .get(params.entityId, requirementId) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  };

  return {
    getFeatEntityContentHashes,
    listFeatEntitiesForConflict,
    listFeatEntityProjects,
    deleteFeatEntity,
    listFeatEntitiesForMerge,
    moveFeatEntitiesToMain,
    listFeatEntitiesForVector,
    deleteEntitiesByRequirementId,
    deleteMetadataByRequirementId,
    deleteRelationsByRequirementId,
    getEntityInFeat,
  };
}
