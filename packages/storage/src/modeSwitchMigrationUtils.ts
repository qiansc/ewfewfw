/**
 * 模式迁移辅助函数
 */

import type {
  ChecklistPatch,
  ChecklistTaskStatus,
  ChecklistTaskType,
  StorageAdapter,
} from './adapter.js';
import type { ExportEntity, ExportFeat } from './modeSwitchTypes.js';
import { VALID_FEAT_STATUS_TRANSITIONS } from '@c4a/core/types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildEntityPayload(entity: ExportEntity): Record<string, unknown> {
  const data = { ...entity.data };

  if (entity.kind && data.kind === undefined) {
    data.kind = entity.kind;
  }
  if (entity.scope && data.scope === undefined) {
    data.scope = entity.scope;
  }
  if (entity.perspective && data.perspective === undefined) {
    data.perspective = entity.perspective;
  }

  const metadata = data.metadata;
  if (isPlainObject(metadata)) {
    if (entity.metadata.status && metadata.status === undefined) {
      metadata.status = entity.metadata.status;
    }
    if (entity.metadata.created_at && metadata.created_at === undefined) {
      metadata.created_at = entity.metadata.created_at;
    }
    if (entity.metadata.updated_at && metadata.updated_at === undefined) {
      metadata.updated_at = entity.metadata.updated_at;
    }
    if (entity.metadata.source_repo && metadata.source_repo === undefined) {
      metadata.source_repo = entity.metadata.source_repo;
    }
    if (entity.metadata.content_hash && metadata.content_hash === undefined) {
      metadata.content_hash = entity.metadata.content_hash;
    }
  } else {
    data.metadata = {
      status: entity.metadata.status,
      created_at: entity.metadata.created_at,
      updated_at: entity.metadata.updated_at,
      source_repo: entity.metadata.source_repo,
      content_hash: entity.metadata.content_hash,
    };
  }

  return data;
}

function resolveStatusPath(from: string, to: string): string[] {
  if (from === to) return [];
  const queue: Array<{ status: string; path: string[] }> = [{ status: from, path: [] }];
  const visited = new Set([from]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const nextStatuses = (VALID_FEAT_STATUS_TRANSITIONS as Record<string, string[]>)[current.status] ?? [];
    for (const next of nextStatuses) {
      if (visited.has(next)) continue;
      const nextPath = [...current.path, next];
      if (next === to) {
        return nextPath;
      }
      visited.add(next);
      queue.push({ status: next, path: nextPath });
    }
  }
  return [];
}

export async function transitionFeatStatus(
  adapter: StorageAdapter,
  featId: string,
  targetStatus: string
): Promise<void> {
  const path = resolveStatusPath('draft', targetStatus);
  if (path.length === 0 && targetStatus !== 'draft') {
    throw new Error(`Unsupported feat status: ${targetStatus}`);
  }
  for (const status of path) {
    const result = await adapter.featLifecycle({
      action: 'transition',
      feat_id: featId,
      to_status: status as never,
      force_publish: true,
    });
    if (!result.success) {
      throw new Error(result.message ?? result.error ?? `transition to ${status} failed`);
    }
  }
}

export async function applyChecklist(adapter: StorageAdapter, feat: ExportFeat): Promise<void> {
  const checklist = feat.checklist as { items?: Array<Record<string, unknown>> } | undefined;
  const items = checklist?.items;
  if (!Array.isArray(items) || items.length === 0) return;

  const generateResult = await adapter.featChecklist({
    action: 'generate',
    feat_id: feat.id,
    validate: false,
  });
  if (!generateResult.success) {
    throw new Error(generateResult.message ?? generateResult.error ?? '生成 checklist 失败');
  }

  const validStatuses: ChecklistTaskStatus[] = [
    'pending',
    'in_progress',
    'completed',
    'blocked',
    'skipped',
  ];
  const validTypes: ChecklistTaskType[] = ['dsl', 'code', 'test', 'doc', 'contract'];

  const patches: ChecklistPatch[] = items
    .filter((item): item is Record<string, unknown> & { id: string } => typeof item.id === 'string')
    .map((item) => {
      const id = item.id;
      const status =
        typeof item.status === 'string' && validStatuses.includes(item.status as ChecklistTaskStatus)
          ? (item.status as ChecklistTaskStatus)
          : undefined;
      const type =
        typeof item.type === 'string' && validTypes.includes(item.type as ChecklistTaskType)
          ? (item.type as ChecklistTaskType)
          : undefined;
      const updates: ChecklistPatch['updates'] = {
        title: typeof item.title === 'string' ? (item.title as string) : id,
      };
      if (status) updates.status = status;
      if (type) updates.type = type;
      if (typeof item.entity_id === 'string') updates.entity_id = item.entity_id;
      if (typeof item.assignee === 'string') updates.assignee = item.assignee;
      if (typeof item.completed_at === 'string') updates.completed_at = item.completed_at;
      if (typeof item.blocked_reason === 'string') updates.blocked_reason = item.blocked_reason;
      return {
        task_id: id,
        updates,
      };
    });

  if (patches.length === 0) return;

  const patchResult = await adapter.featChecklist({
    action: 'patch',
    feat_id: feat.id,
    patches,
    validate: false,
  });
  if (!patchResult.success) {
    throw new Error(patchResult.message ?? patchResult.error ?? '更新 checklist 失败');
  }
}
