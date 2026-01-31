import type { DataOpsContext } from '../types.js';
import { detectFeatConflicts } from '../feat/merge.js';
import type { FeatConflict } from '../../adapter.js';
import type { ConflictResolution, ConflictResolutionResult } from './types.js';

/**
 * 获取 feat 冲突列表（封装 detectFeatConflicts）
 */
export function getFeatConflicts(ctx: DataOpsContext, featId: string): FeatConflict[] {
  return detectFeatConflicts(ctx.storage, featId);
}

const AUTO_MERGE_TYPES = new Set<FeatConflict['conflict_type']>([]);

function buildConflictSuggestion(conflict: FeatConflict): string {
  switch (conflict.conflict_type) {
    case 'deleted':
      return '建议优先恢复实体并核查依赖关系后再发布';
    case 'type':
      return '类型或 kind 变更需要确认业务意图，建议人工选择保留版本';
    case 'content':
    case 'both_modified':
      return '对比 main/feat 字段差异，选择保留版本或拆分修改';
    default:
      return '请人工确认冲突影响范围';
  }
}

/**
 * 冲突解决策略（生成报告与建议，不直接写入存储）
 */
export function resolveConflict(
  conflict: FeatConflict,
  resolution: ConflictResolution
): ConflictResolutionResult {
  const manualRequired = !AUTO_MERGE_TYPES.has(conflict.conflict_type);
  const suggestion = buildConflictSuggestion(conflict);

  let action: ConflictResolutionResult['action'];
  switch (resolution) {
    case 'ours':
      action = 'keep_feat';
      break;
    case 'theirs':
      action = 'keep_main';
      break;
    case 'manual':
      action = 'manual';
      break;
    case 'abort':
      action = 'abort';
      break;
    default:
      action = 'manual';
  }

  const baseMessage = `冲突 ${conflict.entity_id} (${conflict.conflict_type})`;
  const message =
    manualRequired && resolution !== 'manual' && resolution !== 'abort'
      ? `${baseMessage} 通常需要人工确认`
      : `${baseMessage} 已选择 ${resolution}`;

  return {
    conflict,
    resolution,
    action,
    manual_required: manualRequired,
    message,
    suggestion,
  };
}
