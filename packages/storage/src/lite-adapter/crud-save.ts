/**
 * LiteAdapter Save 操作
 */

import { getWriteQueue } from '../write-queue.js';
import type { EntityStatus, SaveParams, SaveResult, Warning } from '../adapter.js';
import type { AdapterContext } from './types.js';
import { computeHash, parseContent } from './helpers.js';
import { parseRelations, persistRelations, updateGraph, type RelationsChangeSet } from './relations.js';
import { runAdrCheck } from './crud-save-adr.js';
import { updateVectorIndex } from './crud-save-vector.js';
import {
  applyGeneratedId,
  diffFields,
  generateAutoId,
  isEntityStatus,
  pickString,
  resolveDanglingRelations,
  toInternalEntity,
} from './crud-save-utils.js';
import * as converter from '@c4a/core';

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
  const warningEnabled = !params.force_save;

  const hasData = params.data !== undefined;
  const hasContent = params.content !== undefined;
  if (hasData === hasContent) {
    throw new Error('必须提供 data 或 content 其中之一（不能同时提供或都不提供）');
  }
  if (hasContent && params.format === undefined) {
    throw new Error('使用 content 时必须同时指定 format');
  }

  // 解析数据
  let rawData: Record<string, unknown>;
  if (params.data !== undefined) {
    rawData = params.data;
  } else if (params.content !== undefined) {
    rawData = parseContent(params.content, params.format || 'yaml');
  } else {
    throw new Error('Either data or content must be provided');
  }

  // 转换 DSL -> Internal Entity（用于提取 kind/scope/perspective）
  const converted = toInternalEntity(rawData);
  const storedData = rawData;

  const requestedStatus = isEntityStatus(pickString(storedData.status))
    ? (storedData.status as EntityStatus)
    : isEntityStatus(pickString((storedData.metadata as Record<string, unknown> | undefined)?.status))
      ? ((storedData.metadata as Record<string, unknown>).status as EntityStatus)
      : null;

  const sourceProject = params.source_project || ctx.config.defaultProject;
  const proposalId = params.proposal_id ?? null;
  const dbProposalId = proposalId ?? '';
  const dbSourceProject = sourceProject ?? '';

  // 提取 ID（支持自动生成）
  let id: string | undefined = params.id || converted?.id || (rawData.id as string | undefined);
  if (!id) {
    id = generateAutoId(db, dbSourceProject, params.type, rawData) ?? undefined;
  }
  if (!id) {
    throw new Error('Entity ID is required');
  }
  applyGeneratedId(params.type, rawData, id);

  if (!params.source_project && !ctx.config.defaultProject && warningEnabled) {
    warnings.push({
      code: 'SOURCE_PROJECT_MISSING',
      message: `实体 ${id} 缺少 source_project，迁移到 Server 模式时可能失败`,
      severity: 'warning',
      details: {
        suggestion: '请在 .c4a.yaml 配置 project_id，或显式指定 source_project',
      },
    });
  }

  // 计算 content_hash
  const contentHash = computeHash(storedData);

  // 检查是否存在并读取旧数据
  const existingQuery = dbProposalId === ''
    ? `
    SELECT e.data as data, m.content_hash, m.created_by, m.updated_by, m.status
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id = m.proposal_id
    WHERE e.source_project = ? AND e.id = ? AND (e.proposal_id IS NULL OR e.proposal_id = '')
  `
    : `
    SELECT e.data as data, m.content_hash, m.created_by, m.updated_by, m.status
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id = m.proposal_id
    WHERE e.source_project = ? AND e.id = ? AND e.proposal_id = ?
  `;
  const existingParams = dbProposalId === '' ? [dbSourceProject, id] : [dbSourceProject, id, dbProposalId];
  const existing = db.prepare(existingQuery).get(...existingParams) as
    | {
        data: string;
        content_hash: string;
        created_by: string | null;
        updated_by: string | null;
        status: string | null;
      }
    | undefined;

  const previousData = existing?.data ? (JSON.parse(existing.data) as Record<string, unknown>) : null;

  const mainExists = !!db.prepare(`
    SELECT 1 FROM entities
    WHERE source_project = ? AND id = ? AND (proposal_id IS NULL OR proposal_id = '')
  `).get(dbSourceProject, id);

  // 3.18 并发修改预警：检查是否有其他活跃 feat 也在修改同一实体
  // 设计文档: store-feat-checklist.md §3.10
  const concurrentWarningEnabled = ctx.config.feat.concurrent_warning !== false;
  if (
    warningEnabled &&
    concurrentWarningEnabled &&
    proposalId &&
    !params.ignore_concurrent_warning &&
    (existing || mainExists)
  ) {
    const concurrentFeats = db.prepare(`
      SELECT e.proposal_id, m.updated_at, m.updated_by, m.status as entity_status, f.status as feat_status, f.title, f.description
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id = m.proposal_id
      LEFT JOIN feats f ON e.proposal_id = f.id
      WHERE e.id = ?
        AND e.source_project = ?
        AND e.proposal_id IS NOT NULL
        AND e.proposal_id != ''
        AND e.proposal_id != ?
        AND m.status IN ('draft', 'approved')
    `).all(id, dbSourceProject, dbProposalId) as Array<{
      proposal_id: string;
      updated_at: string;
      updated_by: string | null;
      entity_status: string | null;
      feat_status: string | null;
      title: string | null;
      description: string | null;
    }>;

    if (concurrentFeats.length > 0) {
      warnings.push({
        code: 'CONCURRENT_MODIFICATION',
        message: `实体 ${id} 正在被其他 feat 修改`,
        severity: 'warning',
        details: {
          concurrent_feats: concurrentFeats.map(f => ({
            feat_id: f.proposal_id,
            status: f.feat_status || f.entity_status || 'unknown',
            updated_by: f.updated_by,
            updated_at: f.updated_at,
            changes_summary: pickString(f.description) ?? pickString(f.title) ?? undefined,
          })),
        },
      });
    }
  }

  // 确定状态（已有实体默认沿用当前状态）
  const existingStatus = isEntityStatus(pickString(existing?.status))
    ? (existing?.status as EntityStatus)
    : null;
  const status: EntityStatus =
    requestedStatus ?? existingStatus ?? (proposalId ? 'draft' : 'published');

  if (existingStatus && existingStatus !== status) {
    if (!converter.isValidStatusTransition(existingStatus, status)) {
      return {
        success: false,
        id,
        status: existingStatus,
        content_hash: existing?.content_hash ?? contentHash,
        error: {
          code: 'C4A-BIZ-001',
          message: '非法状态流转',
          details: {
            from_status: existingStatus,
            to_status: status,
            suggestion: '按 draft → approved → published → deprecated → archived 顺序流转',
          },
        },
      } as SaveResult;
    }
  }

  if (
    !proposalId &&
    existingStatus === 'published' &&
    status === 'published' &&
    existing?.content_hash &&
    existing.content_hash !== contentHash &&
    !params.force_save
  ) {
    return {
      success: false,
      id,
      status: existingStatus,
      content_hash: existing.content_hash,
      error: {
        code: 'C4A-BIZ-001',
        message: 'published 状态不可直接修改，请通过 feat 变更',
        details: {
          suggestion: '创建 feat 分支修改并发布，或先流转为 deprecated',
        },
      },
    } as SaveResult;
  }

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

  // 3.19 引用完整性预警：废弃/归档实体时检查依赖
  // 设计文档: store-feat-checklist.md §3.11
  if (
    warningEnabled &&
    (status === 'deprecated' || status === 'archived') &&
    (existing || mainExists)
  ) {
    const dependents = db.prepare(`
      SELECT DISTINCT r.from_id, r.from_project, e.type, r.proposal_id, r.rel_type
      FROM relations r
      JOIN entities e ON r.from_project = e.source_project
        AND r.from_id = e.id AND r.proposal_id = e.proposal_id
      LEFT JOIN feats f ON r.proposal_id = f.id
      WHERE r.to_id = ?
        AND (r.status IS NULL OR r.status != 'deleted')
        AND r.rel_type IN ('DEPENDS_ON', 'USES', 'CALLS')
        AND (r.proposal_id IS NULL OR r.proposal_id = '' OR f.status IS NULL OR f.status IN ('draft', 'approved'))
    `).all(id) as Array<{
      from_id: string;
      from_project: string;
      type: string;
      proposal_id: string | null;
      rel_type: string;
    }>;

    if (dependents.length > 0) {
      warnings.push({
        code: 'DANGLING_REFERENCE',
        message: `废弃此实体将导致 ${dependents.length} 个依赖方出现悬空引用`,
        severity: 'warning',
        details: {
          dependents: dependents.map(d => ({
            id: d.from_id,
            type: d.type,
            feat_id: d.proposal_id,
            rel_type: d.rel_type,
          })),
        },
      });
    }
  }

  // P1-2.1: ADR 检查逻辑
  // 设计文档: store-crud.md §3.1
  let adrCheck: SaveResult['adr_check'];
  const adrOutcome = runAdrCheck({
    db,
    params,
    status,
    id,
    contentHash,
    dbSourceProject,
    dbProposalId,
  });
  if (adrOutcome.error) {
    return adrOutcome.error;
  }
  adrCheck = adrOutcome.adrCheck;

  const kind = pickString(converted?.kind ?? storedData.kind);
  const scope = pickString(converted?.scope ?? storedData.scope);
  const perspective = pickString(converted?.perspective ?? storedData.perspective);

  // 使用事务保存
  const relations = parseRelations(ctx, rawData, sourceProject, id, params.type, proposalId);
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
    // 无论关系是否为空，都要清理旧关系，避免残留
    relationChangeset = persistRelations(ctx, sourceProject, id, proposalId, relations);
  });

  transaction();

  // 事务成功后，更新内存图
  if (relationChangeset) {
    updateGraph(ctx, relationChangeset);
  }

  if (resolveDanglingRelations(db, dbSourceProject, id)) {
    ctx.graph.load(db, proposalId);
    ctx.cache.clear();
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
