/**
 * Local 模式备份
 */

import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SQLiteStore } from './sqlite-store.js';
import type { EntityType, EntityStatus } from './adapter.js';
import type {
  BackupOptions,
  BackupResult,
  ExportData,
  ExportEntity,
  ExportRelation,
  ExportFeat,
  BackupProgress,
} from './modeSwitchTypes.js';
import { EXPORT_VERSION } from './modeSwitchTypes.js';
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

function normalizeExportEntity(
  entityType: EntityType,
  data: Record<string, unknown>,
  kind: string | null,
  scope: string | null,
  perspective: string | null
): { data: Record<string, unknown>; kind?: string; scope?: string; perspective?: string } {
  const normalizedData = { ...data };

  if (entityType === 'adr') {
    const adr = normalizedData.adr;
    if (isPlainObject(adr)) {
      const nextAdr = { ...adr };
      if (!('title' in nextAdr) && typeof nextAdr.name === 'string') {
        nextAdr.title = nextAdr.name;
      }
      if ('name' in nextAdr) {
        delete nextAdr.name;
      }
      normalizedData.adr = nextAdr;
    }
  }

  if (entityType === 'contract') {
    const contract = normalizedData.contract;
    if (isPlainObject(contract) && 'component_id' in contract) {
      const nextContract = { ...contract };
      delete nextContract.component_id;
      normalizedData.contract = nextContract;
    }
  }

  const converted = toInternalEntity(normalizedData);
  const normalizedKind = pickString(kind) ?? pickString(converted?.kind);
  const normalizedScope = pickString(scope) ?? pickString(converted?.scope);
  const normalizedPerspective = pickString(perspective) ?? pickString(converted?.perspective);

  return {
    data: normalizedData,
    kind: normalizedKind,
    scope: normalizedScope,
    perspective: normalizedPerspective,
  };
}

/**
 * Local 模式备份工具
 *
 * 设计文档: mode-switch.md §5.2.1
 */
export class LocalBackup {
  private store: SQLiteStore;

  constructor(store?: SQLiteStore) {
    this.store = store || SQLiteStore.getInstance();
  }

  /**
   * 创建备份
   *
   * 设计文档: mode-switch.md §5.4
   */
  async backup(options: BackupOptions): Promise<BackupResult> {
    const db = this.store.getDatabase();
    const reportProgress = (
      phase: BackupProgress['phase'],
      current: number,
      total: number,
      message?: string
    ): void => {
      if (!options.onProgress) return;
      options.onProgress({ phase, current, total, message });
    };

    if (options.includeVectors) {
      throw new Error('includeVectors is not supported: vectors are rebuilt during restore');
    }

    // 导出实体（包含 kind, scope, perspective）
    interface RawEntity {
      id: string;
      type: EntityType;
      kind: string | null;
      scope: string | null;
      perspective: string | null;
      source_project: string;
      source_repo: string | null;
      proposal_id: string | null;
      data: string;
      status: EntityStatus;
      content_hash: string;
      created_at: string;
      updated_at: string;
    }

    const rawEntities = db.prepare(`
      SELECT e.id, e.type, e.kind, e.scope, e.perspective,
             e.source_project, e.proposal_id, e.data,
             m.source_repo, m.status, m.content_hash, m.created_at, m.updated_at
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    `).all() as RawEntity[];

    // 转换为导出格式（修复 legacy 字段）
    const entities: ExportEntity[] = [];
    let index = 0;
    for (const e of rawEntities) {
      const rawData = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      const normalized = isPlainObject(rawData)
        ? normalizeExportEntity(e.type, rawData, e.kind, e.scope, e.perspective)
        : {
          data: rawData,
          kind: e.kind || undefined,
          scope: e.scope || undefined,
          perspective: e.perspective || undefined,
        };

      entities.push({
        id: e.id,
        type: e.type,
        kind: normalized.kind,
        scope: normalized.scope,
        perspective: normalized.perspective,
        data: normalized.data,
        metadata: {
          source_project: e.source_project,
          source_repo: e.source_repo || undefined,
          status: e.status,
          content_hash: e.content_hash,
          created_at: e.created_at,
          updated_at: e.updated_at,
        },
        proposal_id: e.proposal_id === '' ? null : e.proposal_id,
      });
      index += 1;
      reportProgress('entities', index, rawEntities.length);
    }

    // 导出关系
    interface RawRelation {
      id: string;
      proposal_id: string | null;
      from_project: string | null;
      from_id: string;
      to_project: string | null;
      to_id: string;
      rel_type: string;
      status: string | null;
      properties: string | null;
    }

    const rawRelations = db.prepare(`
      SELECT id, proposal_id, from_project, from_id, to_project, to_id, rel_type, status, properties
      FROM relations
    `).all() as RawRelation[];

    const relations: ExportRelation[] = [];
    index = 0;
    for (const r of rawRelations) {
      relations.push({
        id: r.id,
        proposal_id: r.proposal_id === '' ? null : r.proposal_id,
        from_project: r.from_project,
        from_id: r.from_id,
        to_project: r.to_project,
        to_id: r.to_id,
        rel_type: r.rel_type,
        status: (r.status as ExportRelation['status']) || 'active',
        properties: r.properties ? JSON.parse(r.properties) : null,
      });
      index += 1;
      reportProgress('relations', index, rawRelations.length);
    }

    // 导出 feats（包含 checklist）
    interface RawFeat {
      id: string;
      status: string;
      title: string | null;
      description: string | null;
      created_by: string | null;
      checklist: string | null;
      created_at: string;
      updated_at: string;
    }

    const rawFeats = db.prepare(`
      SELECT id, status, title, description, created_by, checklist, created_at, updated_at
      FROM feats
    `).all() as RawFeat[];

    const feats: ExportFeat[] = [];
    index = 0;
    for (const f of rawFeats) {
      feats.push({
        id: f.id,
        status: f.status,
        title: f.title || undefined,
        description: f.description || undefined,
        created_by: f.created_by || undefined,
        checklist: f.checklist ? JSON.parse(f.checklist) : undefined,
        created_at: f.created_at,
        updated_at: f.updated_at,
      });
      index += 1;
      reportProgress('feats', index, rawFeats.length);
    }

    const exportData: ExportData = {
      version: EXPORT_VERSION,
      exported_at: new Date().toISOString(),
      entities,
      relations,
      feats,
    };

    // 写入文件
    const outputDir = dirname(options.output);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    reportProgress('write', 0, 1);
    const jsonContent = JSON.stringify(exportData, null, 2);

    if (options.compress !== false) {
      // 压缩输出
      const gzipPath = options.output.endsWith('.gz')
        ? options.output
        : `${options.output}.gz`;

      await pipeline(Readable.from(jsonContent), createGzip(), createWriteStream(gzipPath));

      reportProgress('done', 1, 1);
      return {
        success: true,
        output: gzipPath,
        stats: {
          entities: entities.length,
          relations: relations.length,
          feats: feats.length,
          vectors: 0,
        },
        size: Buffer.byteLength(jsonContent),
      };
    }

    await writeFile(options.output, jsonContent, 'utf-8');

    reportProgress('done', 1, 1);
    return {
      success: true,
      output: options.output,
      stats: {
        entities: entities.length,
        relations: relations.length,
        feats: feats.length,
        vectors: 0,
      },
      size: Buffer.byteLength(jsonContent),
    };
  }
}
