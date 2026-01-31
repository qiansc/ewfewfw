import { join } from 'node:path';
import { CONTEXT_ROOT_DIR } from '@c4a/core';
import type { SyncParams, SyncResult as AdapterSyncResult } from '../../adapter.js';
import type { DataOpsContext } from '../types.js';
import type { ExportOptions, ExportResult, SyncResult } from './types.js';
import { sync } from './syncEngine.js';

export interface ExportParams extends Omit<SyncParams, 'direction'> {
  direction?: 'export';
}

/**
 * 导出引擎（新接口）
 */
export async function exportToFiles(
  ctx: DataOpsContext,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const format = options.format ?? 'yaml';
  const result = (await sync(ctx, {
    ...options,
    direction: 'db-to-file',
  })) as SyncResult;

  return {
    success: result.success,
    exported: result.stats.created + result.stats.updated,
    skipped: result.stats.skipped,
    deleted: result.stats.deleted,
    conflicts: result.conflicts,
    path: resolveContextRoot(options.path),
    format,
  };
}

/**
 * 导出引擎（兼容旧接口）
 */
export async function exportEntities(
  ctx: DataOpsContext,
  params: ExportParams = {}
): Promise<AdapterSyncResult> {
  return sync(ctx, { ...params, direction: 'export' });
}

function resolveContextRoot(path?: string): string {
  const base = path ?? CONTEXT_ROOT_DIR;
  if (base.endsWith(CONTEXT_ROOT_DIR)) {
    return base;
  }
  return join(base, CONTEXT_ROOT_DIR);
}
