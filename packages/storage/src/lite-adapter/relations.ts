/**
 * LiteAdapter 关系解析与保存
 */

import { randomUUID } from 'node:crypto';
import type { EntityType } from '../adapter.js';
import { resolveReference } from '../data-ops/reference/resolver.js';
import type { ReferenceCandidate, ResolvedReference } from '../data-ops/reference/types.js';
import type { AdapterContext, ParsedRelation } from './types.js';
import { expandEntityCacheKeys } from './cache-keys.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeRelationType(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value.toUpperCase().replace(/-/g, '_');
}

function normalizeProperties(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function toDbValue(value: string | null | undefined): string {
  return value ?? '';
}

function toNullableProject(value: string | null | undefined): string | null {
  if (!value) return null;
  return value;
}

function buildRelationKey(
  fromProject: string,
  fromId: string,
  toProject: string,
  toId: string,
  relType: string
): string {
  return `${fromProject}|${fromId}|${toProject}|${toId}|${relType}`;
}

function buildReferenceLookup(
  ctx: AdapterContext,
  proposalId: string | null | undefined
): (id: string) => ReferenceCandidate[] {
  const db = ctx.store.getDatabase();
  const dbProposalId = proposalId ?? '';

  return (id: string): ReferenceCandidate[] => {
    const rows = db.prepare(`
      SELECT e.id, e.source_project, e.scope, m.source_repo
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id = m.proposal_id
      WHERE e.id = ?
        AND (e.proposal_id IS NULL OR e.proposal_id = '' OR e.proposal_id = ?)
    `).all(id, dbProposalId) as Array<{
      id: string;
      source_project: string;
      scope: string | null;
      source_repo: string | null;
    }>;

    const unique = new Map<string, ReferenceCandidate>();
    for (const row of rows) {
      const sourceProject = toNullableProject(row.source_project);
      const sourceRepo = row.source_repo ?? null;
      const scope = (row.scope ?? null) as ReferenceCandidate['scope'];
      const key = `${sourceProject ?? ''}|${sourceRepo ?? ''}|${scope ?? ''}`;
      if (unique.has(key)) continue;
      unique.set(key, {
        id: row.id,
        sourceProject,
        sourceRepo,
        scope,
      });
    }

    return Array.from(unique.values());
  };
}

function createReferenceResolver(
  ctx: AdapterContext,
  sourceProject: string,
  proposalId: string | null | undefined
): (ref: string) => ResolvedReference {
  return (ref: string) =>
    resolveReference(ref, {
      projectId: sourceProject,
      repoId: ctx.config.repoId ?? null,
      lookup: buildReferenceLookup(ctx, proposalId),
    });
}

function resolveTarget(ref: string, resolver: (ref: string) => ResolvedReference): {
  toProject: string;
  toId: string;
  properties?: Record<string, unknown>;
} {
  const resolved = resolver(ref);
  const properties: Record<string, unknown> = {};
  const toId = resolved.id;
  const toProject = resolved.targetProject ?? '';

  if (resolved.targetRepo) {
    properties.target_repo = resolved.targetRepo;
  }
  if (resolved.targetProject) {
    properties.target_project = resolved.targetProject;
  }
  if (resolved.scope) {
    properties.target_scope = resolved.scope;
  }

  return {
    toProject,
    toId,
    properties: normalizeProperties(properties),
  };
}

function extractReferenceList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const refs: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      refs.push(item);
      continue;
    }
    if (!isPlainObject(item)) continue;
    const ref = item.ref ?? item.reference ?? item.id;
    if (typeof ref === 'string' && ref.length > 0) {
      refs.push(ref);
    }
  }
  return refs;
}

function findReferences(data: Record<string, unknown>, entityType: EntityType): string[] {
  const refs = new Set<string>();
  for (const ref of extractReferenceList(data.references)) {
    refs.add(ref);
  }

  const entityKey: Record<EntityType, string> = {
    system: 'system',
    container: 'container',
    component: 'component',
    product: 'product',
    process: 'process',
    sor: 'sor',
    adr: 'adr',
    contract: 'contract',
    concept: 'concept',
  };

  const block = data[entityKey[entityType]];
  if (isPlainObject(block)) {
    for (const ref of extractReferenceList(block.references)) {
      refs.add(ref);
    }
  }

  return Array.from(refs);
}

/**
 * 从 DSL data 中解析关系
 */
export function parseRelations(
  ctx: AdapterContext,
  data: Record<string, unknown>,
  sourceProject: string | null | undefined,
  entityId: string,
  entityType: EntityType,
  proposalId?: string | null
): ParsedRelation[] {
  const relations: ParsedRelation[] = [];
  const relationKeys = new Set<string>();
  let handledRelationships = false;
  const normalizedSourceProject = sourceProject ?? '';
  const resolver = createReferenceResolver(ctx, normalizedSourceProject, proposalId);

  const pushRelation = (relation: ParsedRelation) => {
    const fromProject = relation.fromProject ?? sourceProject;
    const fromId = relation.fromId ?? entityId;
    const key = `${fromProject}|${fromId}|${relation.toProject}|${relation.toId}|${relation.relType}`;
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
    relations.push(relation);
  };

  const addOutgoing = (targetRef: string, relType: string, props?: Record<string, unknown>) => {
    const resolved = resolveTarget(targetRef, resolver);
    pushRelation({
      toProject: resolved.toProject,
      toId: resolved.toId,
      relType,
      properties: normalizeProperties({
        ...resolved.properties,
        ...props,
      }),
    });
  };

  const addIncoming = (sourceRef: string, relType: string, props?: Record<string, unknown>) => {
    const resolved = resolveTarget(sourceRef, resolver);
    pushRelation({
      fromProject: resolved.toProject,
      fromId: resolved.toId,
      toProject: normalizedSourceProject,
      toId: entityId,
      relType,
      properties: normalizeProperties({
        ...resolved.properties,
        ...props,
      }),
    });
  };

  const relationships = data.relationships;

  if (entityType === 'system' && isPlainObject(relationships)) {
    handledRelationships = true;
    const rels = relationships as {
      consumers?: Array<Record<string, unknown>>;
      dependencies?: Array<Record<string, unknown>>;
    };

    for (const dep of rels.dependencies || []) {
      const target = typeof dep === 'string' ? dep : (dep?.id as string | undefined);
      if (!target) continue;
      addOutgoing(target, 'DEPENDS_ON', {
        description: isPlainObject(dep) ? dep.description : undefined,
        technology: isPlainObject(dep) ? dep.technology : undefined,
        criticality: isPlainObject(dep) ? dep.criticality : undefined,
        external: isPlainObject(dep) ? dep.external : undefined,
        external_info: isPlainObject(dep) ? dep.external_info : undefined,
      });
    }

    for (const consumer of rels.consumers || []) {
      const source = typeof consumer === 'string' ? consumer : (consumer?.id as string | undefined);
      if (!source) continue;
      addIncoming(source, 'DEPENDS_ON', {
        origin: 'system_consumers',
        consumer_type: isPlainObject(consumer) ? consumer.type : undefined,
        description: isPlainObject(consumer) ? consumer.description : undefined,
      });
    }
  }

  if (entityType === 'container' && Array.isArray(relationships)) {
    handledRelationships = true;
    for (const rel of relationships) {
      if (typeof rel === 'string') {
        addOutgoing(rel, 'DEPENDS_ON');
        continue;
      }
      if (!isPlainObject(rel)) continue;
      const target = (rel.to as string | undefined) ?? (rel.target as string | undefined);
      if (!target) continue;
      addOutgoing(target, 'DEPENDS_ON', {
        description: rel.description,
        technology: rel.technology,
        async: rel.async,
        external: rel.external,
        external_info: rel.external_info,
      });
    }
  }

  if (entityType === 'component' && Array.isArray(relationships)) {
    handledRelationships = true;
    for (const rel of relationships) {
      if (typeof rel === 'string') {
        addOutgoing(rel, 'DEPENDS_ON');
        continue;
      }
      if (!isPlainObject(rel)) continue;
      const target = (rel.to as string | undefined) ?? (rel.target as string | undefined);
      if (!target) continue;
      addOutgoing(target, 'DEPENDS_ON', {
        description: rel.description,
      });
    }
  }

  // 自动建立层级关系：System CONTAINS Container / Container CONTAINS Component
  if (entityType === 'container') {
    const systemId =
      (typeof (data as Record<string, unknown>).system_id === 'string'
        ? (data as Record<string, unknown>).system_id
        : typeof (data as Record<string, unknown>).system === 'string'
          ? (data as Record<string, unknown>).system
          : isPlainObject((data as Record<string, unknown>).system)
            ? ((data as Record<string, unknown>).system as Record<string, unknown>).id
            : null) as string | null;
    if (systemId) {
      addIncoming(systemId, 'CONTAINS');
    }
  }

  if (entityType === 'component') {
    const containerId =
      (typeof (data as Record<string, unknown>).container_id === 'string'
        ? (data as Record<string, unknown>).container_id
        : typeof (data as Record<string, unknown>).container === 'string'
          ? (data as Record<string, unknown>).container
          : isPlainObject((data as Record<string, unknown>).container)
            ? ((data as Record<string, unknown>).container as Record<string, unknown>).id
            : null) as string | null;
    if (containerId) {
      addIncoming(containerId, 'CONTAINS');
    }
  }

  const systemData = isPlainObject(data.system) ? (data.system as Record<string, unknown>) : null;
  const sorData = isPlainObject(data.sor) ? (data.sor as Record<string, unknown>) : null;
  const correspondsTo =
    (systemData?.corresponds_to as string | undefined) ||
    (sorData?.corresponds_to as string | undefined);

  if (correspondsTo) {
    addOutgoing(correspondsTo, 'CORRESPONDS');
  }

  // 兼容旧格式：数组形式 [{ target, type, ... }]
  if (!handledRelationships && Array.isArray(relationships)) {
    for (const rel of relationships) {
      if (!isPlainObject(rel)) continue;
      const target = (rel.target as string | undefined) ?? (rel.to as string | undefined);
      if (!target) continue;
      const relType = normalizeRelationType(rel.type as string | undefined, 'DEPENDS_ON');
      addOutgoing(target, relType, rel.properties as Record<string, unknown> | undefined);
    }
  }

  // 兼容旧格式：对象形式 { dependencies: [...], uses: [...] }
  if (!handledRelationships && isPlainObject(relationships)) {
    for (const [relTypeKey, targets] of Object.entries(relationships)) {
      if (!Array.isArray(targets)) continue;
      const relType = normalizeRelationType(relTypeKey, 'DEPENDS_ON');
      for (const target of targets) {
        if (typeof target !== 'string') continue;
        addOutgoing(target, relType);
      }
    }
  }

  const referenceList = findReferences(data, entityType);
  for (const ref of referenceList) {
    addOutgoing(ref, 'REFERENCES');
  }

  return relations;
}

export interface RelationsChangeSet {
  added: Array<{ fromProject: string; fromId: string; toProject: string; toId: string; relType: string }>;
  removed: Array<{ fromProject: string; fromId: string; toProject: string; toId: string; relType: string }>;
  cacheKeys: string[];
}

function targetExistsInDatabase(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  toProject: string,
  toId: string,
  proposalId: string | null
): boolean {
  const dbProposalId = proposalId ?? '';
  if (dbProposalId === '') {
    return Boolean(
      db.prepare(`
        SELECT 1 FROM entities
        WHERE source_project = ? AND id = ?
          AND (proposal_id IS NULL OR proposal_id = '')
        LIMIT 1
      `).get(toProject, toId)
    );
  }

  return Boolean(
    db.prepare(`
      SELECT 1 FROM entities
      WHERE source_project = ? AND id = ?
        AND (proposal_id IS NULL OR proposal_id = '' OR proposal_id = ?)
      LIMIT 1
    `).get(toProject, toId, dbProposalId)
  );
}

function applyResolutionProperties(
  rel: { toProject: string; properties?: Record<string, unknown> | undefined },
  targetExists: boolean,
  sourceProject: string
): Record<string, unknown> | undefined {
  const props = { ...(rel.properties ?? {}) } as Record<string, unknown>;

  if (!targetExists) {
    props.resolved = false;
    if (rel.toProject !== sourceProject && props.resolve_status === undefined) {
      props.resolve_status = 'pending';
    }
  } else {
    if (props.resolved === false) {
      delete props.resolved;
    }
    if (props.resolve_status === 'pending') {
      delete props.resolve_status;
    }
  }

  return normalizeProperties(props);
}

/**
 * 持久化关系到数据库 (不更新内存图)
 * 必须在事务中调用
 */
export function persistRelations(
  ctx: AdapterContext,
  sourceProject: string | null | undefined,
  entityId: string,
  proposalId: string | null,
  relations: ParsedRelation[]
): RelationsChangeSet {
  const db = ctx.store.getDatabase();
  const now = new Date().toISOString();
  const dbProposalId = proposalId ?? '';
  const dbSourceProject = sourceProject ?? '';
  const proposalClause = dbProposalId === '' ? '(proposal_id = ? OR proposal_id IS NULL)' : 'proposal_id = ?';
  const toGraphProject = (value: string | null | undefined): string | null =>
    value === '' || value === null || value === undefined ? null : value;

  const normalizedRelations = relations.map((rel) => {
    const fromProject = toDbValue(rel.fromProject ?? sourceProject);
    const fromId = rel.fromId ?? entityId;
    return {
      ...rel,
      fromProject,
      fromId,
      toProject: toDbValue(rel.toProject),
      toId: rel.toId,
      relType: rel.relType,
    };
  });

  const preparedRelations = normalizedRelations.map((rel) => {
    const exists = targetExistsInDatabase(db, rel.toProject, rel.toId, proposalId);
    return {
      ...rel,
      properties: applyResolutionProperties(rel, exists, dbSourceProject),
    };
  });

  const desiredRelationKeys = new Set(
    preparedRelations.map((rel) =>
      buildRelationKey(rel.fromProject, rel.fromId, rel.toProject, rel.toId, rel.relType)
    )
  );

  const deletedRelations: Array<{
    from_project: string;
    from_id: string;
    to_project: string;
    to_id: string;
    rel_type: string;
    properties: Record<string, unknown> | null;
  }> = [];

  const changeSet: RelationsChangeSet = {
    added: [],
    removed: [],
    cacheKeys: [],
  };

  if (proposalId) {
    const mainOutgoing = db.prepare(`
      SELECT
        IFNULL(from_project, '') as from_project,
        from_id,
        IFNULL(to_project, '') as to_project,
        to_id,
        rel_type,
        properties
      FROM relations
      WHERE (proposal_id IS NULL OR proposal_id = '')
        AND IFNULL(from_project, '') = ?
        AND from_id = ?
        AND (status IS NULL OR status != 'deleted')
    `).all(dbSourceProject, entityId) as Array<{
      from_project: string;
      from_id: string;
      to_project: string;
      to_id: string;
      rel_type: string;
      properties: string | null;
    }>;

    const mainConsumers = db.prepare(`
      SELECT
        IFNULL(from_project, '') as from_project,
        from_id,
        IFNULL(to_project, '') as to_project,
        to_id,
        rel_type,
        properties
      FROM relations
      WHERE (proposal_id IS NULL OR proposal_id = '')
        AND IFNULL(to_project, '') = ?
        AND to_id = ?
        AND rel_type = 'DEPENDS_ON'
        AND (status IS NULL OR status != 'deleted')
    `).all(dbSourceProject, entityId) as Array<{
      from_project: string;
      from_id: string;
      to_project: string;
      to_id: string;
      rel_type: string;
      properties: string | null;
    }>;

    const deletedKeys = new Set<string>();
    const parseProps = (value: string | null): Record<string, unknown> | null => {
      if (!value) return null;
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return null;
      }
    };

    for (const rel of mainOutgoing) {
      const fromProject = toDbValue(rel.from_project);
      const toProject = toDbValue(rel.to_project);
      const key = buildRelationKey(fromProject, rel.from_id, toProject, rel.to_id, rel.rel_type);
      if (desiredRelationKeys.has(key) || deletedKeys.has(key)) continue;
      deletedKeys.add(key);
      deletedRelations.push({
        from_project: fromProject,
        from_id: rel.from_id,
        to_project: toProject,
        to_id: rel.to_id,
        rel_type: rel.rel_type,
        properties: parseProps(rel.properties),
      });
    }

    for (const rel of mainConsumers) {
      const parsed = parseProps(rel.properties);
      if (!parsed || parsed.origin !== 'system_consumers') continue;
      const fromProject = toDbValue(rel.from_project);
      const toProject = toDbValue(rel.to_project);
      const key = buildRelationKey(fromProject, rel.from_id, toProject, rel.to_id, rel.rel_type);
      if (desiredRelationKeys.has(key) || deletedKeys.has(key)) continue;
      deletedKeys.add(key);
      deletedRelations.push({
        from_project: fromProject,
        from_id: rel.from_id,
        to_project: toProject,
        to_id: rel.to_id,
        rel_type: rel.rel_type,
        properties: parsed,
      });
    }
  }

  // 删除由系统 consumers 生成的反向关系
  const incomingCandidates = db.prepare(`
    SELECT id, from_project, from_id, to_project, to_id, rel_type, properties
    FROM relations
    WHERE to_project = ? AND to_id = ? AND rel_type = 'DEPENDS_ON' AND ${proposalClause}
  `).all(dbSourceProject, entityId, dbProposalId) as Array<{
    id: string;
    from_project: string;
    from_id: string;
    to_project: string;
    to_id: string;
    rel_type: string;
    properties: string | null;
  }>;

  const incomingToDelete = incomingCandidates
    .filter((row) => {
      if (!row.properties) return false;
      try {
        const parsed = JSON.parse(row.properties) as Record<string, unknown>;
        return parsed.origin === 'system_consumers';
      } catch {
        return false;
      }
    })
    .map((row) => row.id);

  const incomingToDeleteSet = new Set(incomingToDelete);
  for (const row of incomingCandidates) {
    if (!incomingToDeleteSet.has(row.id)) continue;
    changeSet.removed.push({
      fromProject: toDbValue(row.from_project),
      fromId: row.from_id,
      toProject: toDbValue(row.to_project),
      toId: row.to_id,
      relType: row.rel_type,
    });
  }

  if (incomingToDelete.length > 0) {
    const placeholders = incomingToDelete.map(() => '?').join(', ');
    db.prepare(`DELETE FROM relations WHERE id IN (${placeholders})`).run(...incomingToDelete);
  }

  // 先查询旧关系，用于增量更新内存图 (如果是直接删除模式)
  const oldRelations = db.prepare(`
    SELECT to_project, to_id, rel_type FROM relations
    WHERE from_project = ? AND from_id = ? AND ${proposalClause}
  `).all(dbSourceProject, entityId, dbProposalId) as Array<{
    to_project: string;
    to_id: string;
    rel_type: string;
  }>;

  for (const rel of oldRelations) {
    changeSet.removed.push({
      fromProject: dbSourceProject,
      fromId: entityId,
      toProject: toDbValue(rel.to_project),
      toId: rel.to_id,
      relType: rel.rel_type,
    });
  }

  // 删除数据库中的旧关系
  db.prepare(`
    DELETE FROM relations
    WHERE from_project = ? AND from_id = ? AND ${proposalClause}
  `).run(dbSourceProject, entityId, dbProposalId);

  // 插入新关系
  const insertStmt = db.prepare(`
    INSERT INTO relations (id, proposal_id, from_project, from_id, to_project, to_id, rel_type, status, properties, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rel of preparedRelations) {
    const fromProject = rel.fromProject;
    const fromId = rel.fromId;
    const relId = randomUUID();
    insertStmt.run(
      relId,
      dbProposalId,
      fromProject,
      fromId,
      rel.toProject,
      rel.toId,
      rel.relType,
      'active',
      rel.properties ? JSON.stringify(rel.properties) : null,
      now,
      now
    );

    changeSet.added.push({
      fromProject,
      fromId,
      toProject: rel.toProject,
      toId: rel.toId,
      relType: rel.relType,
    });
  }

  if (proposalId && deletedRelations.length > 0) {
    for (const rel of deletedRelations) {
      const relId = randomUUID();
      insertStmt.run(
        relId,
        dbProposalId,
        rel.from_project,
        rel.from_id,
        rel.to_project,
        rel.to_id,
        rel.rel_type,
        'deleted',
        rel.properties ? JSON.stringify(rel.properties) : null,
        now,
        now
      );

      changeSet.removed.push({
        fromProject: rel.from_project,
        fromId: rel.from_id,
        toProject: rel.to_project,
        toId: rel.to_id,
        relType: rel.rel_type,
      });
    }
  }

  // Cache keys
  const cacheKeys = new Set<string>();
  const addCacheKeys = (project: string | null, id: string) => {
    for (const key of expandEntityCacheKeys(project, id)) {
      cacheKeys.add(key);
    }
  };

  const sourceProjectKey = toGraphProject(dbSourceProject);
  addCacheKeys(sourceProjectKey, entityId);

  for (const rel of preparedRelations) {
    addCacheKeys(toGraphProject(rel.fromProject), rel.fromId);
    addCacheKeys(toGraphProject(rel.toProject), rel.toId);
  }

  for (const rel of oldRelations) {
    addCacheKeys(sourceProjectKey, entityId);
    addCacheKeys(toGraphProject(rel.to_project), rel.to_id);
  }

  for (const rel of deletedRelations) {
    addCacheKeys(toGraphProject(rel.from_project), rel.from_id);
    addCacheKeys(toGraphProject(rel.to_project), rel.to_id);
  }

  changeSet.cacheKeys = Array.from(cacheKeys);
  return changeSet;
}

/**
 * 更新内存图和缓存
 */
export function updateGraph(ctx: AdapterContext, changeset: RelationsChangeSet): void {
  const toGraphProject = (value: string | null | undefined): string | null =>
    value === '' || value === null || value === undefined ? null : value;
  const toDbProject = (value: string | null | undefined): string => value ?? '';
  const db = ctx.store.getDatabase();
  const proposalId = ctx.graph.getProposalId();

  const fetchEntityType = (project: string | null | undefined, id: string): string | null => {
    const dbProject = toDbProject(project);
    if (proposalId) {
      const row = db
        .prepare(
          `
          SELECT type
          FROM entities
          WHERE source_project = ? AND id = ?
            AND (proposal_id = ? OR proposal_id IS NULL OR proposal_id = '')
          ORDER BY CASE
            WHEN proposal_id = ? THEN 1
            WHEN proposal_id IS NULL OR proposal_id = '' THEN 2
            ELSE 3
          END
          LIMIT 1
        `
        )
        .get(dbProject, id, proposalId, proposalId) as { type?: string } | undefined;
      return row?.type ?? null;
    }

    const row = db
      .prepare(
        `
        SELECT type
        FROM entities
        WHERE source_project = ? AND id = ?
          AND (proposal_id IS NULL OR proposal_id = '')
        LIMIT 1
      `
      )
      .get(dbProject, id) as { type?: string } | undefined;
    return row?.type ?? null;
  };

  for (const rel of changeset.removed) {
    ctx.graph.removeRelation(
      toGraphProject(rel.fromProject),
      rel.fromId,
      toGraphProject(rel.toProject),
      rel.toId,
      rel.relType
    );
  }

  for (const rel of changeset.added) {
    const fromType = fetchEntityType(rel.fromProject, rel.fromId);
    const toType = fetchEntityType(rel.toProject, rel.toId);
    ctx.graph.addRelation(
      toGraphProject(rel.fromProject),
      rel.fromId,
      toGraphProject(rel.toProject),
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

/**
 * 保存关系到数据库并更新内存图 (旧版兼容接口)
 * @deprecated 请使用 persistRelations 和 updateGraph 分开处理
 */
export function saveRelations(
  ctx: AdapterContext,
  sourceProject: string | null | undefined,
  entityId: string,
  proposalId: string | null,
  relations: ParsedRelation[],
  options?: { inTransaction?: boolean }
): void {
  const run = (): void => {
    const changeset = persistRelations(ctx, sourceProject, entityId, proposalId, relations);
    updateGraph(ctx, changeset);
  };

  if (options?.inTransaction) {
    run();
    return;
  }

  const db = ctx.store.getDatabase();
  db.transaction(run)();
}
