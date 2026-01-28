/**
 * LiteAdapter Feat 生命周期操作
 */

import { isValidFeatStatusTransition } from '../../types/index.js';
import type { SQLiteStore } from '../sqlite-store.js';
import type {
  FeatLifecycleParams,
  FeatLifecycleResult,
  FeatStatus,
  FeatConflict,
} from '../adapter.js';
import type { AdapterContext } from './types.js';
import {
  collectFeatEntitiesForVector,
  detectFeatConflicts,
  mergeFeatToMain,
  removeVectorIndexForEntities,
  updateVectorIndexAfterMerge,
} from './featMerge.js';

// ============================================================
// FeatLifecycle 操作
// ============================================================

/**
 * Feat 生命周期管理
 */
export async function featLifecycle(
  ctx: AdapterContext,
  params: FeatLifecycleParams
): Promise<FeatLifecycleResult> {
  const db = ctx.store.getDatabase();

  switch (params.action) {
    case 'create':
      return createFeat(db, params);
    case 'transition':
      return transitionFeat(ctx, params);
    case 'delete':
      return deleteFeat(ctx, params);
    default:
      return {
        success: false,
        feat_id: params.feat_id,
        error: 'INVALID_ACTION',
        message: `Unknown action: ${params.action}`,
      };
  }
}

// ============================================================
// 内部辅助函数
// ============================================================

/**
 * 创建 Feat
 */
function createFeat(
  db: ReturnType<SQLiteStore['getDatabase']>,
  params: FeatLifecycleParams
): FeatLifecycleResult {
  const now = new Date().toISOString();
  const featId = params.feat_id;

  // 检查 feat 是否已存在
  const existing = db.prepare(`
    SELECT id FROM feats WHERE id = ?
  `).get(featId);

  if (existing) {
    return {
      success: false,
      feat_id: featId,
      error: 'FEAT_EXISTS',
      message: `Feat ${featId} already exists`,
    };
  }

  // 创建 feat
  db.prepare(`
    INSERT INTO feats (id, status, title, description, created_by, created_at, updated_at)
    VALUES (?, 'draft', ?, ?, ?, ?, ?)
  `).run(
    featId,
    params.metadata?.title || featId,
    params.metadata?.description || '',
    params.metadata?.created_by || 'unknown',
    now,
    now
  );

  return {
    success: true,
    feat_id: featId,
    status: 'draft' as FeatStatus,
  };
}

/**
 * 流转 Feat 状态
 *
 * 设计文档: store-feat-lifecycle.md §3.6
 */
async function transitionFeat(
  ctx: AdapterContext,
  params: FeatLifecycleParams
): Promise<FeatLifecycleResult> {
  const db = ctx.store.getDatabase();
  const featId = params.feat_id;
  const toStatus = params.to_status;

  if (!toStatus) {
    return {
      success: false,
      feat_id: featId,
      error: 'MISSING_STATUS',
      message: 'to_status is required for transition action',
    };
  }

  // 获取当前状态
  const feat = db.prepare(`
    SELECT status FROM feats WHERE id = ?
  `).get(featId) as { status: FeatStatus } | undefined;

  if (!feat) {
    return {
      success: false,
      feat_id: featId,
      error: 'FEAT_NOT_FOUND',
      message: `Feat ${featId} not found`,
    };
  }

  const fromStatus = feat.status;

  // 验证状态流转
  if (!isValidFeatStatusTransition(fromStatus, toStatus)) {
    return {
      success: false,
      feat_id: featId,
      from_status: fromStatus,
      error: 'INVALID_TRANSITION',
      message: `Cannot transition from ${fromStatus} to ${toStatus}`,
    };
  }

  // P1-2.2: 发布前同步校验（expected_content_hash）
  // 设计文档: store-feat-lifecycle.md §3.6
  if (toStatus === 'published' && params.expected_content_hash) {
    const actualHash = computeFeatContentHash(db, featId);
    if (actualHash !== params.expected_content_hash) {
      return {
        success: false,
        feat_id: featId,
        from_status: fromStatus,
        error: 'content_hash_mismatch',
        message: '本地存在未同步的修改，请先执行 c4a sync',
        expected_hash: params.expected_content_hash,
        actual_hash: actualHash,
      };
    }
  }

  // 发布时检查冲突
  if (toStatus === 'published' && !params.force_publish) {
    const conflicts = detectFeatConflicts(db, featId);
    if (conflicts.length > 0) {
      return {
        success: false,
        feat_id: featId,
        from_status: fromStatus,
        error: 'merge_conflict',
        message: '发布前需要先解决冲突',
        conflicts,
      };
    }
  }

  // 执行状态流转
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE feats SET status = ?, updated_at = ? WHERE id = ?
  `).run(toStatus, now, featId);

  // 发布时合并实体到主分支
  let mergeResult: { merged: string[]; conflicts: FeatConflict[] } | undefined;
  if (toStatus === 'published') {
    const vectorEntities = collectFeatEntitiesForVector(db, featId);
    mergeResult = mergeFeatToMain(db, featId, {
      recordHistory: true,
      publishedBy: params.metadata?.created_by ?? null,
    });
    await updateVectorIndexAfterMerge(ctx, featId, vectorEntities);
  }

  return {
    success: true,
    feat_id: featId,
    from_status: fromStatus,
    to_status: toStatus as FeatStatus,
    merge_result: mergeResult,
  };
}

/**
 * 删除 Feat
 */
function deleteFeat(
  ctx: AdapterContext,
  params: FeatLifecycleParams
): FeatLifecycleResult {
  const db = ctx.store.getDatabase();
  const featId = params.feat_id;
  const vectorEntities = collectFeatEntitiesForVector(db, featId);

  // 删除 feat 关联的实体
  db.prepare(`DELETE FROM entities WHERE proposal_id = ?`).run(featId);
  db.prepare(`DELETE FROM metadata WHERE proposal_id = ?`).run(featId);
  db.prepare(`DELETE FROM relations WHERE proposal_id = ?`).run(featId);

  removeVectorIndexForEntities(ctx, featId, vectorEntities);

  // 删除 feat 本身
  db.prepare(`DELETE FROM feats WHERE id = ?`).run(featId);

  return {
    success: true,
    feat_id: featId,
    deleted: true,
  };
}

/**
 * 计算 Feat 内容哈希
 * 用于发布前同步校验
 */
function computeFeatContentHash(
  db: ReturnType<SQLiteStore['getDatabase']>,
  featId: string
): string {
  // 获取 feat 中所有实体的 content_hash，按 ID 排序后拼接
  const hashes = db.prepare(`
    SELECT m.content_hash
    FROM entities e
    JOIN metadata m ON e.source_project = m.source_project
      AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
    WHERE e.proposal_id = ?
    ORDER BY e.id
  `).all(featId) as Array<{ content_hash: string }>;

  // 拼接所有哈希值
  const combined = hashes.map(h => h.content_hash).join('|');

  // 计算组合哈希
  const { createHash } = require('node:crypto');
  return 'sha256:' + createHash('sha256').update(combined).digest('hex').slice(0, 16);
}
