/**
 * In-Memory Graph Module for Local Mode
 *
 * v0.3.1: 使用 root_id + id 作为图节点，关系来源于 0.0.0 版本实体
 */

import type { Database } from 'bun:sqlite';

type NodeKey = string; // `${root_id}:${id}`

function makeNodeKey(rootId: string | null, id: string): NodeKey {
  const normalized = rootId === '' || rootId === null ? 'null' : rootId;
  return `${normalized}:${id}`;
}

function normalizeRootId(rootId: string | null): string | null {
  if (rootId === '') return null;
  return rootId;
}

interface GraphNode {
  uuid: string | null;
  root_id: string | null;
  id: string;
  type: string | null;
  outgoing: Map<string, Set<NodeKey>>;
  incoming: Map<string, Set<NodeKey>>;
}

export interface DependencyResult {
  uuid: string | null;
  root_id: string | null;
  id: string;
  distance: number;
  type?: string | null;
  relation_type?: string;
}

export class InMemoryGraph {
  private nodes: Map<NodeKey, GraphNode> = new Map();
  private queryCache: Map<string, { result: unknown; expiresAt: number }> = new Map();

  load(db: Database): void {
    this.nodes.clear();
    this.queryCache.clear();

    const relations = db.prepare(`
      SELECT
        r.from_root_id,
        r.from_id,
        r.to_root_id,
        r.to_id,
        r.rel_type,
        ef.uuid as from_uuid,
        ef.type as from_type,
        et.uuid as to_uuid,
        et.type as to_type
      FROM relations r
      JOIN entity_versions vf ON r.from_uuid = vf.entity_uuid AND vf.version = '0.0.0'
      LEFT JOIN entities ef ON ef.uuid = r.from_uuid
      LEFT JOIN entities et ON et.uuid = r.to_uuid
      LEFT JOIN metadata mf ON mf.entity_uuid = r.from_uuid
      LEFT JOIN metadata mt ON mt.entity_uuid = r.to_uuid
      WHERE (r.status IS NULL OR r.status != 'deleted')
        AND (mf.status IS NULL OR mf.status NOT IN ('archived', 'deprecated'))
        AND (mt.status IS NULL OR mt.status NOT IN ('archived', 'deprecated'))
        AND (ef.type IS NULL OR ef.type NOT IN ('feat', 'checklist'))
        AND (et.type IS NULL OR et.type NOT IN ('feat', 'checklist'))
    `).all() as Array<{
      from_root_id: string;
      from_id: string;
      to_root_id: string;
      to_id: string;
      rel_type: string;
      from_uuid: string | null;
      from_type: string | null;
      to_uuid: string | null;
      to_type: string | null;
    }>;

    for (const rel of relations) {
      this.addRelation(
        normalizeRootId(rel.from_root_id),
        rel.from_id,
        normalizeRootId(rel.to_root_id),
        rel.to_id,
        rel.rel_type,
        rel.from_uuid,
        rel.from_type,
        rel.to_uuid,
        rel.to_type
      );
    }
  }

  addRelation(
    fromRootId: string | null,
    fromId: string,
    toRootId: string | null,
    toId: string,
    relType: string,
    fromUuid?: string | null,
    fromType?: string | null,
    toUuid?: string | null,
    toType?: string | null
  ): void {
    const fromKey = makeNodeKey(fromRootId, fromId);
    const toKey = makeNodeKey(toRootId, toId);

    const fromNode = this.ensureNode(fromKey, fromRootId, fromId);
    const toNode = this.ensureNode(toKey, toRootId, toId);

    if (fromUuid) fromNode.uuid = fromUuid;
    if (fromType) fromNode.type = fromType;
    if (toUuid) toNode.uuid = toUuid;
    if (toType) toNode.type = toType;

    if (!fromNode.outgoing.has(relType)) {
      fromNode.outgoing.set(relType, new Set());
    }
    fromNode.outgoing.get(relType)?.add(toKey);

    if (!toNode.incoming.has(relType)) {
      toNode.incoming.set(relType, new Set());
    }
    toNode.incoming.get(relType)?.add(fromKey);

    this.queryCache.clear();
  }

  removeRelation(
    fromRootId: string | null,
    fromId: string,
    toRootId: string | null,
    toId: string,
    relType: string
  ): void {
    const fromKey = makeNodeKey(fromRootId, fromId);
    const toKey = makeNodeKey(toRootId, toId);
    const fromNode = this.nodes.get(fromKey);
    const toNode = this.nodes.get(toKey);

    if (fromNode?.outgoing.has(relType)) {
      fromNode.outgoing.get(relType)?.delete(toKey);
    }
    if (toNode?.incoming.has(relType)) {
      toNode.incoming.get(relType)?.delete(fromKey);
    }

    this.queryCache.clear();
  }

  queryDeps(
    rootId: string | null,
    id: string,
    direction: 'upstream' | 'downstream' | 'both',
    depth: number
  ): DependencyResult[] {
    const cacheKey = `${rootId ?? 'null'}:${id}:${direction}:${depth}`;
    const cached = this.queryCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.result as DependencyResult[];
    }

    const results: DependencyResult[] = [];
    const visited = new Set<NodeKey>();
    const startKey = makeNodeKey(rootId, id);
    const queue: Array<{ key: NodeKey; distance: number; via?: string }> = [
      { key: startKey, distance: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      if (visited.has(current.key)) continue;
      visited.add(current.key);

      if (current.distance > 0) {
        const node = this.nodes.get(current.key);
        if (node) {
          results.push({
            uuid: node.uuid ?? null,
            root_id: node.root_id ?? null,
            id: node.id,
            distance: current.distance,
            type: node.type,
            relation_type: current.via,
          });
        }
      }

      if (current.distance >= depth) continue;
      const node = this.nodes.get(current.key);
      if (!node) continue;

      if (direction === 'downstream' || direction === 'both') {
        for (const [relType, targets] of node.outgoing.entries()) {
          for (const target of targets) {
            queue.push({ key: target, distance: current.distance + 1, via: relType });
          }
        }
      }

      if (direction === 'upstream' || direction === 'both') {
        for (const [relType, sources] of node.incoming.entries()) {
          for (const source of sources) {
            queue.push({ key: source, distance: current.distance + 1, via: relType });
          }
        }
      }
    }

    this.queryCache.set(cacheKey, { result: results, expiresAt: now + 1000 });
    return results;
  }

  private ensureNode(key: NodeKey, rootId: string | null, id: string): GraphNode {
    const existing = this.nodes.get(key);
    if (existing) return existing;
    const node: GraphNode = {
      uuid: null,
      root_id: rootId,
      id,
      type: null,
      outgoing: new Map(),
      incoming: new Map(),
    };
    this.nodes.set(key, node);
    return node;
  }
}
