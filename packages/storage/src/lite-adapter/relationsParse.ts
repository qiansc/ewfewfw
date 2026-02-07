/**
 * LiteAdapter 关系解析
 */

import type { EntityType } from '../adapter.js';
import { resolveReference } from '../data-ops/reference/resolver.js';
import type { ReferenceCandidate, ResolvedReference } from '../data-ops/reference/types.js';
import type { AdapterContext, ParsedRelation } from './types.js';

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

function toNullableProject(value: string | null | undefined): string | null {
  if (!value) return null;
  return value;
}

function buildReferenceLookup(
  ctx: AdapterContext,
  _requirementId: string | null | undefined
): (id: string) => ReferenceCandidate[] {
  const db = ctx.store.getDatabase();

  return (id: string): ReferenceCandidate[] => {
    const rows = db.prepare(`
      SELECT e.id, e.root_id, e.scope, m.source_repo
      FROM entities e
      JOIN metadata m ON e.uuid = m.entity_uuid
      JOIN entity_versions v ON e.uuid = v.entity_uuid
      WHERE e.id = ? AND v.version = '0.0.0'
    `).all(id) as Array<{
      id: string;
      root_id: string;
      scope: string | null;
      source_repo: string | null;
    }>;

    const unique = new Map<string, ReferenceCandidate>();
    for (const row of rows) {
      const rootId = toNullableProject(row.root_id);
      const sourceRepo = row.source_repo ?? null;
      const scope = (row.scope ?? null) as ReferenceCandidate['scope'];
      const key = `${rootId ?? ''}|${sourceRepo ?? ''}|${scope ?? ''}`;
      if (unique.has(key)) continue;
      unique.set(key, {
        id: row.id,
        rootId,
        sourceRepo,
        scope,
      });
    }

    return Array.from(unique.values());
  };
}

function createReferenceResolver(
  ctx: AdapterContext,
  rootId: string,
  requirementId: string | null | undefined
): (ref: string) => ResolvedReference {
  return (ref: string) =>
    resolveReference(ref, {
      rootId,
      repoId: ctx.config.repoId ?? null,
      lookup: buildReferenceLookup(ctx, requirementId),
    });
}

function resolveTarget(ref: string, resolver: (ref: string) => ResolvedReference): {
  toRootId: string;
  toId: string;
  properties?: Record<string, unknown>;
} {
  const resolved = resolver(ref);
  const properties: Record<string, unknown> = {};
  const toId = resolved.id;
  const toRootId = resolved.targetRootId ?? '';

  if (resolved.targetRepo) {
    properties.target_repo = resolved.targetRepo;
  }
  if (resolved.targetRootId) {
    properties.target_root_id = resolved.targetRootId;
  }
  if (resolved.scope) {
    properties.target_scope = resolved.scope;
  }

  return {
    toRootId,
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
    feat: 'feat',
    checklist: 'checklist',
    spec: 'spec',
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
  rootId: string | null | undefined,
  entityId: string,
  entityType: EntityType,
  requirementId?: string | null
): ParsedRelation[] {
  const relations: ParsedRelation[] = [];
  const relationKeys = new Set<string>();
  let handledRelationships = false;
  const normalizedSourceRoot = rootId ?? '';
  const resolver = createReferenceResolver(ctx, normalizedSourceRoot, requirementId);

  const pushRelation = (relation: ParsedRelation) => {
    const fromRootId = relation.fromRootId ?? rootId;
    const fromId = relation.fromId ?? entityId;
    const key = `${fromRootId}|${fromId}|${relation.toRootId}|${relation.toId}|${relation.relType}`;
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
    relations.push(relation);
  };

  const addOutgoing = (targetRef: string, relType: string, props?: Record<string, unknown>) => {
    const resolved = resolveTarget(targetRef, resolver);
    pushRelation({
      toRootId: resolved.toRootId,
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
      fromRootId: resolved.toRootId,
      fromId: resolved.toId,
      toRootId: normalizedSourceRoot,
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
