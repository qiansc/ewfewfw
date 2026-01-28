/**
 * LiteAdapter Save 操作
 */

import { getWriteQueue } from '../write-queue.js';
import { generateEmbedding, generateVectorKey } from '../vector-search.js';
import type { EntityStatus, SaveParams, SaveResult, Warning } from '../adapter.js';
import type { AdapterContext } from './types.js';
import { computeHash, generateSearchText, parseContent } from './helpers.js';
import { parseRelations, persistRelations, updateGraph, type RelationsChangeSet } from './relations.js';
import * as converter from '@c4a/core';

// ============================================================
// Diff helpers
// ============================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diffFields(
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

type ConvertedEntity = Record<string, unknown> & {
  id?: string;
  kind?: string;
  scope?: string;
  perspective?: string;
};

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

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// ============================================================
// Save 操作
// ============================================================

/**
 * 保存实体（使用写队列串行化）
 */
export async function save(ctx: AdapterContext, params: SaveParams): Promise<SaveResult> {
  return getWriteQueue().enqueue(async () => {
    return doSave(ctx, params);
  });
}

/**
 * 实际执行保存操作
 */
async function doSave(ctx: AdapterContext, params: SaveParams): Promise<SaveResult> {
  const db = ctx.store.getDatabase();
  const now = new Date().toISOString();
  const warnings: Warning[] = [];

  // 解析数据
  let rawData: Record<string, unknown>;
  if (params.data) {
    rawData = params.data;
  } else if (params.content) {
    rawData = parseContent(params.content, params.format || 'yaml');
  } else {
    throw new Error('Either data or content must be provided');
  }

  // 转换 DSL -> Internal Entity（用于提取 kind/scope/perspective）
  const converted = toInternalEntity(rawData);
  const storedData = rawData;

  // 提取 ID
  const id = params.id || converted?.id || (rawData.id as string);
  if (!id) {
    throw new Error('Entity ID is required');
  }

  const sourceProject = params.source_project || ctx.config.defaultProject;
  const proposalId = params.proposal_id ?? null;
  const dbProposalId = proposalId ?? '';
  const dbSourceProject = sourceProject ?? '';

  // 计算 content_hash
  const contentHash = computeHash(storedData);

  // 检查是否存在并读取旧数据
  const existingQuery = dbProposalId === ''
    ? `
    SELECT e.data as data, m.content_hash, m.created_by, m.updated_by
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE e.source_project = ? AND e.id = ? AND (e.proposal_id IS NULL OR e.proposal_id = '')
  `
    : `
    SELECT e.data as data, m.content_hash, m.created_by, m.updated_by
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE e.source_project = ? AND e.id = ? AND e.proposal_id = ?
  `;
  const existingParams = dbProposalId === '' ? [dbSourceProject, id] : [dbSourceProject, id, dbProposalId];
  const existing = db.prepare(existingQuery).get(...existingParams) as
    | { data: string; content_hash: string; created_by: string | null; updated_by: string | null }
    | undefined;

  const previousData = existing?.data ? (JSON.parse(existing.data) as Record<string, unknown>) : null;

  // 3.18 并发修改预警：检查是否有其他活跃 feat 也在修改同一实体
  // 设计文档: store-feat-checklist.md §3.10
  if (existing && proposalId && !params.ignore_concurrent_warning) {
    const concurrentFeats = db.prepare(`
      SELECT e.proposal_id, m.updated_at, m.updated_by, f.status as feat_status, f.title
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      LEFT JOIN feats f ON e.proposal_id = f.id
      WHERE e.id = ?
        AND e.source_project = ?
        AND e.proposal_id IS NOT NULL
        AND e.proposal_id != ''
        AND e.proposal_id != ?
        AND (f.status IS NULL OR f.status IN ('draft', 'approved'))
    `).all(id, dbSourceProject, dbProposalId) as Array<{
      proposal_id: string;
      updated_at: string;
      updated_by: string | null;
      feat_status: string | null;
      title: string | null;
    }>;

    if (concurrentFeats.length > 0) {
      warnings.push({
        code: 'CONCURRENT_MODIFICATION',
        message: `实体 ${id} 正在被其他 feat 修改`,
        severity: 'warning',
        details: {
          concurrent_feats: concurrentFeats.map(f => ({
            feat_id: f.proposal_id,
            status: f.feat_status || 'unknown',
            updated_by: f.updated_by,
            updated_at: f.updated_at,
            title: f.title,
          })),
        },
      });
    }
  }

  // 确定状态
  const status: EntityStatus = proposalId ? 'draft' : 'published';

  const changeActor =
    (storedData.updated_by as string | undefined) ||
    (storedData.created_by as string | undefined) ||
    ((storedData.metadata as Record<string, unknown> | undefined)?.updated_by as string | undefined) ||
    ((storedData.metadata as Record<string, unknown> | undefined)?.created_by as string | undefined);

  const createdBy =
    existing?.created_by ??
    (storedData.created_by as string | undefined) ??
    ((storedData.metadata as Record<string, unknown> | undefined)?.created_by as string | undefined) ??
    null;

  const updatedBy = changeActor ?? existing?.updated_by ?? createdBy ?? null;

  const changedFields = previousData ? diffFields(previousData, storedData) : Object.keys(storedData);

  // P1-2.1: ADR 检查逻辑
  // 设计文档: store-crud.md §3.1
  let adrCheck: SaveResult['adr_check'];
  if (
    !params.skip_adr_check &&
    ['system', 'container', 'component'].includes(params.type) &&
    status === 'published'
  ) {
    // 检查是否存在关联的 ADR
    const adrQuery = dbProposalId === ''
      ? `
      SELECT 1 FROM relations r
      JOIN entities e ON r.to_project = e.source_project AND r.to_id = e.id
      WHERE r.from_id = ? AND r.from_project = ?
        AND r.rel_type = 'REFERENCES'
        AND e.type = 'adr'
        AND (r.status IS NULL OR r.status != 'deleted')
        AND (r.proposal_id IS NULL OR r.proposal_id = '')
    `
      : `
      SELECT 1 FROM relations r
      JOIN entities e ON r.to_project = e.source_project AND r.to_id = e.id
      WHERE r.from_id = ? AND r.from_project = ?
        AND r.rel_type = 'REFERENCES'
        AND e.type = 'adr'
        AND (r.status IS NULL OR r.status != 'deleted')
        AND r.proposal_id = ?
    `;
    const adrParams = dbProposalId === '' ? [id, dbSourceProject] : [id, dbSourceProject, dbProposalId];
    const hasAdr = db.prepare(adrQuery).get(...adrParams);

    if (!hasAdr) {
      if (params.enforce_adr) {
        // enforce_adr=true 时，缺少 ADR 返回错误
        return {
          success: false,
          id,
          status,
          content_hash: contentHash,
          error: {
            code: 'C4A-STORE-ADR-001',
            message: '发布 system/container/component 需要关联 ADR',
            details: {
              entity_id: id,
              entity_type: params.type,
              missing_adr: true,
              suggestion: '请先创建 ADR 记录架构决策，然后通过 REFERENCES 关系关联',
            },
          },
        } as SaveResult;
      }
      // 否则返回警告
      adrCheck = {
        required: true,
        passed: false,
        missing_adr: true,
        message: '警告：此实体缺少关联的 ADR，建议补充架构决策记录',
      };
    } else {
      adrCheck = {
        required: true,
        passed: true,
      };
    }
  }

  const kind = pickString(converted?.kind ?? storedData.kind);
  const scope = pickString(converted?.scope ?? storedData.scope);
  const perspective = pickString(converted?.perspective ?? storedData.perspective);

  // 使用事务保存
  const relations = parseRelations(rawData, sourceProject, id, params.type);
  let relationChangeset: RelationsChangeSet | null = null;

  const transaction = db.transaction(() => {
    // 插入/更新 entities 表
    db.prepare(`
      INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (source_project, id, proposal_id) DO UPDATE SET
        type = excluded.type,
        kind = excluded.kind,
        scope = excluded.scope,
        perspective = excluded.perspective,
        data = excluded.data
    `).run(
      id,
      dbSourceProject,
      dbProposalId,
      params.type,
      kind,
      scope,
      perspective,
      JSON.stringify(storedData)
    );

    // 插入/更新 metadata 表
    db.prepare(`
      INSERT INTO metadata (
        entity_id, source_project, proposal_id, status, content_hash, created_at, updated_at, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (source_project, entity_id, proposal_id) DO UPDATE SET
        status = excluded.status,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at,
        created_by = excluded.created_by,
        updated_by = excluded.updated_by
    `).run(id, dbSourceProject, dbProposalId, status, contentHash, now, now, createdBy, updatedBy);

    // 记录历史
    db.prepare(`
      INSERT INTO entity_history (
        entity_id, source_project, proposal_id, entity_type, feat_id, action,
        changed_fields, snapshot_after, changed_by, changed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      dbSourceProject,
      dbProposalId,
      params.type,
      dbProposalId,
      existing ? 'update' : 'create',
      changedFields.length > 0 ? JSON.stringify(changedFields) : null,
      JSON.stringify(storedData),
      updatedBy,
      now
    );
    // 保存关系（包含在同一事务中）
    if (relations.length > 0) {
      relationChangeset = persistRelations(ctx, sourceProject, id, proposalId, relations);
    }
  });

  transaction();

  // 事务成功后，更新内存图
  if (relationChangeset) {
    updateGraph(ctx, relationChangeset);
  }

  // 向量索引增量维护（异步执行，不阻塞保存）
  if (ctx.config.enableVectorSearch) {
    const vectorData = (converted ?? storedData) as Record<string, unknown>;
    updateVectorIndex(ctx, sourceProject, id, proposalId, vectorData).catch(() => {
      // 向量更新失败不影响主流程
    });
  }

  return {
    success: true,
    id,
    status,
    content_hash: contentHash,
    adr_check: adrCheck,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * 更新向量索引
 */
async function updateVectorIndex(
  ctx: AdapterContext,
  sourceProject: string,
  entityId: string,
  proposalId: string | null,
  data: Record<string, unknown>
): Promise<void> {
  // 检查向量搜索是否可用
  if (!ctx.store.isVectorSearchEnabled()) {
    return;
  }
  const vectorStore = ctx.store.getVectorStore();
  if (!vectorStore) {
    return;
  }

  // 生成搜索文本
  const text = generateSearchText(data);
  if (!text) return;

  // 生成向量
  const embedding = await generateEmbedding(text);

  // 写入 USearch 索引
  try {
    const dbProposalId = proposalId ?? '';
    const dbSourceProject = sourceProject ?? '';
    const vectorKey = generateVectorKey(dbSourceProject, entityId, dbProposalId);
    vectorStore.add(vectorKey, embedding);
    // 显式保存（因为 usearch-store.ts 中 add 不会自动保存，依赖外部调用 flush 或 save）
    // 实际上 usearch-store.ts 有 markDirty 实现 debounce 自动保存，
    // 这里调用 add 就会触发 markDirty。
    // 如果需要立即持久化，可以调用 flush()，但为了性能，依赖 debounce 即可。
    // Issue 3 要求避免高频保存，现有的 debounce 机制已经满足。
  } catch {
    // 向量写入失败，忽略
  }
}
