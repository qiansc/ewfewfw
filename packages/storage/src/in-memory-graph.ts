/**
 * In-Memory Graph Module for Local Mode
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/graph-query.md §4.1
 *
 * 核心特性:
 * - 邻接表存储关系
 * - 支持 Feat 版本隔离
 * - 增量更新（无需重启）
 * - 缓存失效机制
 */

import type { Database } from 'bun:sqlite';

// 节点唯一键：project + id
type NodeKey = string; // 格式: `${project}:${id}` 或 `null:${id}`（无项目归属）

/**
 * 生成节点键
 */
function makeNodeKey(project: string | null, id: string): NodeKey {
  const normalizedProject = project === '' || project === null ? 'null' : project;
  return `${normalizedProject}:${id}`;
}

function normalizeProject(project: string | null): string | null {
  if (project === '') return null;
  return project;
}

/**
 * 图节点
 */
interface GraphNode {
  project: string | null;
  id: string;
  type: string | null;
  outgoing: Map<string, Set<NodeKey>>; // rel_type -> target_node_keys
  incoming: Map<string, Set<NodeKey>>; // rel_type -> source_node_keys
}

/**
 * 依赖查询结果
 */
export interface DependencyResult {
  project: string | null;
  id: string;
  distance: number;
  type?: string | null;
  relation_type?: string;
}

/**
 * 内存图
 *
 * 设计文档: graph-query.md L1-189
 *
 * 设计要点:
 * - 启动时从 relations 表加载
 * - 支持 Merge View（Feat 优先 + 主分支兜底）
 * - 增量更新（添加/删除/修改关系）
 * - 缓存失效机制
 */
export class InMemoryGraph {
  private nodes: Map<NodeKey, GraphNode> = new Map();
  private queryCache: Map<string, { result: unknown; expiresAt: number }> =
    new Map();
  private proposalId: string | null = null; // 当前加载的 proposal_id

  /**
   * 从数据库加载关系（支持 Feat 隔离）
   *
   * 设计文档: graph-query.md L26-59
   *
   * @param db - SQLite 数据库连接
   * @param proposalId - Feat ID (null 表示主分支)
   */
  load(db: Database, proposalId: string | null = null): void {
    this.proposalId = proposalId;
    this.nodes.clear();
    this.queryCache.clear();

    // 加载合并视图：主分支 + feat 的关系
    const dbProposalId = proposalId ?? '';
    const query = proposalId
      ? `
        WITH all_relations AS (
          SELECT r.* FROM relations r
          WHERE r.proposal_id = ? OR r.proposal_id IS NULL OR r.proposal_id = ''
        ),
        ranked_relations AS (
          SELECT *,
            ROW_NUMBER() OVER (
              PARTITION BY from_project, from_id, to_project, to_id, rel_type
              ORDER BY CASE
                WHEN proposal_id = ? THEN 0
                WHEN proposal_id IS NULL OR proposal_id = '' THEN 1
                ELSE 2
              END
            ) AS rn
          FROM all_relations
        ),
        valid_relations AS (
          SELECT * FROM ranked_relations
          WHERE rn = 1 AND (status IS NULL OR status != 'deleted')
        )
        SELECT r.* FROM valid_relations r
        WHERE EXISTS (
          SELECT 1 FROM (
            SELECT m.status,
              ROW_NUMBER() OVER (
                PARTITION BY m.source_project, m.entity_id
                ORDER BY CASE
                  WHEN m.proposal_id = ? THEN 0
                  WHEN m.proposal_id IS NULL OR m.proposal_id = '' THEN 1
                  ELSE 2
                END
              ) AS rn
            FROM metadata m
            WHERE m.source_project = r.from_project
              AND m.entity_id = r.from_id
              AND (m.proposal_id = ? OR m.proposal_id IS NULL OR m.proposal_id = '')
          ) src WHERE src.rn = 1 AND src.status NOT IN ('archived', 'deprecated')
        )
        AND EXISTS (
          SELECT 1 FROM (
            SELECT m.status,
              ROW_NUMBER() OVER (
                PARTITION BY m.source_project, m.entity_id
                ORDER BY CASE
                  WHEN m.proposal_id = ? THEN 0
                  WHEN m.proposal_id IS NULL OR m.proposal_id = '' THEN 1
                  ELSE 2
                END
              ) AS rn
            FROM metadata m
            WHERE m.source_project = r.to_project
              AND m.entity_id = r.to_id
              AND (m.proposal_id = ? OR m.proposal_id IS NULL OR m.proposal_id = '')
          ) tgt WHERE tgt.rn = 1 AND tgt.status NOT IN ('archived', 'deprecated')
        )
      `
      : `SELECT from_project, from_id, to_project, to_id, rel_type
         FROM relations r
         WHERE (r.proposal_id IS NULL OR r.proposal_id = '')
           AND (r.status IS NULL OR r.status != 'deleted')
           AND EXISTS (
             SELECT 1 FROM metadata m
             WHERE m.source_project = r.from_project
               AND m.entity_id = r.from_id
               AND (m.proposal_id IS NULL OR m.proposal_id = '')
               AND m.status NOT IN ('archived', 'deprecated')
           )
           AND EXISTS (
             SELECT 1 FROM metadata m
             WHERE m.source_project = r.to_project
               AND m.entity_id = r.to_id
               AND (m.proposal_id IS NULL OR m.proposal_id = '')
               AND m.status NOT IN ('archived', 'deprecated')
           )`;

    const relations = (
      proposalId
        ? db.prepare(query).all(
          dbProposalId,
          dbProposalId,
          dbProposalId,
          dbProposalId,
          dbProposalId,
          dbProposalId
        )
        : db.prepare(query).all()
    ) as Array<{
      from_project: string;
      from_id: string;
      to_project: string;
      to_id: string;
      rel_type: string;
    }>;

    for (const rel of relations) {
      const fromProject = rel.from_project === '' ? null : rel.from_project;
      const toProject = rel.to_project === '' ? null : rel.to_project;
      this.addRelation(
        fromProject,
        rel.from_id,
        toProject,
        rel.to_id,
        rel.rel_type
      );
    }

    this.attachNodeTypes(db, proposalId);
  }

  /**
   * 添加关系
   *
   * 设计文档: graph-query.md L61-90
   */
  addRelation(
    fromProject: string | null,
    fromId: string,
    toProject: string | null,
    toId: string,
    relType: string,
    fromType?: string | null,
    toType?: string | null
  ): void {
    const normalizedFrom = normalizeProject(fromProject);
    const normalizedTo = normalizeProject(toProject);
    const fromKey = makeNodeKey(normalizedFrom, fromId);
    const toKey = makeNodeKey(normalizedTo, toId);

    // 确保节点存在
    if (!this.nodes.has(fromKey)) {
      this.nodes.set(fromKey, {
        project: normalizedFrom,
        id: fromId,
        type: fromType ?? null,
        outgoing: new Map(),
        incoming: new Map(),
      });
    }
    if (!this.nodes.has(toKey)) {
      this.nodes.set(toKey, {
        project: normalizedTo,
        id: toId,
        type: toType ?? null,
        outgoing: new Map(),
        incoming: new Map(),
      });
    }

    const fromNodeType = this.nodes.get(fromKey);
    if (fromType && fromNodeType && !fromNodeType.type) {
      fromNodeType.type = fromType;
    }
    const toNodeType = this.nodes.get(toKey);
    if (toType && toNodeType && !toNodeType.type) {
      toNodeType.type = toType;
    }

    // 添加出边
    const fromNode = this.nodes.get(fromKey)!;
    if (!fromNode.outgoing.has(relType)) {
      fromNode.outgoing.set(relType, new Set());
    }
    fromNode.outgoing.get(relType)!.add(toKey);

    // 添加入边
    const toNode = this.nodes.get(toKey)!;
    if (!toNode.incoming.has(relType)) {
      toNode.incoming.set(relType, new Set());
    }
    toNode.incoming.get(relType)!.add(fromKey);

    // 失效相关缓存
    this.invalidateCache(fromKey, toKey);
  }

  /**
   * 删除关系（增量更新）
   *
   * 设计文档: graph-query.md L92-108
   */
  removeRelation(
    fromProject: string | null,
    fromId: string,
    toProject: string | null,
    toId: string,
    relType: string
  ): void {
    const normalizedFrom = normalizeProject(fromProject);
    const normalizedTo = normalizeProject(toProject);
    const fromKey = makeNodeKey(normalizedFrom, fromId);
    const toKey = makeNodeKey(normalizedTo, toId);
    const fromNode = this.nodes.get(fromKey);
    const toNode = this.nodes.get(toKey);

    if (fromNode?.outgoing.has(relType)) {
      fromNode.outgoing.get(relType)!.delete(toKey);
    }
    if (toNode?.incoming.has(relType)) {
      toNode.incoming.get(relType)!.delete(fromKey);
    }

    // 失效相关缓存
    this.invalidateCache(fromKey, toKey);
  }

  /**
   * 更新关系（增量更新，无需重启）
   *
   * 设计文档: graph-query.md L110-120
   */
  updateRelation(
    fromProject: string | null,
    fromId: string,
    toProject: string | null,
    toId: string,
    relType: string,
    newRelType?: string
  ): void {
    if (newRelType && newRelType !== relType) {
      this.removeRelation(fromProject, fromId, toProject, toId, relType);
      this.addRelation(fromProject, fromId, toProject, toId, newRelType);
    }
  }

  /**
   * 失效缓存
   *
   * 设计文档: graph-query.md L122-130
   */
  private invalidateCache(fromKey: NodeKey, toKey: NodeKey): void {
    // 删除涉及这两个节点的所有缓存
    for (const key of Array.from(this.queryCache.keys())) {
      if (key.includes(fromKey) || key.includes(toKey)) {
        this.queryCache.delete(key);
      }
    }
  }

  /**
   * 查询依赖（上游/下游）
   *
   * 设计文档: graph-query.md L132-188
   *
   * @param project - 项目 ID
   * @param entityId - 实体 ID
   * @param direction - 方向 (upstream=上游依赖, downstream=下游被依赖, both=双向)
   * @param depth - 遍历深度 (默认 1)
   * @param relTypes - 可选：按关系类型过滤
   */
  queryDeps(
    project: string | null,
    entityId: string,
    direction: 'upstream' | 'downstream' | 'both',
    depth: number = 1,
    relTypes?: string[]
  ): DependencyResult[] {
    const startKey = makeNodeKey(project, entityId);
    const visited = new Set<NodeKey>();
    const result: DependencyResult[] = [];

    const traverse = (nodeKey: NodeKey, currentDepth: number, relType?: string) => {
      if (currentDepth > depth || visited.has(nodeKey)) return;

      visited.add(nodeKey);
      if (nodeKey !== startKey) {
        const node = this.nodes.get(nodeKey);
        if (node) {
          result.push({
            project: node.project,
            id: node.id,
            distance: currentDepth,
            type: node.type,
            relation_type: relType,
          });
        }
      }

      const node = this.nodes.get(nodeKey);
      if (!node) return;

      // 遍历出边（下游）
      if (direction === 'downstream' || direction === 'both') {
        for (const [relType, targets] of Array.from(node.outgoing.entries())) {
          // 如果指定了 relTypes，则只遍历匹配的关系类型
          if (relTypes && relTypes.length > 0 && !relTypes.includes(relType)) {
            continue;
          }
          for (const targetKey of Array.from(targets)) {
            traverse(targetKey, currentDepth + 1, relType);
          }
        }
      }

      // 遍历入边（上游）
      if (direction === 'upstream' || direction === 'both') {
        for (const [relType, sources] of Array.from(node.incoming.entries())) {
          // 如果指定了 relTypes，则只遍历匹配的关系类型
          if (relTypes && relTypes.length > 0 && !relTypes.includes(relType)) {
            continue;
          }
          for (const sourceKey of Array.from(sources)) {
            traverse(sourceKey, currentDepth + 1, relType);
          }
        }
      }
    };

    traverse(startKey, 0);
    return result;
  }

  /**
   * 获取当前加载的 proposal_id
   */
  getProposalId(): string | null {
    return this.proposalId;
  }

  /**
   * 更新节点类型
   */
  setNodeType(project: string | null, id: string, type: string | null): void {
    const key = makeNodeKey(project, id);
    const node = this.nodes.get(key);
    if (node) {
      node.type = type;
    }
  }

  /**
   * 获取节点数量（用于监控）
   */
  getNodeCount(): number {
    return this.nodes.size;
  }

  private attachNodeTypes(db: Database, proposalId: string | null): void {
    if (this.nodes.size === 0) return;

    const dbProposalId = proposalId ?? '';
    const rows = proposalId
      ? db
          .prepare(
            `
          SELECT source_project, id, proposal_id, type
          FROM entities
          WHERE proposal_id = ? OR proposal_id IS NULL OR proposal_id = ''
        `
          )
          .all(dbProposalId)
      : db
          .prepare(
            `
          SELECT source_project, id, proposal_id, type
          FROM entities
          WHERE proposal_id IS NULL OR proposal_id = ''
        `
          )
          .all();

    const preferred = new Set<NodeKey>();

    for (const row of rows as Array<{
      source_project: string | null;
      id: string;
      proposal_id: string | null;
      type: string | null;
    }>) {
      const normalizedProject = normalizeProject(row.source_project ?? null);
      const key = makeNodeKey(normalizedProject, row.id);
      if (!this.nodes.has(key)) continue;

      const isProposal = proposalId && row.proposal_id === dbProposalId;
      if (isProposal) {
        preferred.add(key);
      }

      const node = this.nodes.get(key);
      if (!node) continue;

      if (isProposal || !node.type) {
        node.type = row.type ?? null;
      } else if (!preferred.has(key) && node.type === null) {
        node.type = row.type ?? null;
      }
    }
  }

  /**
   * 获取关系数量（用于监控）
   */
  getRelationCount(): number {
    let count = 0;
    for (const node of Array.from(this.nodes.values())) {
      for (const targets of Array.from(node.outgoing.values())) {
        count += targets.size;
      }
    }
    return count;
  }
}
