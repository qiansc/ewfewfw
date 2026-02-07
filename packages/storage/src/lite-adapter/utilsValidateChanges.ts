import type { ValidateCheckResult } from '../adapter.js';
import type { SQLiteStore } from '../sqlite-store.js';

type Database = ReturnType<SQLiteStore['getDatabase']>;

type ChangeRecord = Array<{ type: string; entity_id: string; detail: string }>;

type FeatEntity = Array<{
  uuid?: string;
  id: string;
  type: string;
  data: string;
  status: string;
  root_id: string;
}>;

export function detectArchitectureChanges(
  db: Database,
  baseEntities: FeatEntity,
  requirementId: string
): ValidateCheckResult['changes_detected'] {
  const targetTypes = new Set(['system', 'container']);
  const featEntities = baseEntities.filter((entity) => targetTypes.has(entity.type));
  if (featEntities.length === 0) return [];

  const ids = featEntities.map((entity) => entity.id);
  const placeholders = ids.map(() => '?').join(', ');
  const mainEntities = db
    .prepare(
      `
    SELECT e.id, e.root_id, e.data
    FROM entities e
    WHERE (e.requirement_id IS NULL OR e.requirement_id = '')
      AND e.id IN (${placeholders})
  `
    )
    .all(...ids) as Array<{ id: string; root_id: string; data: string }>;

  const mainMap = new Map(mainEntities.map((entity) => [`${entity.root_id}::${entity.id}`, entity.data]));
  const changes: NonNullable<ValidateCheckResult['changes_detected']> = [];

  for (const featEntity of featEntities) {
    if (featEntity.status === 'deleted') {
      changes.push({
        type: 'deleted',
        entity_id: featEntity.id,
        detail: 'feat 中删除实体',
      });
      continue;
    }
    const mainKey = `${featEntity.root_id}::${featEntity.id}`;
    const mainPayload = mainMap.get(mainKey);
    if (!mainPayload) {
      changes.push({
        type: 'created',
        entity_id: featEntity.id,
        detail: 'feat 中新增实体',
      });
      continue;
    }
    if (mainPayload !== featEntity.data) {
      const detail = buildChangeDetail(featEntity.type, mainPayload, featEntity.data);
      changes.push({
        type: 'modified',
        entity_id: featEntity.id,
        detail,
      });
    }
  }

  const relationChanges = detectDependsOnChanges(db, requirementId, featEntities);
  return changes.concat(relationChanges);
}

export function loadFeatStatus(db: Database, featUuid: string): string | null {
  const row = db
    .prepare(
      `
      SELECT m.status
      FROM entities e
      JOIN metadata m ON e.uuid = m.entity_uuid
      WHERE e.type = 'feat' AND e.uuid = ? AND e.root_id = ''
      LIMIT 1
    `
    )
    .get(featUuid) as { status?: string } | undefined;
  return typeof row?.status === 'string' ? row.status : null;
}

function buildChangeDetail(entityType: string, mainData: string, featData: string): string {
  if (entityType !== 'container') {
    return '实体数据发生变更';
  }
  const mainTech = extractTechnology(mainData);
  const featTech = extractTechnology(featData);
  if (mainTech !== featTech && (mainTech || featTech)) {
    return `技术栈变更: ${mainTech ?? 'unknown'} → ${featTech ?? 'unknown'}`;
  }
  return '实体数据发生变更';
}

function extractTechnology(rawData: string): string | null {
  try {
    const data = JSON.parse(rawData) as Record<string, unknown>;
    if (typeof data.technology === 'string') return data.technology;
    if (typeof data.tech_stack === 'string') return data.tech_stack;
    if (typeof data.stack === 'string') return data.stack;
  } catch {
    return null;
  }
  return null;
}

function detectDependsOnChanges(db: Database, requirementId: string, featEntities: FeatEntity): ChangeRecord {
  const changes: ChangeRecord = [];
  const typeMap = new Map<string, string>();
  for (const entity of featEntities) {
    typeMap.set(`${entity.root_id ?? ''}::${entity.id}`, entity.type);
  }

  const featRelations = db.prepare(
    `
    SELECT r.from_root_id, r.from_id, r.to_root_id, r.to_id, r.rel_type, r.status
    FROM relations r
    JOIN entities e ON e.uuid = r.from_uuid
    WHERE e.requirement_id = ? AND r.rel_type = 'DEPENDS_ON'
  `
  ).all(requirementId) as Array<{
    from_root_id: string;
    from_id: string;
    to_root_id: string;
    to_id: string;
    rel_type: string;
    status: string | null;
  }>;

  const mainRelations = db.prepare(
    `
    SELECT r.from_root_id, r.from_id, r.to_root_id, r.to_id, r.rel_type
    FROM relations r
    JOIN entities e ON e.uuid = r.from_uuid
    WHERE (e.requirement_id IS NULL OR e.requirement_id = '')
      AND r.rel_type = 'DEPENDS_ON'
      AND (r.status IS NULL OR r.status != 'deleted')
  `
  ).all() as Array<{
    from_root_id: string;
    from_id: string;
    to_root_id: string;
    to_id: string;
    rel_type: string;
  }>;

  const mainSet = new Set(
    mainRelations.map(
      (rel) =>
        `${rel.from_root_id ?? ''}::${rel.from_id}::${rel.rel_type}::${rel.to_root_id ?? ''}::${rel.to_id}`
    )
  );

  for (const rel of featRelations) {
    const fromKey = `${rel.from_root_id ?? ''}::${rel.from_id}`;
    const fromType = typeMap.get(fromKey);
    if (fromType !== 'system' && fromType !== 'container') {
      continue;
    }
    const relKey = `${rel.from_root_id ?? ''}::${rel.from_id}::${rel.rel_type}::${rel.to_root_id ?? ''}::${rel.to_id}`;
    const status = rel.status ?? 'active';
    if (status === 'deleted') {
      if (mainSet.has(relKey)) {
        changes.push({
          type: 'relation_removed',
          entity_id: rel.from_id,
          detail: `移除 DEPENDS_ON: ${rel.from_id} → ${rel.to_id}`,
        });
      }
      continue;
    }
    if (!mainSet.has(relKey)) {
      changes.push({
        type: 'relation_added',
        entity_id: rel.from_id,
        detail: `新增 DEPENDS_ON: ${rel.from_id} → ${rel.to_id}`,
      });
    }
  }

  return changes;
}
