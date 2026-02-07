/**
 * Neo4jAdapter (v0.3.1)
 *
 * - 配置 neo4jUrl 时：使用 neo4j-driver 直连
 * - 未配置 neo4jUrl 时：使用内存图（用于本地测试）
 */

import neo4j from 'neo4j-driver';
import type { Driver, Session } from 'neo4j-driver';
import type { DepsParams, DepsResult, Entity, ImpactParams, ImpactResult } from '../adapter.js';
import type { EntityType } from '../adapterBaseTypes.js';
import type { ServerConfig } from '../get-adapter.js';

type GraphNode = {
  state_uuid: string;
  entity_uuid: string;
  version: string;
  id: string;
  root_id: string;
  type: EntityType;
  out: Array<{ to_state_uuid: string; rel_type: string }>;
};

export class Neo4jAdapter {
  private config: ServerConfig;
  private driver: Driver | null = null;
  private nodes = new Map<string, GraphNode>();

  constructor(config: ServerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (!this.config.neo4jUrl) {
      return;
    }
    if (this.driver) {
      return;
    }

    this.driver = neo4j.driver(
      this.config.neo4jUrl,
      neo4j.auth.basic(this.config.neo4jUser ?? 'neo4j', this.config.neo4jPassword ?? 'password')
    );

    await this.driver.verifyConnectivity();
    const session = this.driver.session();
    try {
      await session.run(
        'CREATE CONSTRAINT entity_state_uuid_unique IF NOT EXISTS FOR (n:Entity) REQUIRE n.state_uuid IS UNIQUE'
      );
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    this.nodes.clear();
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.driver) {
      return true;
    }
    try {
      await this.driver.verifyConnectivity();
      return true;
    } catch {
      return false;
    }
  }

  async upsertEntity(entity: Entity): Promise<void> {
    const uuid = entity.uuid;
    if (!uuid) {
      return;
    }

    if (entity.type === 'feat' || entity.type === 'checklist') {
      await this.deleteEntity(uuid);
      return;
    }

    const outEdges = extractRelations(entity.data);
    const versions = normalizeVersions(entity.versions);

    if (!this.driver) {
      for (const key of this.nodes.keys()) {
        if (key.startsWith(`${uuid}:`)) {
          this.nodes.delete(key);
        }
      }
      for (const version of versions) {
        const stateUuid = buildStateUuid(uuid, version);
        this.nodes.set(stateUuid, {
          state_uuid: stateUuid,
          entity_uuid: uuid,
          version,
          id: entity.id,
          root_id: entity.root_id ?? '',
          type: entity.type,
          out: outEdges.map((edge) => ({
            to_state_uuid: buildStateUuid(edge.to_uuid, version),
            rel_type: edge.rel_type,
          })),
        });
      }
      this.ensureEvolvesChainInMemory(uuid, versions);
      return;
    }

    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (n:Entity {entity_uuid: $entity_uuid})
        WHERE NOT n.version IN $versions
        DETACH DELETE n
      `,
        { entity_uuid: uuid, versions }
      );

      for (const version of versions) {
        const stateUuid = buildStateUuid(uuid, version);
        await session.run(
          `
          MERGE (n:Entity {state_uuid: $state_uuid})
          SET n.entity_uuid = $entity_uuid,
              n.id = $id,
              n.root_id = $root_id,
              n.type = $type,
              n.version = $version,
              n.updated_at = $updated_at
        `,
          {
            state_uuid: stateUuid,
            entity_uuid: uuid,
            id: entity.id,
            root_id: entity.root_id ?? '',
            type: entity.type,
            version,
            updated_at: entity.metadata.updated_at,
          }
        );

        await session.run(
          `
          MATCH (n:Entity {state_uuid: $state_uuid})-[r:RELATED]->()
          DELETE r
        `,
          { state_uuid: stateUuid }
        );

        for (const edge of outEdges) {
          const toStateUuid = buildStateUuid(edge.to_uuid, version);
          await session.run(
            `
            MERGE (to:Entity {state_uuid: $to_state_uuid})
            ON CREATE SET to.entity_uuid = $to_entity_uuid, to.id = $to_id, to.root_id = $to_root_id, to.type = $to_type, to.version = $to_version
            WITH to
            MATCH (from:Entity {state_uuid: $from_state_uuid})
            MERGE (from)-[r:RELATED {rel_type: $rel_type}]->(to)
            SET r.updated_at = $updated_at
          `,
            {
              from_state_uuid: stateUuid,
              to_state_uuid: toStateUuid,
              to_entity_uuid: edge.to_uuid,
              to_id: edge.to_id,
              to_root_id: edge.to_root_id,
              to_type: edge.to_type,
              to_version: version,
              rel_type: edge.rel_type,
              updated_at: entity.metadata.updated_at,
            }
          );
        }
      }

      await session.run(
        `
        MATCH (n:Entity {entity_uuid: $entity_uuid})-[r:EVOLVES_TO]->()
        DELETE r
      `,
        { entity_uuid: uuid }
      );
      await this.ensureEvolvesChain(session, uuid, versions);
    } finally {
      await session.close();
    }
  }

  async queryDeps(params: DepsParams): Promise<DepsResult> {
    if (!this.driver) {
      return this.queryDepsInMemory(params);
    }

    const startUuid = await this.resolveStartStateUuid(params);
    if (!startUuid) {
      return { nodes: [], degraded: false };
    }

    const depth = normalizeDepth(params.depth);
    const direction = params.direction ?? 'both';

    try {
      const nodes = await this.queryDepsWithCypher(startUuid, direction, depth);
      return { nodes, degraded: false };
    } catch {
      return { nodes: [], degraded: true, degraded_reason: 'NEO4J_QUERY_FAILED' };
    }
  }

  async queryImpact(params: ImpactParams): Promise<ImpactResult> {
    if (!this.driver) {
      const deps = await this.queryDepsInMemory({
        uuid: params.uuid,
        id: params.id,
        root_id: params.root_id,
        direction: 'downstream',
        depth: params.depth,
      });
      return {
        nodes: deps.nodes.map((node) => ({
          uuid: node.uuid,
          id: node.id,
          root_id: node.root_id,
          type: node.type,
          distance: node.distance,
          impact_level: node.distance === 1 ? 'direct' : 'indirect',
          reason: `${node.relation_type} dependency`,
        })),
        degraded: deps.degraded,
        degraded_reason: deps.degraded_reason,
      };
    }

    const startUuid = await this.resolveStartStateUuid(params);
    if (!startUuid) {
      return { nodes: [], degraded: false };
    }

    const depth = normalizeDepth(params.depth);
    try {
      const deps = await this.queryDepsWithCypher(startUuid, 'downstream', depth);
      return {
        nodes: deps.map((node) => ({
          uuid: node.uuid,
          id: node.id,
          root_id: node.root_id,
          type: node.type,
          distance: node.distance,
          impact_level: node.distance === 1 ? 'direct' : 'indirect',
          reason: `${node.relation_type} dependency`,
        })),
        degraded: false,
      };
    } catch {
      return { nodes: [], degraded: true, degraded_reason: 'NEO4J_QUERY_FAILED' };
    }
  }

  async deleteEntity(uuid: string): Promise<void> {
    if (!this.driver) {
      for (const key of this.nodes.keys()) {
        if (key.startsWith(`${uuid}:`)) {
          this.nodes.delete(key);
        }
      }
      for (const node of this.nodes.values()) {
        node.out = node.out.filter((edge) => !edge.to_state_uuid.startsWith(`${uuid}:`));
      }
      return;
    }

    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (n:Entity {entity_uuid: $uuid})
        DETACH DELETE n
      `,
        { uuid }
      );
    } finally {
      await session.close();
    }
  }

  async rebuildFromEntities(entities: Entity[]): Promise<void> {
    if (!this.driver) {
      this.nodes.clear();
      for (const entity of entities) {
        await this.upsertEntity(entity);
      }
      return;
    }

    const session = this.driver.session();
    try {
      await session.run('MATCH (n:Entity) DETACH DELETE n');
    } finally {
      await session.close();
    }
    for (const entity of entities) {
      await this.upsertEntity(entity);
    }
  }

  private async queryDepsWithCypher(
    startUuid: string,
    direction: 'upstream' | 'downstream' | 'both',
    depth: number
  ): Promise<DepsResult['nodes']> {
    if (!this.driver) {
      return [];
    }

    const session = this.driver.session();
    try {
      const nodesByUuid = new Map<string, DepsResult['nodes'][number]>();
      if (direction === 'downstream' || direction === 'both') {
        const downstream = await this.queryPath(session, startUuid, 'downstream', depth);
        mergeDeps(nodesByUuid, downstream);
      }
      if (direction === 'upstream' || direction === 'both') {
        const upstream = await this.queryPath(session, startUuid, 'upstream', depth);
        mergeDeps(nodesByUuid, upstream);
      }
      return Array.from(nodesByUuid.values()).sort((a, b) => a.distance - b.distance);
    } finally {
      await session.close();
    }
  }

  private async queryPath(
    session: Session,
    startUuid: string,
    direction: 'upstream' | 'downstream',
    depth: number
  ): Promise<DepsResult['nodes']> {
    const pattern =
      direction === 'downstream'
        ? `(start:Entity {state_uuid: $uuid})-[r:RELATED*1..${depth}]->(n:Entity)`
        : `(start:Entity {state_uuid: $uuid})<-[r:RELATED*1..${depth}]-(n:Entity)`;
    const result = await session.run(
      `
      MATCH p = ${pattern}
      WITH n, min(length(p)) AS distance, collect(p)[0] AS samplePath
      WITH n, distance, relationships(samplePath)[0] AS firstRel
      RETURN n.entity_uuid AS uuid,
             n.id AS id,
             n.root_id AS root_id,
             n.type AS type,
             distance AS distance,
             coalesce(firstRel.rel_type, 'RELATED') AS relation_type
    `,
      { uuid: startUuid }
    );

    return result.records.map((record) => ({
      uuid: record.get('uuid') as string,
      id: record.get('id') as string,
      root_id: (record.get('root_id') as string) ?? '',
      type: record.get('type') as EntityType,
      distance: toNumber(record.get('distance')),
      relation_type: (record.get('relation_type') as string) ?? 'RELATED',
    }));
  }

  private async resolveStartStateUuid(params: {
    uuid?: string;
    id?: string;
    root_id?: string | null;
  }): Promise<string | null> {
    if (params.uuid) {
      return this.resolveStateUuidByEntityUuid(params.uuid);
    }

    const rootId = params.root_id ?? '';
    if (!params.id) {
      return null;
    }

    if (!this.driver) {
      const candidates = Array.from(this.nodes.values()).filter(
        (node) => node.id === params.id && node.root_id === rootId
      );
      return this.pickStateUuid(candidates);
    }

    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (n:Entity {id: $id, root_id: $root_id})
        RETURN n.entity_uuid AS entity_uuid, n.version AS version, n.state_uuid AS state_uuid
      `,
        { id: params.id, root_id: rootId }
      );
      const nodes = result.records.map((record) => ({
        state_uuid: record.get('state_uuid') as string,
        version: record.get('version') as string,
      }));
      if (nodes.length === 0) return null;
      const targetVersion = pickLatestVersion(nodes.map((node) => node.version));
      return nodes.find((node) => node.version === targetVersion)?.state_uuid ?? nodes[0].state_uuid;
    } finally {
      await session.close();
    }
  }

  private async queryDepsInMemory(params: DepsParams): Promise<DepsResult> {
    const start = this.resolveStartNode(params);
    if (!start) {
      return { nodes: [], degraded: false };
    }

    const depth = normalizeDepth(params.depth);
    const direction = params.direction ?? 'both';
    const visited = new Set<string>([start.state_uuid]);
    const queue: Array<{ uuid: string; distance: number }> = [{ uuid: start.state_uuid, distance: 0 }];
    const results: DepsResult['nodes'] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      if (current.distance >= depth) continue;

      const neighbors = this.collectNeighbors(current.uuid, direction);
      for (const neighbor of neighbors) {
        if (visited.has(neighbor.uuid)) continue;
        visited.add(neighbor.uuid);
        const node = this.nodes.get(neighbor.uuid);
        if (!node) continue;
        const distance = current.distance + 1;
        results.push({
          uuid: node.entity_uuid,
          id: node.id,
          root_id: node.root_id,
          type: node.type,
          distance,
          relation_type: neighbor.rel_type,
        });
        queue.push({ uuid: neighbor.uuid, distance });
      }
    }

    return { nodes: results, degraded: false };
  }

  private resolveStartNode(params: {
    uuid?: string;
    id?: string;
    root_id?: string | null;
  }): GraphNode | null {
    if (params.uuid) {
      const candidates = Array.from(this.nodes.values()).filter(
        (node) => node.entity_uuid === params.uuid
      );
      return this.pickStateNode(candidates);
    }
    const rootId = params.root_id ?? '';
    if (!params.id) return null;
    const candidates = Array.from(this.nodes.values()).filter(
      (node) => node.id === params.id && node.root_id === rootId
    );
    return this.pickStateNode(candidates);
  }

  private collectNeighbors(
    uuid: string,
    direction: 'upstream' | 'downstream' | 'both'
  ): Array<{ uuid: string; rel_type: string }> {
    const found: Array<{ uuid: string; rel_type: string }> = [];
    const current = this.nodes.get(uuid);
    if (!current) return found;

    if (direction === 'downstream' || direction === 'both') {
      for (const edge of current.out) {
        found.push({ uuid: edge.to_state_uuid, rel_type: edge.rel_type });
      }
    }
    if (direction === 'upstream' || direction === 'both') {
      for (const node of this.nodes.values()) {
        for (const edge of node.out) {
          if (edge.to_state_uuid === uuid) {
            found.push({ uuid: node.state_uuid, rel_type: edge.rel_type });
          }
        }
      }
    }

    return found;
  }

  private async resolveStateUuidByEntityUuid(entityUuid: string): Promise<string | null> {
    if (!this.driver) {
      const candidates = Array.from(this.nodes.values()).filter(
        (node) => node.entity_uuid === entityUuid
      );
      return this.pickStateUuid(candidates);
    }
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (n:Entity {entity_uuid: $entity_uuid})
        RETURN n.state_uuid AS state_uuid, n.version AS version
      `,
        { entity_uuid: entityUuid }
      );
      const nodes = result.records.map((record) => ({
        state_uuid: record.get('state_uuid') as string,
        version: record.get('version') as string,
      }));
      if (nodes.length === 0) return null;
      const targetVersion = pickLatestVersion(nodes.map((node) => node.version));
      return nodes.find((node) => node.version === targetVersion)?.state_uuid ?? nodes[0].state_uuid;
    } finally {
      await session.close();
    }
  }

  private pickStateUuid(nodes: GraphNode[]): string | null {
    if (nodes.length === 0) return null;
    const targetVersion = pickLatestVersion(nodes.map((node) => node.version));
    return nodes.find((node) => node.version === targetVersion)?.state_uuid ?? nodes[0].state_uuid;
  }

  private pickStateNode(nodes: GraphNode[]): GraphNode | null {
    if (nodes.length === 0) return null;
    const targetVersion = pickLatestVersion(nodes.map((node) => node.version));
    return nodes.find((node) => node.version === targetVersion) ?? nodes[0];
  }

  private async ensureEvolvesChain(
    session: Session,
    entityUuid: string,
    versions: string[]
  ): Promise<void> {
    const chainVersions = versions.filter((version) => version !== '0.0.0').sort(compareVersions);
    for (let i = 0; i < chainVersions.length - 1; i += 1) {
      const fromVersion = chainVersions[i];
      const toVersion = chainVersions[i + 1];
      await session.run(
        `
        MATCH (old:Entity {state_uuid: $from_state_uuid})
        MATCH (new:Entity {state_uuid: $to_state_uuid})
        MERGE (old)-[:EVOLVES_TO]->(new)
      `,
        {
          from_state_uuid: buildStateUuid(entityUuid, fromVersion),
          to_state_uuid: buildStateUuid(entityUuid, toVersion),
        }
      );
    }
  }

  private ensureEvolvesChainInMemory(_entityUuid: string, _versions: string[]): void {
    // In-memory graph不暴露EVOLVES_TO查询，保留空实现即可
  }
}

function normalizeDepth(depth: number | undefined): number {
  if (!depth || depth < 1) return 3;
  return Math.min(depth, 8);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object' && value && 'toNumber' in (value as Record<string, unknown>)) {
    return ((value as { toNumber: () => number }).toNumber());
  }
  return Number(value ?? 0);
}

function mergeDeps(
  target: Map<string, DepsResult['nodes'][number]>,
  items: DepsResult['nodes']
): void {
  for (const item of items) {
    const existing = target.get(item.uuid);
    if (!existing || item.distance < existing.distance) {
      target.set(item.uuid, item);
    }
  }
}

function extractRelations(data: Record<string, unknown> | undefined): Array<{
  to_uuid: string;
  rel_type: string;
  to_id: string;
  to_root_id: string;
  to_type: EntityType;
}> {
  if (!data || !Array.isArray(data.relationships)) {
    return [];
  }

  const edges: Array<{
    to_uuid: string;
    rel_type: string;
    to_id: string;
    to_root_id: string;
    to_type: EntityType;
  }> = [];

  for (const relation of data.relationships) {
    if (!relation || typeof relation !== 'object') continue;
    const typed = relation as Record<string, unknown>;
    const toUuid = typeof typed.to_uuid === 'string' ? typed.to_uuid : null;
    if (!toUuid) continue;
    const relType =
      (typeof typed.rel_type === 'string' && typed.rel_type) ||
      (typeof typed.type === 'string' && typed.type) ||
      'DEPENDS_ON';
    const toId = (typeof typed.to_id === 'string' && typed.to_id) || toUuid;
    const toRootId = (typeof typed.to_root_id === 'string' && typed.to_root_id) || '';
    const toType = (typed.to_type as EntityType | undefined) ?? 'component';

    edges.push({
      to_uuid: toUuid,
      rel_type: relType,
      to_id: toId,
      to_root_id: toRootId,
      to_type: toType,
    });
  }

  return edges;
}

function buildStateUuid(entityUuid: string, version: string): string {
  return `${entityUuid}:${version}`;
}

function normalizeVersions(versions: string[] | undefined): string[] {
  if (!versions || versions.length === 0) return ['0.0.0'];
  return Array.from(new Set(versions));
}

function compareVersions(a: string, b: string): number {
  if (a === b) return 0;
  const parse = (v: string) => v.split('-');
  const [mainA, preA] = parse(a);
  const [mainB, preB] = parse(b);
  const partsA = mainA.split('.').map((n) => Number(n));
  const partsB = mainB.split('.').map((n) => Number(n));
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i += 1) {
    const av = partsA[i] ?? 0;
    const bv = partsB[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  if (preA && !preB) return -1;
  if (!preA && preB) return 1;
  if (preA && preB) return preA.localeCompare(preB);
  return 0;
}

function pickLatestVersion(versions: string[]): string {
  if (versions.length === 0) return '0.0.0';
  const realVersions = versions.filter((v) => v !== '0.0.0');
  const target = realVersions.length > 0 ? realVersions : versions;
  return target.slice().sort(compareVersions).pop() ?? versions[0];
}
