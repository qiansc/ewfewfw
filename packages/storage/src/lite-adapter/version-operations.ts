/**
 * LiteAdapter 版本操作 (v0.3.1)
 */

import { randomUUID } from 'node:crypto';
import type { Entity } from '../adapter.js';
import type { AdapterContext } from './types.js';
import { rowToEntity } from './helpers.js';

function loadVersions(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  uuid: string
): string[] {
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

export async function readByUuid(ctx: AdapterContext, uuid: string): Promise<Entity | null> {
  const db = ctx.store.getDatabase();
  return loadEntityByUuid(db, uuid);
}

export async function addVersion(
  ctx: AdapterContext,
  uuid: string,
  version: string
): Promise<Entity> {
  const db = ctx.store.getDatabase();
  db.prepare(`INSERT OR IGNORE INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(
    uuid,
    version
  );
  const entity = loadEntityByUuid(db, uuid);
  if (!entity) throw new Error('C4A-ENTITY-404');
  return entity;
}

export async function removeVersion(
  ctx: AdapterContext,
  uuid: string,
  version: string
): Promise<Entity> {
  const db = ctx.store.getDatabase();
  const existing = loadEntityByUuid(db, uuid);
  if (!existing) throw new Error('C4A-ENTITY-404');
  db.prepare(`DELETE FROM entity_versions WHERE entity_uuid = ? AND version = ?`).run(uuid, version);
  const remaining = loadVersions(db, uuid);
  if (remaining.length === 0) {
    db.prepare(`DELETE FROM entities WHERE uuid = ?`).run(uuid);
    return {
      ...existing,
      versions: [],
    };
  }
  const entity = loadEntityByUuid(db, uuid);
  if (!entity) throw new Error('C4A-ENTITY-404');
  return entity;
}

export async function splitEntity(
  ctx: AdapterContext,
  uuid: string,
  version: string,
  newData: Record<string, unknown>
): Promise<string> {
  const db = ctx.store.getDatabase();
  const existing = loadEntityByUuid(db, uuid);
  if (!existing) throw new Error('C4A-ENTITY-404');
  const existingVersions = existing.versions ?? [];
  if (!existingVersions.includes(version)) {
    throw new Error('C4A-VERSION-003');
  }

  const newUuid = randomUUID();
  const mergedData = { ...(existing.data ?? {}), ...(newData ?? {}) } as Record<string, unknown>;
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`DELETE FROM entity_versions WHERE entity_uuid = ? AND version = ?`).run(uuid, version);

    db.prepare(
      `
      INSERT INTO entities (
        uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id, orphaned, orphaned_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
    `
    ).run(
      newUuid,
      existing.root_id ?? '',
      existing.id,
      existing.type,
      existing.kind ?? null,
      existing.scope ?? null,
      existing.perspective ?? null,
      JSON.stringify(mergedData),
      existing.requirement_id ?? null,
      existing.component_id ?? null
    );

    db.prepare(
      `
      INSERT INTO metadata (
        entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      newUuid,
      existing.metadata.source_repo ?? null,
      existing.metadata.external_url ?? null,
      existing.metadata.status,
      existing.metadata.content_hash ?? null,
      existing.metadata.created_at ?? now,
      now,
      existing.metadata.created_by ?? null,
      existing.metadata.updated_by ?? null
    );

    db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`).run(newUuid, version);
  })();

  return newUuid;
}

export async function listVersions(ctx: AdapterContext, rootId: string): Promise<string[]> {
  const db = ctx.store.getDatabase();
  const rows = db
    .prepare(
      `
      SELECT DISTINCT v.version
      FROM entities e
      JOIN entity_versions v ON e.uuid = v.entity_uuid
      WHERE e.root_id = ?
    `
    )
    .all(rootId) as Array<{ version: string }>;
  return rows.map((row) => row.version).sort();
}
