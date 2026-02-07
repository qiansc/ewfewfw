/**
 * LiteAdapter Read/List/Delete (v0.3.1)
 */

import type { Entity } from '../adapter.js';
import type { EntityFilter } from '../adapterCrudTypes.js';
import type { AdapterContext } from './types.js';
import { rowToEntity } from './helpers.js';
import { generateVectorKey } from '../vector-search.js';

function loadVersions(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  uuid: string
): string[] {
  return db
    .prepare(`SELECT version FROM entity_versions WHERE entity_uuid = ?`)
    .all(uuid)
    .map((row) => (row as { version: string }).version);
}

function buildEntityFromRow(
  db: ReturnType<typeof import('../sqlite-store.js').SQLiteStore.prototype.getDatabase>,
  row: {
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
): Entity {
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

export async function read(
  ctx: AdapterContext,
  rootId: string,
  id: string,
  version?: string
): Promise<Entity | null> {
  const db = ctx.store.getDatabase();
  const targetVersion = version ?? '0.0.0';

  const row = db
    .prepare(
      `
      SELECT e.uuid, e.root_id, e.id, e.type, e.kind, e.scope, e.perspective,
             e.data, e.requirement_id, e.component_id,
             m.status, m.content_hash, m.created_at, m.updated_at,
             m.source_repo, m.external_url, m.created_by, m.updated_by
      FROM entities e
      JOIN metadata m ON e.uuid = m.entity_uuid
      JOIN entity_versions v ON e.uuid = v.entity_uuid
      WHERE e.root_id = ? AND e.id = ? AND v.version = ?
      LIMIT 1
    `
    )
    .get(rootId ?? '', id, targetVersion) as
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
  return buildEntityFromRow(db, row);
}

export async function list(ctx: AdapterContext, filter: EntityFilter): Promise<Entity[]> {
  const db = ctx.store.getDatabase();
  const conditions: string[] = [];
  const conditionArgs: Array<string | number> = [];

  if (filter.root_id !== undefined) {
    conditions.push('e.root_id = ?');
    conditionArgs.push(filter.root_id);
  }
  if (filter.id) {
    conditions.push('e.id = ?');
    conditionArgs.push(filter.id);
  }
  if (filter.requirement_id) {
    conditions.push('e.requirement_id = ?');
    conditionArgs.push(filter.requirement_id);
  }
  if (filter.type) {
    if (Array.isArray(filter.type)) {
      const placeholders = filter.type.map(() => '?').join(', ');
      conditions.push(`e.type IN (${placeholders})`);
      conditionArgs.push(...filter.type);
    } else {
      conditions.push('e.type = ?');
      conditionArgs.push(filter.type);
    }
  }

  let versionJoin = '';
  const versionArgs: string[] = [];
  if (filter.version) {
    versionJoin = 'JOIN entity_versions v ON e.uuid = v.entity_uuid AND v.version = ?';
    versionArgs.push(filter.version);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = filter.limit ? `LIMIT ${filter.limit}` : '';
  const offsetClause = filter.offset ? `OFFSET ${filter.offset}` : '';

  const rows = db.prepare(
    `
    SELECT e.uuid, e.root_id, e.id, e.type, e.kind, e.scope, e.perspective,
           e.data, e.requirement_id, e.component_id,
           m.status, m.content_hash, m.created_at, m.updated_at,
           m.source_repo, m.external_url, m.created_by, m.updated_by
    FROM entities e
    JOIN metadata m ON e.uuid = m.entity_uuid
    ${versionJoin}
    ${whereClause}
    ${limitClause}
    ${offsetClause}
  `
  ).all(...versionArgs, ...conditionArgs) as Array<{
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
  }>;

  return rows.map((row) => buildEntityFromRow(db, row));
}

export async function del(ctx: AdapterContext, uuid: string): Promise<void> {
  const db = ctx.store.getDatabase();
  const vectorStore = ctx.store.getVectorStore();
  const vectorKey = generateVectorKey(uuid);

  db.transaction(() => {
    db.prepare('DELETE FROM relations WHERE from_uuid = ? OR to_uuid = ?').run(uuid, uuid);
    db.prepare('DELETE FROM entities WHERE uuid = ?').run(uuid);
  })();

  if (vectorStore) {
    vectorStore.remove(vectorKey);
  }
}
