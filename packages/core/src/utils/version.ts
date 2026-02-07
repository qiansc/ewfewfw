/**
 * 版本注入工具（运行时）
 *
 * 用于将工作区版本注入到实体（不持久化）
 */

import type { Entity } from '../types/entities.js';

export const DEFAULT_LATEST_VERSION = '0.0.0';

/**
 * 解析要注入的版本集合
 */
export function resolveVersions(
  current: string[] | undefined,
  workspaceVersion?: string | null,
): string[] {
  if (current && current.length > 0) {
    return [...current];
  }
  const version = workspaceVersion && workspaceVersion.trim().length > 0
    ? workspaceVersion.trim()
    : DEFAULT_LATEST_VERSION;
  return [version];
}

/**
 * 注入工作区版本（仅运行时）
 */
export function injectWorkspaceVersion<T extends Entity>(
  entity: T,
  workspaceVersion?: string | null,
): T {
  if (entity.versions && entity.versions.length > 0) {
    return entity;
  }
  return {
    ...entity,
    versions: resolveVersions(entity.versions, workspaceVersion),
  };
}
