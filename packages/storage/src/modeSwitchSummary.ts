/**
 * 模式切换冲突摘要格式化
 */

import type { ConflictSummary } from './modeSwitchTypes.js';

function formatRecord(record: Record<string, number>): string {
  const entries = Object.entries(record).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '-';
  return entries.map(([key, count]) => `${key}:${count}`).join(', ');
}

export function formatConflictSummary(summary?: ConflictSummary): string {
  if (!summary) {
    return 'conflicts: 0';
  }

  const targetResolutions = Object.entries(summary.by_target_resolution)
    .map(([target, resolutions]) => `${target}(${formatRecord(resolutions)})`)
    .join(', ');

  return [
    `conflicts: ${summary.total}`,
    `targets: ${formatRecord(summary.by_target)}`,
    `entity_types: ${formatRecord(summary.by_entity_type)}`,
    `statuses: ${formatRecord(summary.by_status)}`,
    `feat_statuses: ${formatRecord(summary.by_feat_status)}`,
    `reasons: ${formatRecord(summary.by_reason)}`,
    `resolutions: ${formatRecord(summary.by_resolution)}`,
    `target_resolutions: ${targetResolutions || '-'}`,
    `target_statuses: ${Object.entries(summary.by_target_status)
      .map(([target, statuses]) => `${target}(${formatRecord(statuses)})`)
      .join(', ') || '-'}`,
  ].join('\n');
}
