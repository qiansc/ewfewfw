import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { InMemoryGraph } from '../in-memory-graph.js';

const TMP_ROOT = join(process.cwd(), '.tmp', 'graph-load-tests');
const DB_PATH = join(TMP_ROOT, `graph-load-${Date.now()}.db`);

let db: Database;

beforeAll(() => {
  mkdirSync(TMP_ROOT, { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT NOT NULL,
      source_project TEXT NOT NULL DEFAULT '',
      proposal_id TEXT NOT NULL DEFAULT '',
      type TEXT
    );

    CREATE TABLE IF NOT EXISTS metadata (
      entity_id TEXT NOT NULL,
      source_project TEXT NOT NULL DEFAULT '',
      proposal_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL DEFAULT '',
      from_project TEXT NOT NULL DEFAULT '',
      from_id TEXT NOT NULL,
      to_project TEXT NOT NULL DEFAULT '',
      to_id TEXT NOT NULL,
      rel_type TEXT NOT NULL,
      status TEXT DEFAULT 'active'
    );
  `);
});

beforeEach(() => {
  db.exec('DELETE FROM relations;');
  db.exec('DELETE FROM metadata;');
  db.exec('DELETE FROM entities;');
});

afterAll(() => {
  db.close();
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('InMemoryGraph load merge view', () => {
  test('feat deleted relation hides main branch relation', () => {
    const nowStatus = 'published';
    db.prepare(`
      INSERT INTO entities (id, source_project, proposal_id, type)
      VALUES (?, ?, ?, ?)
    `).run('svc', 'alpha', '', 'system');
    db.prepare(`
      INSERT INTO entities (id, source_project, proposal_id, type)
      VALUES (?, ?, ?, ?)
    `).run('dep', 'alpha', '', 'container');

    db.prepare(`
      INSERT INTO metadata (entity_id, source_project, proposal_id, status)
      VALUES (?, ?, ?, ?)
    `).run('svc', 'alpha', '', nowStatus);
    db.prepare(`
      INSERT INTO metadata (entity_id, source_project, proposal_id, status)
      VALUES (?, ?, ?, ?)
    `).run('dep', 'alpha', '', nowStatus);

    db.prepare(`
      INSERT INTO relations (id, proposal_id, from_project, from_id, to_project, to_id, rel_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('rel-main', '', 'alpha', 'svc', 'alpha', 'dep', 'DEPENDS_ON', 'active');
    db.prepare(`
      INSERT INTO relations (id, proposal_id, from_project, from_id, to_project, to_id, rel_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('rel-feat', 'feat-a', 'alpha', 'svc', 'alpha', 'dep', 'DEPENDS_ON', 'deleted');

    const graph = new InMemoryGraph();

    graph.load(db, null);
    expect(graph.getRelationCount()).toBe(1);

    graph.load(db, 'feat-a');
    expect(graph.getRelationCount()).toBe(0);
  });
});
