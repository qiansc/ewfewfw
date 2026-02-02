/**
 * LiteAdapter Save 辅助函数
 */

import type { EntityStatus } from '../adapter.js';
import type { AdapterContext } from './types.js';
import { generateEntityId, getInitialSequence, incrementSequence } from '@c4a/core';
import * as converter from '@c4a/core';

type Database = ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>;

type ConvertedEntity = Record<string, unknown> & {
  id?: string;
  kind?: string;
  scope?: string;
  perspective?: string;
};

// ============================================================
// Diff helpers
// ============================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function diffFields(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  prefix = ''
): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const diffs: string[] = [];

  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const prevValue = previous[key];
    const nextValue = next[key];

    if (isPlainObject(prevValue) && isPlainObject(nextValue)) {
      diffs.push(...diffFields(prevValue, nextValue, path));
      continue;
    }

    if (JSON.stringify(prevValue) !== JSON.stringify(nextValue)) {
      diffs.push(path);
    }
  }

  return diffs;
}

export function resolveDanglingRelations(
  db: Database,
  sourceProject: string,
  entityId: string
): boolean {
  const rows = db.prepare(`
    SELECT id, to_project, properties
    FROM relations
    WHERE to_id = ?
      AND (status IS NULL OR status != 'deleted')
  `).all(entityId) as Array<{
    id: string;
    to_project: string | null;
    properties: string | null;
  }>;

  if (rows.length === 0) return false;

  const now = new Date().toISOString();
  const updateStmt = db.prepare(`
    UPDATE relations
    SET to_project = ?, properties = ?, updated_at = ?
    WHERE id = ?
  `);

  let updated = false;
  for (const row of rows) {
    let props: Record<string, unknown> = {};
    if (row.properties) {
      try {
        props = JSON.parse(row.properties) as Record<string, unknown>;
      } catch {
        props = {};
      }
    }

    const isDangling =
      props.resolved === false || props.resolve_status === 'pending';
    if (!isDangling) continue;

    const toProject = row.to_project ?? '';
    const targetProject =
      typeof props.target_project === 'string' ? props.target_project : null;
    const shouldResolve =
      toProject === sourceProject || toProject === '' || targetProject === sourceProject;

    if (!shouldResolve) continue;

    delete props.resolved;
    if (props.resolve_status === 'pending') {
      delete props.resolve_status;
    }

    const nextProject = toProject === '' ? sourceProject : toProject;
    const nextProps = Object.keys(props).length > 0 ? JSON.stringify(props) : null;
    updateStmt.run(nextProject, nextProps, now, row.id);
    updated = true;
  }

  return updated;
}

export function toInternalEntity(rawData: Record<string, unknown>): ConvertedEntity | null {
  if (converter.isProductDSL(rawData)) {
    return converter.dslToProduct(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isSystemDSL(rawData)) {
    return converter.dslToSystem(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isContainerDSL(rawData)) {
    return converter.dslToContainer(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isComponentDSL(rawData)) {
    return converter.dslToComponent(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isProcessDSL(rawData)) {
    return converter.dslToProcess(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isSoRDSL(rawData)) {
    return converter.dslToSoR(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isADRDSL(rawData)) {
    return converter.dslToADR(rawData) as unknown as ConvertedEntity;
  }
  if (converter.isContractDSL(rawData)) {
    return converter.dslToContract(rawData) as unknown as ConvertedEntity;
  }
  return null;
}

export function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function isEntityStatus(value: string | null): value is EntityStatus {
  if (!value) return false;
  return ['draft', 'approved', 'published', 'deprecated', 'archived'].includes(value);
}

function getNameForAutoId(type: string, rawData: Record<string, unknown>): string | null {
  const rootName = pickString(rawData.name as string | null);
  if (rootName) return rootName;
  const block = rawData[type];
  if (isPlainObject(block)) {
    const blockName = pickString(block.name as string | null);
    if (blockName) return blockName;
    if (type === 'adr') {
      const title = pickString((block as Record<string, unknown>).title as string | null);
      if (title) return title;
    }
  }
  if (type === 'adr') {
    return pickString(rawData.title as string | null);
  }
  return null;
}

function resolveSorPerspectiveFromType(sorType: string | null): 'business' | 'technical' | null {
  if (!sorType) return null;
  const businessTypes = new Set([
    'business_rule',
    'business_data',
    'report',
    'communication',
    'user_interface',
    'kpi',
  ]);
  const technicalTypes = new Set(['non_functional', 'utility', 'message']);
  if (businessTypes.has(sorType)) return 'business';
  if (technicalTypes.has(sorType)) return 'technical';
  return null;
}

function getPerspectiveForAutoId(
  type: string,
  rawData: Record<string, unknown>
): 'business' | 'technical' | null {
  const direct = pickString(rawData.perspective as string | null);
  if (direct === 'business' || direct === 'technical') {
    return direct;
  }
  if (type === 'process') {
    const block = rawData.process;
    const processType = isPlainObject(block)
      ? pickString((block as Record<string, unknown>).process_type as string | null)
      : pickString(rawData.process_type as string | null);
    if (processType === 'business' || processType === 'technical') {
      return processType;
    }
  }
  if (type === 'sor') {
    const block = rawData.sor;
    const sorType = isPlainObject(block)
      ? pickString((block as Record<string, unknown>).sor_type as string | null)
      : pickString(rawData.sor_type as string | null);
    return resolveSorPerspectiveFromType(sorType);
  }
  return null;
}

function extractSequenceFromId(id: string, prefix: string): string | null {
  if (!id.startsWith(`${prefix}-`)) return null;
  const rest = id.slice(prefix.length + 1);
  if (prefix === 'adr' || prefix === 'feat') {
    const match = rest.match(/^([a-z]\d{3})(?:-.+)?$/);
    return match?.[1] ?? null;
  }
  const match = rest.match(/^([a-z]\d{3})$/);
  return match?.[1] ?? null;
}

function compareSequence(a: string, b: string): number {
  const letterDelta = a.charCodeAt(0) - b.charCodeAt(0);
  if (letterDelta !== 0) return letterDelta;
  return Number(a.slice(1)) - Number(b.slice(1));
}

function getNextSequence(
  db: ReturnType<AdapterContext['store']['getDatabase']>,
  sourceProject: string,
  prefix: string
): string {
  const rows = db
    .prepare('SELECT id FROM entities WHERE source_project = ? AND id LIKE ?')
    .all(sourceProject, `${prefix}-%`) as Array<{ id: string }>;
  let maxSequence: string | null = null;
  for (const row of rows) {
    const sequence = extractSequenceFromId(row.id, prefix);
    if (!sequence) continue;
    if (!maxSequence || compareSequence(sequence, maxSequence) > 0) {
      maxSequence = sequence;
    }
  }
  return maxSequence ? incrementSequence(maxSequence) : getInitialSequence();
}

export function applyGeneratedId(type: string, rawData: Record<string, unknown>, id: string): void {
  if (!rawData.id) {
    rawData.id = id;
  }
  const block = rawData[type];
  if (isPlainObject(block) && !block.id) {
    (block as Record<string, unknown>).id = id;
  }
}

export function generateAutoId(
  db: ReturnType<AdapterContext['store']['getDatabase']>,
  sourceProject: string,
  type: string,
  rawData: Record<string, unknown>
): string | null {
  const name = getNameForAutoId(type, rawData);
  if (!name) return null;
  switch (type) {
    case 'system':
    case 'container':
    case 'component':
    case 'product':
    case 'contract':
      return generateEntityId(type, name);
    case 'adr': {
      const sequence = getNextSequence(db, sourceProject, 'adr');
      return generateEntityId('adr', name, sequence);
    }
    case 'process': {
      const perspective = getPerspectiveForAutoId('process', rawData);
      if (!perspective) return null;
      const prefix = perspective === 'business' ? 'prc-b' : 'prc-t';
      const sequence = getNextSequence(db, sourceProject, prefix);
      return generateEntityId('process', name, sequence, perspective);
    }
    case 'sor': {
      const perspective = getPerspectiveForAutoId('sor', rawData);
      if (!perspective) return null;
      const prefix = perspective === 'business' ? 'sor-b' : 'sor-t';
      const sequence = getNextSequence(db, sourceProject, prefix);
      return generateEntityId('sor', name, sequence, perspective);
    }
    default:
      return null;
  }
}

