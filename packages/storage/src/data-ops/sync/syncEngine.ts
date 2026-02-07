/**
 * 同步引擎（Data Ops）
 *
 * 设计文档: v0.3.0/detailed-design/data-ops/sync-export.md
 */

import type {
  SyncParams as AdapterSyncParams,
  SyncResult as AdapterSyncResult,
  PlanSyncParams,
  PlanSyncResult,
  SyncPlan,
  SyncSnapshot,
} from '../../adapter.js';
import type { DataOpsContext } from '../types.js';
import type { ConflictInfo, SyncDetail, SyncOptions, SyncResult, SyncStats } from './types.js';
import { legacySync } from './syncLegacy.js';
import {
  loadDbEntities,
  syncBidirectional,
  syncDbToFile,
  syncFileToDb,
} from './syncDbOps.js';
import { loadFileEntities, removeOrphanFiles, resolveContextRoot } from './syncFileOps.js';

// ============================================================
// Sync 操作（Local 模式 - 新接口 + 旧接口）
// ============================================================

export async function sync(
  ctx: DataOpsContext,
  params: AdapterSyncParams
): Promise<AdapterSyncResult>;
export async function sync(
  ctx: DataOpsContext,
  params: SyncOptions
): Promise<SyncResult>;
export async function sync(
  ctx: DataOpsContext,
  params: AdapterSyncParams | SyncOptions
): Promise<AdapterSyncResult | SyncResult> {
  if (isAdapterSyncParams(params)) {
    return legacySync(ctx, params);
  }
  return syncContext(ctx, params);
}

function isAdapterSyncParams(
  params: AdapterSyncParams | SyncOptions
): params is AdapterSyncParams {
  return params.direction === 'import' || params.direction === 'export';
}

async function syncContext(ctx: DataOpsContext, options: SyncOptions): Promise<SyncResult> {
  const direction = options.direction ?? 'bidirectional';
  const mode = options.mode ?? 'incremental';
  const format = options.format ?? 'yaml';
  const statusFilter = options.status_filter ?? 'published';
  const featId = options.feat_id ?? null;
  const conflictPolicy = options.conflict_policy ?? 'skip';
  const contextRoot = resolveContextRoot(options.path);

  const stats: SyncStats = {
    scanned: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    conflicted: 0,
    failed: 0,
  };
  const conflicts: ConflictInfo[] = [];
  const warnings: string[] = [];
  const details: SyncDetail[] = [];

  const dbEntities = loadDbEntities(ctx, { statusFilter, featId });
  const fileLoad = loadFileEntities(contextRoot, { featId });
  stats.failed += fileLoad.failed;
  details.push(...fileLoad.details);

  const fileEntities = fileLoad.entities;
  const dbMap = new Map(dbEntities.map((entity) => [entity.id, entity]));
  const fileMap = new Map(fileEntities.map((entity) => [entity.id, entity]));
  const allIds = new Set<string>([...dbMap.keys(), ...fileMap.keys()]);

  if (direction === 'db-to-file') {
    stats.scanned = dbEntities.length;
    syncDbToFile({
      ctx,
      dbEntities,
      fileMap,
      contextRoot,
      mode,
      format,
      featId,
      conflictPolicy,
      stats,
      warnings,
      details,
      conflicts,
    });
    const removed = removeOrphanFiles(fileEntities, dbMap);
    stats.deleted += removed.length;
    for (const path of removed) {
      details.push({ entity_id: 'unknown', action: 'deleted', path });
    }
  } else if (direction === 'file-to-db') {
    stats.scanned = fileEntities.length;
    syncFileToDb({
      ctx,
      fileEntities,
      dbMap,
      stats,
      warnings,
      details,
      featId,
    });
  } else {
    stats.scanned = allIds.size;
    syncBidirectional({
      ctx,
      dbMap,
      fileMap,
      allIds,
      contextRoot,
      format,
      featId,
      conflictPolicy,
      stats,
      conflicts,
      warnings,
      details,
    });
  }

  const success =
    stats.failed === 0 &&
    (direction !== 'bidirectional' || stats.conflicted === 0) &&
    (direction !== 'db-to-file' || conflictPolicy !== 'prompt' || stats.conflicted === 0);

  return {
    success,
    direction,
    stats,
    conflicts,
    warnings: warnings.length > 0 ? warnings : undefined,
    details: details.length > 0 ? details : undefined,
  };
}

// ============================================================
// PlanSync 操作（Server/Remote 模式）
// ============================================================

/**
 * 同步计划
 * 设计文档: store-sync.md §3.5.1
 */
export async function planSync(
  ctx: DataOpsContext,
  params: PlanSyncParams
): Promise<PlanSyncResult> {
  const requirementId = params.options?.requirement_id ?? null;
  const statusFilter = params.options?.status_filter || 'published';

  const plan: SyncPlan = {
    to_upload: [],
    to_download: [],
    to_delete_local: [],
    to_delete_remote: [],
    conflicts: [],
    unchanged: [],
  };

  // 构建本地文件映射
  const localFiles = new Map<string, typeof params.local_manifest.files[0]>();
  for (const file of params.local_manifest.files) {
    localFiles.set(file.entity_id, file);
  }

  // 构建快照映射
  const snapshotEntities = new Map<string, { content_hash: string; requirement_id?: string }>();
  if (params.snapshot?.entities) {
    for (const [entityId, info] of Object.entries(params.snapshot.entities)) {
      snapshotEntities.set(entityId, info);
    }
  }

  // 查询远程实体
  const remoteEntities = ctx.storage.listEntitiesForPlanSync({
    requirementId,
    statusFilter,
  });

  const remoteMap = new Map<string, typeof remoteEntities[0]>();
  for (const entity of remoteEntities) {
    remoteMap.set(entity.id, entity);
  }

  // 收集所有实体 ID
  const allEntityIds = new Set<string>([
    ...localFiles.keys(),
    ...remoteMap.keys(),
    ...snapshotEntities.keys(),
  ]);

  // 三方对比
  for (const entityId of allEntityIds) {
    const local = localFiles.get(entityId);
    const remote = remoteMap.get(entityId);
    const snapshot = snapshotEntities.get(entityId);

    // 本地有，远程无
    if (local && !remote) {
      if (snapshot) {
        // 远程已删除（快照中有，说明之前同步过）
        plan.to_delete_local.push({
          op: 'delete_local',
          entity_id: entityId,
          type: local.type,
          path: local.path,
          expected_hash: local.content_hash,
          reason: '远程已删除此实体',
        });
      } else {
        // 本地新增
        plan.to_upload.push({
          op: 'upload',
          entity_id: entityId,
          type: local.type,
          path: local.path,
          content_hash: local.content_hash,
          expected_hash: local.content_hash,
          reason: '本地新增',
        });
      }
      continue;
    }

    // 本地无，远程有
    if (!local && remote) {
      if (snapshot) {
        // 本地已删除
        plan.to_delete_remote.push({
          op: 'delete_remote',
          entity_id: entityId,
          type: remote.type,
          reason: '本地已删除',
        });
      } else {
        // 远程新增
        plan.to_download.push({
          op: 'download',
          entity_id: entityId,
          type: remote.type,
          content: remote.data,
          content_hash: remote.content_hash,
          reason: '远程新增',
        });
      }
      continue;
    }

    // 本地有，远程有
    if (local && remote) {
      if (local.content_hash === remote.content_hash) {
        // 无变化
        plan.unchanged.push(entityId);
      } else if (snapshot) {
        // 有快照，可以判断谁修改了
        const snapshotHash = snapshot.content_hash;
        const localChanged = local.content_hash !== snapshotHash;
        const remoteChanged = remote.content_hash !== snapshotHash;

        if (localChanged && remoteChanged) {
          // 双方都修改了 → 冲突
          plan.conflicts.push({
            entity_id: entityId,
            conflict_type: 'both_modified',
            local_hash: local.content_hash,
            remote_hash: remote.content_hash,
            remote_content: remote.data,
            reason: '双方都修改了',
          });
        } else if (localChanged) {
          // 仅本地修改 → 上传
          plan.to_upload.push({
            op: 'upload',
            entity_id: entityId,
            type: local.type,
            path: local.path,
            content_hash: local.content_hash,
            expected_hash: snapshot.content_hash,
            reason: '本地修改',
          });
        } else {
          // 仅远程修改 → 下载
          plan.to_download.push({
            op: 'download',
            entity_id: entityId,
            type: remote.type,
            path: local.path,
            content: remote.data,
            content_hash: remote.content_hash,
            expected_hash: local.content_hash,
            reason: '远程修改',
          });
        }
      } else {
        // 无快照，无法判断谁修改了 → 冲突
        plan.conflicts.push({
          entity_id: entityId,
          conflict_type: 'both_modified',
          local_hash: local.content_hash,
          remote_hash: remote.content_hash,
          remote_content: remote.data,
          reason: '无快照，无法判断变更来源',
        });
      }
      continue;
    }
  }

  // 生成新快照
  const newSnapshot: SyncSnapshot = {
    synced_at: new Date().toISOString(),
    entities: {},
  };

  // 合并本地和远程的最新状态到快照
  for (const [entityId, local] of localFiles) {
    newSnapshot.entities[entityId] = {
      content_hash: local.content_hash,
      requirement_id: local.requirement_id,
    };
  }
  for (const [entityId, remote] of remoteMap) {
    if (!newSnapshot.entities[entityId]) {
      newSnapshot.entities[entityId] = {
        content_hash: remote.content_hash,
      };
    }
  }

  return {
    plan,
    executed: false,
    new_snapshot: newSnapshot,
  };
}
