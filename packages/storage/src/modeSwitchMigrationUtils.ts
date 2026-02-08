/**
 * 模式迁移辅助函数
 */

import type { ExportEntity } from './modeSwitchTypes.js';

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
