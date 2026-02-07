/**
 * SQLite migration helpers (v0.3.1)
 */

import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

type MigrationResult = {
  migrated: boolean;
  entities: number;
  relations: number;
};

function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

export function migrateLegacySchema(db: Database): MigrationResult {
  if (hasColumn(db, 'entities', 'uuid')) {
    return { migrated: false, entities: 0, relations: 0 };
  }

  db.exec('ALTER TABLE entities RENAME TO entities_legacy;');
  db.exec('ALTER TABLE metadata RENAME TO metadata_legacy;');
  db.exec('ALTER TABLE relations RENAME TO relations_legacy;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      uuid TEXT PRIMARY KEY,
      root_id TEXT NOT NULL DEFAULT '',
      id TEXT NOT NULL,
      type TEXT NOT NULL,
      kind TEXT,
      scope TEXT,
      perspective TEXT,
      data TEXT NOT NULL,
      requirement_id TEXT,
      component_id TEXT,
      orphaned INTEGER DEFAULT 0,
      orphaned_at TEXT
    );

    CREATE TABLE IF NOT EXISTS metadata (
      entity_uuid TEXT NOT NULL PRIMARY KEY,
      source_repo TEXT,
      external_url TEXT,
      status TEXT NOT NULL,
      content_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      FOREIGN KEY (entity_uuid) REFERENCES entities(uuid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS entity_versions (
      entity_uuid TEXT NOT NULL,
      version TEXT NOT NULL,
      PRIMARY KEY (entity_uuid, version),
      FOREIGN KEY (entity_uuid) REFERENCES entities(uuid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      from_uuid TEXT NOT NULL,
      to_uuid TEXT,
      from_root_id TEXT NOT NULL DEFAULT '',
      from_id TEXT NOT NULL,
      to_root_id TEXT NOT NULL DEFAULT '',
      to_id TEXT NOT NULL,
      rel_type TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      properties TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const legacyRows = db.prepare(`
    SELECT e.id, e.root_id, e.requirement_id, e.type, e.kind, e.scope, e.perspective, e.data,
           m.source_repo, m.external_url, m.status, m.content_hash, m.created_at, m.updated_at, m.created_by, m.updated_by
    FROM entities_legacy e
    JOIN metadata_legacy m ON e.root_id = m.root_id
      AND e.id = m.entity_id AND e.requirement_id = m.requirement_id
  `).all() as Array<{
    id: string;
    root_id: string;
    requirement_id: string | null;
    type: string;
    kind: string | null;
    scope: string | null;
    perspective: string | null;
    data: string;
    source_repo: string | null;
    external_url: string | null;
    status: string;
    content_hash: string | null;
    created_at: string;
    updated_at: string;
    created_by: string | null;
    updated_by: string | null;
  }>;

  const map = new Map<string, string>();
  let entityCount = 0;

  const insertEntity = db.prepare(`
    INSERT INTO entities (uuid, root_id, id, type, kind, scope, perspective, data, requirement_id, component_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  const insertMeta = db.prepare(`
    INSERT INTO metadata (
      entity_uuid, source_repo, external_url, status, content_hash, created_at, updated_at, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertVersion = db.prepare(`INSERT INTO entity_versions (entity_uuid, version) VALUES (?, ?)`);

  for (const row of legacyRows) {
    const uuid = randomUUID();
    const rootId = row.type === 'feat' || row.type === 'checklist' ? '' : row.root_id ?? '';
    insertEntity.run(
      uuid,
      rootId,
      row.id,
      row.type,
      row.kind,
      row.scope,
      row.perspective,
      row.data,
      row.requirement_id ?? null
    );
    insertMeta.run(
      uuid,
      row.source_repo,
      row.external_url,
      row.status,
      row.content_hash,
      row.created_at,
      row.updated_at,
      row.created_by,
      row.updated_by
    );
    insertVersion.run(uuid, '0.0.0');
    const key = `${row.root_id ?? ''}|${row.id}|${row.requirement_id ?? ''}`;
    map.set(key, uuid);
    entityCount += 1;
  }

  const legacyRelations = db.prepare(`
    SELECT id, requirement_id, from_root_id, from_id, to_root_id, to_id, rel_type, status, properties, created_at, updated_at
    FROM relations_legacy
  `).all() as Array<{
    id: string;
    requirement_id: string | null;
    from_root_id: string;
    from_id: string;
    to_root_id: string;
    to_id: string;
    rel_type: string;
    status: string | null;
    properties: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>;

  let relationCount = 0;
  const insertRelation = db.prepare(`
    INSERT INTO relations (
      id, from_uuid, to_uuid, from_root_id, from_id, to_root_id, to_id, rel_type, status, properties, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rel of legacyRelations) {
    const fromKey = `${rel.from_root_id ?? ''}|${rel.from_id}|${rel.requirement_id ?? ''}`;
    const toKey = `${rel.to_root_id ?? ''}|${rel.to_id}|${rel.requirement_id ?? ''}`;
    const fromUuid = map.get(fromKey);
    if (!fromUuid) continue;
    const toUuid = map.get(toKey) ?? null;
    insertRelation.run(
      rel.id,
      fromUuid,
      toUuid,
      rel.from_root_id ?? '',
      rel.from_id,
      rel.to_root_id ?? '',
      rel.to_id,
      rel.rel_type,
      rel.status ?? 'active',
      rel.properties,
      rel.created_at ?? null,
      rel.updated_at ?? null
    );
    relationCount += 1;
  }

  db.exec('DROP TABLE IF EXISTS entities_legacy;');
  db.exec('DROP TABLE IF EXISTS metadata_legacy;');
  db.exec('DROP TABLE IF EXISTS relations_legacy;');
  db.exec('DROP TABLE IF EXISTS feats;');

  return { migrated: true, entities: entityCount, relations: relationCount };
}
