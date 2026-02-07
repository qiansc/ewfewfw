import type { SQLiteStore } from '../sqlite-store.js';

type Database = ReturnType<SQLiteStore['getDatabase']>;

export function resolveCheckScope(
  db: Database,
  baseEntities: Array<{ id: string; root_id: string }>,
  requirementId: string,
  checkDepth: number | null
): Set<string> {
  const scope = new Set<string>(baseEntities.map((e) => `${e.root_id}::${e.id}`));
  if (scope.size === 0) return scope;
  const depth = Math.max(checkDepth ?? 0, 0);
  let frontier = new Set(scope);

  for (let i = 0; i < depth; i++) {
    const frontierIds = Array.from(frontier);
    if (frontierIds.length === 0) break;
    const fromPairs = frontierIds.map((id) => id.split('::'));
    const placeholders = fromPairs.map(() => '(? , ?)').join(', ');
    const rows = db
      .prepare(
        `
      SELECT DISTINCT to_root_id, to_id
      FROM relations
      WHERE (from_root_id, from_id) IN (${placeholders})
        AND (status IS NULL OR status != 'deleted')
    `
      )
      .all(...fromPairs.flat()) as Array<{ to_root_id: string; to_id: string }>;
    frontier = new Set();
    for (const row of rows) {
      const key = `${row.to_root_id}::${row.to_id}`;
      if (!scope.has(key)) {
        scope.add(key);
        frontier.add(key);
      }
    }
  }

  return scope;
}

export function loadEntitiesForScope(
  db: Database,
  baseEntities: Array<{ id: string; type: string; data: string; status: string; root_id: string }>,
  scopeIds: Set<string> | null
): Array<{ id: string; type: string; data: string; status: string; root_id: string }> {
  const scopeList =
    scopeIds && scopeIds.size > 0 ? Array.from(scopeIds) : baseEntities.map((e) => `${e.root_id}::${e.id}`);
  const featIds = new Set(baseEntities.map((e) => `${e.root_id}::${e.id}`));
  const missingIds = scopeList.filter((id) => !featIds.has(id));
  if (missingIds.length === 0) return baseEntities;

  const pairs = missingIds.map((id) => id.split('::'));
  const placeholders = pairs.map(() => '(? , ?)').join(', ');
  const mainEntities = db
    .prepare(
      `
    SELECT e.id, e.type, e.data, m.status, e.root_id
    FROM entities e
    JOIN metadata m ON e.uuid = m.entity_uuid
    WHERE (e.requirement_id IS NULL OR e.requirement_id = '')
      AND (e.root_id, e.id) IN (${placeholders})
  `
    )
    .all(...pairs.flat()) as Array<{ id: string; type: string; data: string; status: string; root_id: string }>;

  return [...baseEntities, ...mainEntities];
}
