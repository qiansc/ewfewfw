/**
 * LiteAdapter Save 操作 (v0.3.1)
 */

import { randomUUID } from 'node:crypto';
import { getWriteQueue } from '../write-queue.js';
import type { Entity, EntityStatus } from '../adapter.js';
import type { EntityInput, SaveOptions } from '../adapterCrudTypes.js';
import type { AdapterContext } from './types.js';
import { computeHash, rowToEntity } from './helpers.js';
import { parseRelations, persistRelations, updateGraph, type RelationsChangeSet } from './relations.js';
import { updateVectorIndex } from './crud-save-vector.js';

function normalizeStatus(input?: string): EntityStatus | null {
  if (!input) return null;
  const value = input.toLowerCase();
  if (value === 'draft' || value === 'approved' || value === 'published' || value === 'deprecated' || value === 'archived') {
    return value as EntityStatus;
  }
  return null;
}

function loadVersions(db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>, uuid: string): string[] {
  return db
    .prepare(`SELECT version FROM entity_versions WHERE entity_uuid = ?`)
    .all(uuid)
    .map((row) => (row as { version: string }).version);
}

function loadEntityByUuid(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  uuid: string
): Entity | null {
  const row = db
    .prepare(
      `
      SELECT e.uuid, e.root_id, e.id, e.type, e.kind, e.scope, e.perspective,
             e.data, e.requirement_id, e.component_id,
             m.status, m.content_hash, m.created_at, m.updated_at,
             m.source_repo, m.external_url, m.created_by, m.updated_by
      FROM entities e
      JOIN metadata m ON e.uuid = m.entity_uuid
      WHERE e.uuid = ?
      LIMIT 1
    `
    )
    .get(uuid) as
    | {
        uuid: string;
        root_id: string;
        id: string;
        type: string;
        kind: string | null;
        scope: string | null;
        perspective: string | null;
        data: string;
        requirement_id: string | null;
        component_id: string | null;
        status: string;
        content_hash: string | null;
        created_at: string;
        updated_at: string;
        source_repo: string | null;
        external_url: string | null;
        created_by: string | null;
        updated_by: string | null;
      }
    | undefined;

  if (!row) return null;
  const versions = loadVersions(db, row.uuid);
  return rowToEntity(
    {
      uuid: row.uuid,
      root_id: row.root_id,
      id: row.id,
      type: row.type,
      kind: row.kind,
      scope: row.scope,
      perspective: row.perspective,
      data: row.data,
      requirement_id: row.requirement_id,
      component_id: row.component_id,
      status: row.status,
      content_hash: row.content_hash,
      created_at: row.created_at,
      updated_at: row.updated_at,
      source_repo: row.source_repo,
      external_url: row.external_url,
      created_by: row.created_by,
      updated_by: row.updated_by,
    },
    versions
  );
}

/**
 * 保存实体（使用写队列串行化）
 */
export async function save(
  ctx: AdapterContext,
  input: EntityInput,
  options: SaveOptions = {}
): Promise<Entity> {
  return getWriteQueue().enqueue(async () => {
    return doSave(ctx, input, options);
  });
}

async function doSave(
  ctx: AdapterContext,
  input: EntityInput,
  options: SaveOptions
): Promise<Entity> {
  const db = ctx.store.getDatabase();
  const now = new Date().toISOString();

  let rootId = input.root_id ?? input.root_id ?? ctx.config.defaultProject;
  if (input.type === 'feat' || input.type === 'checklist') {
    rootId = '';
  }
  if (rootId === undefined || rootId === null) {
    throw new Error('root_id is required');
  }

  const id = input.id || (input.data as { id?: string } | undefined)?.id;
  if (!id) {
    throw new Error('id is required');
  }

  const uuid = input.uuid ?? randomUUID();
  const existing = loadEntityByUuid(db, uuid);

  if (options.expected_updated_at && existing?.metadata.updated_at !== options.expected_updated_at && !options.force) {
    throw new Error('C4A-DATA-002: updated_at mismatch');
  }

  const data = input.data;
  if (!data) {
    throw new Error('data is required');
  }

  if ((data as { id?: string }).id === undefined) {
    (data as { id?: string }).id = id;
  }

  const requestedStatus = normalizeStatus((input.metadata as { status?: string } | undefined)?.status);
  const defaultStatus: EntityStatus =
    input.type === 'feat' || input.type === 'checklist' ? 'draft' : 'published';
  const status = requestedStatus ?? existing?.metadata.status ?? defaultStatus;

  const contentHash = computeHash(data);
  const createdAt = existing?.metadata.created_at ?? now;
  const updatedAt = now;

  const nextVersions =
    existing?.versions ?? (input.versions && input.versions.length > 0 ? input.versions : ['0.0.0']);

  const relations =
    input.type === 'feat' || input.type === 'checklist'
      ? []
      : parseRelations(ctx, data, rootId, id, input.type, null);

  let relationChangeset: RelationsChangeSet | null = null;

  db.transaction(() => {
    db.prepare(
      `
      INSERT INTO entities (
        uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id, orphaned, orphaned_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
      ON CONFLICT(uuid) DO UPDATE SET
        root_id = excluded.root_id,
        id = excluded.id,
        type = excluded.type,
        kind = excluded.kind,
        scope = excluded.scope,
        perspective = excluded.perspective,
        data = excluded.data,
        requirement_id = excluded.requirement_id,
        component_id = excluded.component_id
    `
    ).run(
      uuid,
      rootId,
      id,
      input.type,
      input.kind ?? null,
      input.scope ?? null,
      input.perspective ?? null,
      JSON.stringify(data),
      input.requirement_id ?? null,
      input.component_id ?? null
    );

    db.prepare(
      `
      INSERT INTO metadata (
        entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_uuid) DO UPDATE SET
        source_repo = excluded.source_repo,
        external_url = excluded.external_url,
        status = excluded.status,
        content_hash = excluded.content_hash,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        created_by = excluded.created_by,
        updated_by = excluded.updated_by
    `
    ).run(
      uuid,
      input.metadata?.source_repo ?? existing?.metadata.source_repo ?? null,
      input.metadata?.external_url ?? existing?.metadata.external_url ?? null,
      status,
      contentHash,
      createdAt,
      updatedAt,
      input.metadata?.created_by ?? existing?.metadata.created_by ?? null,
      input.metadata?.updated_by ?? existing?.metadata.updated_by ?? null
    );

    if (!existing) {
      const insertVersion = db.prepare(
        `INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`
      );
      for (const version of nextVersions) {
        insertVersion.run(uuid, version);
      }
    }

    relationChangeset = persistRelations(ctx, rootId, id, uuid, relations);
  })();

  if (relationChangeset) {
    updateGraph(ctx, relationChangeset);
  }

  if (ctx.config.enableVectorSearch) {
    await updateVectorIndex(ctx, uuid, input.type, data);
  }

  const saved = loadEntityByUuid(db, uuid);
  if (!saved) {
    throw new Error('Failed to load saved entity');
  }
  return saved;
}
