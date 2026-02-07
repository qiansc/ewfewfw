import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { migrateLegacySchema } from '../sqliteMigrate.js';

const paths: string[] = [];

afterEach(() => {
  while (paths.length > 0) {
    const path = paths.pop();
    if (!path) continue;
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

describe('sqlite migrate v0.3.1', () => {
  test('migrates legacy schema and keeps data integrity', () => {
    mkdirSync(join(process.cwd(), '.tmp'), { recursive: true });
    const dbPath = join(process.cwd(), '.tmp', `sqlite-migrate-${randomUUID()}.db`);
    paths.push(dbPath);
    const db = new Database(dbPath);

    db.exec(`
      CREATE TABLE entities (
        id TEXT NOT NULL,
        root_id TEXT NOT NULL,
        requirement_id TEXT,
        type TEXT NOT NULL,
        kind TEXT,
        scope TEXT,
        perspective TEXT,
        data TEXT NOT NULL,
        PRIMARY KEY (root_id, id, requirement_id)
      );
      CREATE TABLE metadata (
        entity_id TEXT NOT NULL,
        root_id TEXT NOT NULL,
        requirement_id TEXT,
        source_repo TEXT,
        external_url TEXT,
        status TEXT NOT NULL,
        content_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT,
        PRIMARY KEY (root_id, entity_id, requirement_id)
      );
      CREATE TABLE relations (
        id TEXT PRIMARY KEY,
        requirement_id TEXT,
        from_root_id TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_root_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        rel_type TEXT NOT NULL,
        status TEXT,
        properties TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE feats (
        id TEXT PRIMARY KEY
      );
    `);

    db.prepare(`
      INSERT INTO entities (id, root_id, requirement_id, type, data)
      VALUES ('sys-a', 'alpha', 'feat-a001', 'system', ?)
    `).run(JSON.stringify({ id: 'sys-a', type: 'system' }));
    db.prepare(`
      INSERT INTO metadata (
        entity_id, root_id, requirement_id, status, content_hash, created_at, updated_at
      ) VALUES ('sys-a', 'alpha', 'feat-a001', 'draft', 'hash-a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run();
    db.prepare(`
      INSERT INTO entities (id, root_id, requirement_id, type, data)
      VALUES ('feat-a001', '', '', 'feat', ?)
    `).run(JSON.stringify({ id: 'feat-a001', type: 'feat' }));
    db.prepare(`
      INSERT INTO metadata (
        entity_id, root_id, requirement_id, status, content_hash, created_at, updated_at
      ) VALUES ('feat-a001', '', '', 'approved', 'hash-feat', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run();

    db.prepare(`
      INSERT INTO relations (id, requirement_id, from_root_id, from_id, to_root_id, to_id, rel_type)
      VALUES ('rel-1', 'feat-a001', 'alpha', 'sys-a', '', 'feat-a001', 'DEPENDS_ON')
    `).run();

    const result = migrateLegacySchema(db);
    expect(result.migrated).toBe(true);
    expect(result.entities).toBe(2);
    expect(result.relations).toBe(1);

    const systemRow = db.prepare(`
      SELECT root_id, requirement_id
      FROM entities
      WHERE id = 'sys-a'
      LIMIT 1
    `).get() as { root_id: string; requirement_id: string } | undefined;
    expect(systemRow?.root_id).toBe('alpha');
    expect(systemRow?.requirement_id).toBe('feat-a001');

    const featRow = db.prepare(`
      SELECT root_id
      FROM entities
      WHERE id = 'feat-a001'
      LIMIT 1
    `).get() as { root_id: string } | undefined;
    expect(featRow?.root_id).toBe('');

    const versionCount = db.prepare(`SELECT COUNT(1) as count FROM entity_versions`).get() as
      | { count: number }
      | undefined;
    expect(versionCount?.count).toBe(2);

    const legacyTables = db
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name IN ('entities_legacy', 'metadata_legacy', 'relations_legacy', 'feats')
      `)
      .all() as Array<{ name: string }>;
    expect(legacyTables).toHaveLength(0);

    db.close();
  });
});
