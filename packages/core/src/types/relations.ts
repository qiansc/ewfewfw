/**
 * C4A 关系类型定义
 *
 * 定义 6 种核心关系类型及其存储方向
 */

// ============================================================================
// 关系类型
// ============================================================================

/**
 * 6 种核心关系类型
 */
export type RelationType =
  | 'CONTAINS' // 层级包含：父→子
  | 'DEPENDS_ON' // 依赖关系：依赖方→被依赖方
  | 'REFERENCES' // 引用关系：引用方→被引用方
  | 'IMPLEMENTS' // 实现关系：实现方→被实现方
  | 'CORRESPONDS' // 对应关系：Technical→Business（双视角映射）
  | 'DERIVES'; // 派生/产出：Entity×Process→SoR

/**
 * 关系存储方向说明
 */
export const RELATION_DIRECTION_DOC: Record<RelationType, string> = {
  CONTAINS: '父→子：System→Container→Component',
  DEPENDS_ON: '依赖方→被依赖方：Container A→Container B',
  REFERENCES: '引用方→被引用方：Project Product→Enterprise Product',
  IMPLEMENTS: '实现方→被实现方：Component→Contract, Contract→SoR',
  CORRESPONDS: '技术→业务：System→Product, Technical SoR→Business SoR',
  DERIVES: '产出方→被产出方：Entity×Process→SoR',
};

// ============================================================================
// 关系数据结构
// ============================================================================

/**
 * 关系元数据
 */
export interface RelationMetadata {
  /** 描述 */
  description?: string;

  /** 技术/协议 */
  technology?: string;

  /** 是否异步 */
  async?: boolean;

  /** 重要性级别 */
  criticality?: 'critical' | 'high' | 'medium' | 'low';

  /** 创建时间 */
  created_at?: string;

  /** 创建者 */
  created_by?: string;
}

/**
 * 关系定义
 */
export interface Relation {
  /** 源实体 ID */
  from: string;

  /** 目标实体 ID */
  to: string;

  /** 关系类型 */
  rel_type: RelationType;

  /** 关系元数据 */
  metadata?: RelationMetadata;
}

/**
 * 存储在数据库中的关系记录
 */
export interface StoredRelation extends Relation {
  /** 关系唯一 ID（可选，用于数据库） */
  id?: string;

  /** 源实体类型 */
  from_type?: string;

  /** 目标实体类型 */
  to_type?: string;
}

// ============================================================================
// 引用格式
// ============================================================================

/**
 * 引用类型
 */
export type ReferenceType =
  | 'simple' // 简单 ID：entity-id
  | 'repo' // 跨仓库：repo:org/repo/entity-id
  | 'scope'; // 指定层级：scope:enterprise/entity-id

/**
 * 引用解析结果
 */
export interface ResolvedReference {
  /** 原始引用字符串 */
  raw: string;

  /** 引用类型 */
  type: ReferenceType;

  /** 实体 ID */
  entity_id: string;

  /** 仓库 ID（如果指定） */
  repo_id?: string;

  /** 层级（如果指定） */
  scope?: 'domain' | 'enterprise' | 'project';
}

/**
 * 引用解析优先级
 *
 * 1. 当前包（同 root_id）
 * 2. 同仓库基建实体（root_id = ''）
 * 3. 其他包（按 root_id 查找）
 * 4. Enterprise 层实体
 * 5. Domain 层实体
 */
export const REFERENCE_RESOLUTION_PRIORITY = [
  'current_project',
  'same_repo_infra',
  'other_projects',
  'enterprise',
  'domain',
] as const;

// ============================================================================
// 关系查询
// ============================================================================

/**
 * 关系查询方向
 */
export type RelationDirection = 'outgoing' | 'incoming' | 'both';

/**
 * 关系查询参数
 */
export interface RelationQueryParams {
  /** 实体 ID */
  entity_id: string;

  /** 关系类型过滤 */
  rel_types?: RelationType[];

  /** 查询方向 */
  direction?: RelationDirection;

  /** 递归深度（默认 1） */
  depth?: number;

  /** 是否包含 feat 中的关系 */
  include_feat?: boolean;
}

/**
 * 关系查询结果
 */
export interface RelationQueryResult {
  /** 直接关系 */
  relations: StoredRelation[];

  /** 关联的实体 ID */
  related_entity_ids: string[];

  /** 如果是多层查询，返回层级信息 */
  layers?: Array<{
    depth: number;
    entity_ids: string[];
    relations: StoredRelation[];
  }>;
}

// ============================================================================
// 追溯链
// ============================================================================

/**
 * 知识追溯链节点
 */
export interface TraceNode {
  entity_id: string;
  entity_type: string;
  entity_name?: string;
  relation_type?: RelationType;
}

/**
 * 知识追溯链
 * Code → Component → Contract → Technical SoR → Business SoR → Product × Process
 */
export interface TraceChain {
  /** 链路节点 */
  nodes: TraceNode[];

  /** 是否完整（到达 Product） */
  complete: boolean;

  /** 缺失的环节 */
  missing?: string[];
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 检查关系类型是否有效
 */
export function isValidRelationType(type: string): type is RelationType {
  return ['CONTAINS', 'DEPENDS_ON', 'REFERENCES', 'IMPLEMENTS', 'CORRESPONDS', 'DERIVES'].includes(
    type,
  );
}

/**
 * 获取关系的反向语义
 */
export function getReverseRelationSemantic(type: RelationType): string {
  const reverseMap: Record<RelationType, string> = {
    CONTAINS: 'CONTAINED_BY',
    DEPENDS_ON: 'DEPENDED_BY',
    REFERENCES: 'REFERENCED_BY',
    IMPLEMENTS: 'IMPLEMENTED_BY',
    CORRESPONDS: 'CORRESPONDS', // 双向语义
    DERIVES: 'DERIVED_FROM',
  };
  return reverseMap[type];
}

/**
 * 解析引用字符串
 */
export function parseReference(ref: string): ResolvedReference {
  // repo:org/repo/entity-id
  if (ref.startsWith('repo:')) {
    const rest = ref.slice('repo:'.length);
    const parts = rest.split('/');
    if (parts.length >= 3) {
      const repoId = `${parts[0]}/${parts[1]}`;
      const remainder = parts.slice(2).join('/');
      return {
        raw: ref,
        type: 'repo',
        repo_id: repoId,
        entity_id: remainder,
      };
    }
  }

  // scope:enterprise/entity-id
  if (ref.startsWith('scope:')) {
    const rest = ref.slice('scope:'.length);
    const slashIndex = rest.indexOf('/');
    if (slashIndex > 0) {
      const scope = rest.slice(0, slashIndex) as 'domain' | 'enterprise' | 'project';
      return {
        raw: ref,
        type: 'scope',
        scope,
        entity_id: rest.slice(slashIndex + 1),
      };
    }
  }

  // 简单 ID
  return {
    raw: ref,
    type: 'simple',
    entity_id: ref,
  };
}

/**
 * 构建引用字符串
 */
export function buildReference(resolved: ResolvedReference): string {
  switch (resolved.type) {
    case 'repo':
      return `repo:${resolved.repo_id}/${resolved.entity_id}`;
    case 'scope':
      return `scope:${resolved.scope}/${resolved.entity_id}`;
    default:
      return resolved.entity_id;
  }
}
