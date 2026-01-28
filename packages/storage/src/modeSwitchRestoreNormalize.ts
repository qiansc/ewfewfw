/**
 * Local Restore 数据验证与归一化
 */

import type { ExportData, ExportEntity, ExportFeat, ExportRelation } from './modeSwitchTypes.js';
import * as converter from '@c4a/core';

type ConvertedEntity = Record<string, unknown> & {
  id?: string;
  kind?: string;
  scope?: string;
  perspective?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toInternalEntity(rawData: Record<string, unknown>): ConvertedEntity | null {
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

export function normalizeExportData(data: ExportData): ExportData {
  return {
    ...data,
    entities: data.entities.map((entity) => normalizeExportEntity(entity)),
    relations: data.relations.map((relation) => normalizeExportRelation(relation)),
    feats: data.feats,
  };
}

export function normalizeExportEntity(entity: ExportEntity): ExportEntity {
  const normalizedMetadata = {
    ...entity.metadata,
    source_project: entity.metadata.source_project ?? '',
  };
  const data = isPlainObject(entity.data) ? { ...entity.data } : entity.data;
  const normalized: ExportEntity = {
    ...entity,
    proposal_id: entity.proposal_id === '' ? null : entity.proposal_id ?? null,
    data,
    metadata: normalizedMetadata,
  };

  // ADR title/name 兼容
  if (normalized.type === 'adr' && isPlainObject(data)) {
    const adr = data.adr;
    if (isPlainObject(adr)) {
      const nextAdr = { ...adr };
      if (!('title' in nextAdr) && typeof nextAdr.name === 'string') {
        nextAdr.title = nextAdr.name;
      }
      if ('name' in nextAdr) {
        delete nextAdr.name;
      }
      data.adr = nextAdr;
    }
  }

  // Contract component_id 兼容（旧字段移除）
  if (normalized.type === 'contract' && isPlainObject(data)) {
    const contract = data.contract;
    if (isPlainObject(contract) && 'component_id' in contract) {
      const nextContract = { ...contract };
      delete nextContract.component_id;
      data.contract = nextContract;
    }
  }

  const converted = isPlainObject(data) ? toInternalEntity(data) : null;
  const fallbackKind = pickString((data as Record<string, unknown>)?.kind);
  const fallbackScope = pickString((data as Record<string, unknown>)?.scope);
  const fallbackPerspective = pickString((data as Record<string, unknown>)?.perspective);

  normalized.kind =
    pickString(normalized.kind) ??
    pickString(converted?.kind) ??
    fallbackKind;
  normalized.scope =
    pickString(normalized.scope) ??
    pickString(converted?.scope) ??
    fallbackScope;
  normalized.perspective =
    pickString(normalized.perspective) ??
    pickString(converted?.perspective) ??
    fallbackPerspective;

  return normalized;
}

export function normalizeExportRelation(relation: ExportRelation): ExportRelation {
  return {
    ...relation,
    proposal_id: relation.proposal_id === '' ? null : relation.proposal_id ?? null,
    from_project: relation.from_project === null ? '' : relation.from_project,
    to_project: relation.to_project === null ? '' : relation.to_project,
  };
}

export function validateExportData(
  data: unknown,
  isCompatibleVersion: (version: string) => boolean
): ExportData {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid export data: expected object');
  }

  const obj = data as Record<string, unknown>;

  // 验证版本
  if (typeof obj.version !== 'string') {
    throw new Error('Invalid export data: missing version');
  }
  if (!isCompatibleVersion(obj.version)) {
    throw new Error(`Unsupported export version: ${obj.version}`);
  }

  // 验证 exported_at
  if (typeof obj.exported_at !== 'string') {
    throw new Error('Invalid export data: missing exported_at');
  }

  // 验证 entities
  if (!Array.isArray(obj.entities)) {
    throw new Error('Invalid export data: entities must be an array');
  }

  for (const entity of obj.entities) {
    validateEntity(entity);
  }

  // 验证 relations
  if (!Array.isArray(obj.relations)) {
    throw new Error('Invalid export data: relations must be an array');
  }

  for (const relation of obj.relations) {
    validateRelation(relation);
  }

  // feats 可选（旧版本可能缺失）
  const feats = Array.isArray(obj.feats) ? obj.feats : [];
  for (const feat of feats) {
    validateFeat(feat);
  }

  return {
    version: obj.version,
    exported_at: obj.exported_at,
    entities: obj.entities as ExportEntity[],
    relations: obj.relations as ExportRelation[],
    feats: feats as ExportFeat[],
  };
}

export function validateEntity(entity: unknown): void {
  if (!entity || typeof entity !== 'object') {
    throw new Error('Invalid entity: expected object');
  }

  const e = entity as Record<string, unknown>;

  if (typeof e.id !== 'string') {
    throw new Error('Invalid entity: missing id');
  }
  if (typeof e.type !== 'string') {
    throw new Error(`Invalid entity ${e.id}: missing type`);
  }
  if (!e.data || typeof e.data !== 'object') {
    throw new Error(`Invalid entity ${e.id}: missing data`);
  }
  if (!e.metadata || typeof e.metadata !== 'object') {
    throw new Error(`Invalid entity ${e.id}: missing metadata`);
  }

  const m = e.metadata as Record<string, unknown>;
  if (m.source_project !== null && typeof m.source_project !== 'string') {
    throw new Error(`Invalid entity ${e.id}: invalid metadata.source_project`);
  }
  if (typeof m.status !== 'string') {
    throw new Error(`Invalid entity ${e.id}: missing metadata.status`);
  }
  if (typeof m.created_at !== 'string') {
    throw new Error(`Invalid entity ${e.id}: missing metadata.created_at`);
  }
  if (typeof m.updated_at !== 'string') {
    throw new Error(`Invalid entity ${e.id}: missing metadata.updated_at`);
  }
  if (m.source_repo !== undefined && typeof m.source_repo !== 'string') {
    throw new Error(`Invalid entity ${e.id}: invalid metadata.source_repo`);
  }
  if (m.content_hash !== undefined && typeof m.content_hash !== 'string') {
    throw new Error(`Invalid entity ${e.id}: invalid metadata.content_hash`);
  }
  if (e.proposal_id !== undefined && e.proposal_id !== null && typeof e.proposal_id !== 'string') {
    throw new Error(`Invalid entity ${e.id}: invalid proposal_id`);
  }
}

export function validateRelation(relation: unknown): void {
  if (!relation || typeof relation !== 'object') {
    throw new Error('Invalid relation: expected object');
  }

  const r = relation as Record<string, unknown>;

  if (r.id !== undefined && typeof r.id !== 'string') {
    throw new Error('Invalid relation: invalid id');
  }
  if (r.proposal_id !== undefined && r.proposal_id !== null && typeof r.proposal_id !== 'string') {
    throw new Error('Invalid relation: invalid proposal_id');
  }
  if (r.from_project !== undefined && r.from_project !== null && typeof r.from_project !== 'string') {
    throw new Error('Invalid relation: invalid from_project');
  }
  if (typeof r.from_id !== 'string') {
    throw new Error('Invalid relation: missing from_id');
  }
  if (r.to_project !== undefined && r.to_project !== null && typeof r.to_project !== 'string') {
    throw new Error('Invalid relation: invalid to_project');
  }
  if (typeof r.to_id !== 'string') {
    throw new Error('Invalid relation: missing to_id');
  }
  if (typeof r.rel_type !== 'string') {
    throw new Error('Invalid relation: missing rel_type');
  }
  if (r.status !== undefined && r.status !== 'active' && r.status !== 'deleted') {
    throw new Error('Invalid relation: invalid status');
  }
  if (r.properties !== undefined && r.properties !== null && typeof r.properties !== 'object') {
    throw new Error('Invalid relation: invalid properties');
  }
}

export function validateFeat(feat: unknown): void {
  if (!feat || typeof feat !== 'object') {
    throw new Error('Invalid feat: expected object');
  }

  const f = feat as Record<string, unknown>;

  if (typeof f.id !== 'string') {
    throw new Error('Invalid feat: missing id');
  }
  if (typeof f.status !== 'string') {
    throw new Error(`Invalid feat ${f.id}: missing status`);
  }
  if (typeof f.created_at !== 'string') {
    throw new Error(`Invalid feat ${f.id}: missing created_at`);
  }
  if (typeof f.updated_at !== 'string') {
    throw new Error(`Invalid feat ${f.id}: missing updated_at`);
  }
  if (f.checklist !== undefined && f.checklist !== null && typeof f.checklist !== 'object') {
    throw new Error(`Invalid feat ${f.id}: invalid checklist`);
  }
}
