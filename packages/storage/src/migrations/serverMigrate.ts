/**
 * Server 迁移工具（v0.3.1）
 */

import { randomUUID } from 'node:crypto';
import type { Entity } from '../adapter.js';
import type { EntityType } from '../adapterBaseTypes.js';

export interface LegacyEntityRecord {
  id: string;
  type: EntityType;
  data: Record<string, unknown>;
  root_id?: string | null;
  requirement_id?: string | null;
  source_repo?: string | null;
  external_url?: string | null;
  status?: 'draft' | 'approved' | 'published' | 'deprecated' | 'archived';
  content_hash?: string | null;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  updated_by?: string | null;
  version?: string | null;
  versions?: string[];
  uuid?: string;
}

export function migrateLegacyEntities(rows: LegacyEntityRecord[]): {
  entities: Entity[];
  skipped: number;
  legacyKeyToUuid: Map<string, string>;
} {
  const entities: Entity[] = [];
  const legacyKeyToUuid = new Map<string, string>();
  let skipped = 0;

  for (const row of rows) {
    if (!row.id || !row.type) {
      skipped += 1;
      continue;
    }
    const uuid = row.uuid ?? randomUUID();
    const rootId =
      row.root_id ??
      (row.type === 'feat' || row.type === 'checklist' ? '' : normalizeNullableString(row.root_id));
    const versions = normalizeVersions(row);
    const now = new Date().toISOString();
    const requirementId =
      row.requirement_id ??
      normalizeNullableString(row.requirement_id) ??
      undefined;

    const entity: Entity = {
      uuid,
      id: row.id,
      type: row.type,
      root_id: rootId,
      data: row.data ?? { id: row.id, type: row.type },
      requirement_id: requirementId,
      versions,
      metadata: {
        source_repo: normalizeNullableString(row.source_repo) || undefined,
        external_url: normalizeNullableString(row.external_url) || null,
        status: row.status ?? 'published',
        content_hash: normalizeNullableString(row.content_hash) || undefined,
        created_at: row.created_at ?? now,
        updated_at: row.updated_at ?? now,
        created_by: normalizeNullableString(row.created_by) || undefined,
        updated_by: normalizeNullableString(row.updated_by) || undefined,
      },
    };

    entities.push(entity);
    legacyKeyToUuid.set(buildLegacyKey(row.root_id, row.id, row.requirement_id), uuid);
  }

  return { entities, skipped, legacyKeyToUuid };
}

function normalizeVersions(row: LegacyEntityRecord): string[] {
  if (Array.isArray(row.versions) && row.versions.length > 0) {
    return Array.from(new Set(row.versions));
  }
  if (row.version && row.version.length > 0) {
    return [row.version];
  }
  return ['0.0.0'];
}

function normalizeNullableString(value: string | null | undefined): string {
  return value ?? '';
}

function buildLegacyKey(rootId: string | null | undefined, id: string, requirementId: string | null | undefined): string {
  return `${rootId ?? ''}|${id}|${requirementId ?? ''}`;
}
