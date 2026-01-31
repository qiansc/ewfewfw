/**
 * Feat 生命周期操作（Data Ops）
 */

import { isValidFeatStatusTransition } from '@c4a/core/types';
import type {
  FeatLifecycleParams,
  FeatLifecycleResult,
  FeatStatus,
  FeatConflict,
} from '../../adapter.js';
import type { DataOpsContext } from '../types.js';
import {
  collectFeatEntitiesForVector,
  detectFeatConflicts,
  mergeFeatToMain,
  removeVectorIndexForEntities,
  updateVectorIndexAfterMerge,
} from './merge.js';
import { createHash } from 'node:crypto';

// ============================================================
// FeatLifecycle 操作
// ============================================================

/**
 * Feat 生命周期管理
 */
export async function featLifecycle(
  ctx: DataOpsContext,
  params: FeatLifecycleParams
): Promise<FeatLifecycleResult> {
  switch (params.action) {
    case 'create':
      return createFeat(ctx, params);
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
  ctx: DataOpsContext,
  params: FeatLifecycleParams
): FeatLifecycleResult {
  const now = new Date().toISOString();
  const featId = params.feat_id;

  // 检查 feat 是否已存在
  const existing = ctx.storage.getFeat(featId);
  if (existing) {
    return {
      success: false,
      feat_id: featId,
      error: 'FEAT_EXISTS',
      message: `Feat ${featId} already exists`,
    };
  }

  // 创建 feat
  ctx.storage.createFeat({
    id: featId,
    status: 'draft' as FeatStatus,
    title: params.metadata?.title || featId,
    description: params.metadata?.description || '',
    created_by: params.metadata?.created_by || 'unknown',
    created_at: now,
    updated_at: now,
  });

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
  ctx: DataOpsContext,
  params: FeatLifecycleParams
): Promise<FeatLifecycleResult> {
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
  const feat = ctx.storage.getFeat(featId) as { status: FeatStatus } | null;

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
    const actualHash = computeFeatContentHash(ctx, featId);
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
    const conflicts = detectFeatConflicts(ctx.storage, featId);
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
  ctx.storage.updateFeatStatus(featId, toStatus, now);

  // 发布时合并实体到主分支
  let mergeResult: { merged: string[]; conflicts: FeatConflict[] } | undefined;
  if (toStatus === 'published') {
    const vectorEntities = collectFeatEntitiesForVector(ctx.storage, featId);
    mergeResult = mergeFeatToMain(ctx.storage, featId, {
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
  ctx: DataOpsContext,
  params: FeatLifecycleParams
): FeatLifecycleResult {
  const featId = params.feat_id;
  const vectorEntities = collectFeatEntitiesForVector(ctx.storage, featId);

  // 删除 feat 关联的实体
  ctx.storage.deleteEntitiesByProposalId(featId);
  ctx.storage.deleteMetadataByProposalId(featId);
  ctx.storage.deleteRelationsByProposalId(featId);

  removeVectorIndexForEntities(ctx, featId, vectorEntities);

  // 删除 feat 本身
  ctx.storage.deleteFeat(featId);

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
function computeFeatContentHash(ctx: DataOpsContext, featId: string): string {
  const hashes = ctx.storage.getFeatEntityContentHashes(featId);
  const combined = hashes
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => item.content_hash)
    .join('|');

  return 'sha256:' + createHash('sha256').update(combined).digest('hex').slice(0, 16);
}
