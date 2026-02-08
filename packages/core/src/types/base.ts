/**
 * C4A 基础类型定义
 *
 * 定义所有实体共享的基础类型和枚举
 */

// ============================================================================
// 知识层级 (Scope)
// ============================================================================

/**
 * 三层知识结构
 * - domain: 行业知识，纯业务视角
 * - enterprise: 企业知识，纯业务视角
 * - project: 项目知识，业务视角 + 技术视角（完整双视角）
 */
export type Scope = 'domain' | 'enterprise' | 'project';

// ============================================================================
// 知识生命周期 (Status)
// ============================================================================

/**
 * 知识生命周期状态
 *
 * 状态流转：draft → approved → published → deprecated → archived
 * 强制规则：
 * - 状态流转必须按顺序进行，不可跳过
 * - draft → published 是非法操作，必须先经过 approved
 * - published 状态的实体不可直接修改，需创建新版本（新 draft）
 */
export type LifecycleStatus = 'draft' | 'approved' | 'published' | 'deprecated' | 'archived';

/**
 * 状态流转有效性映射
 */
export const VALID_STATUS_TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  draft: ['approved', 'archived'], // archived 用于拒绝场景
  approved: ['published'], // 只有 approved 才能发布
  published: ['deprecated'], // 普通实体不支持 published -> archived 快速归档
  deprecated: ['archived'],
  archived: [], // 终态，不可流转
};

/**
 * 检查状态流转是否有效
 */
export function isValidStatusTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  return VALID_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================================================
// 知识点类型 (Kind)
// ============================================================================

/**
 * 知识点类型
 * - implementation: 实现层面的知识（代码、配置等）
 * - external: 外部系统/服务
 * - concept: 概念层面的知识（设计、规范等）
 */
export type EntityKind = 'implementation' | 'external' | 'concept';

// ============================================================================
// 双视角 (Perspective)
// ============================================================================

/**
 * 双视角
 * - business: 业务视角，关注业务价值、用户需求
 * - technical: 技术视角，关注技术实现、系统架构
 */
export type Perspective = 'business' | 'technical';

// ============================================================================
// 实体类型 (EntityType)
// ============================================================================

/**
 * 实体类型定义（单一来源）
 */
export const ENTITY_TYPE_DEFS = {
  product: { dir: 'products', perspective: 'business' as const },
  system: { dir: 'systems', perspective: 'technical' as const },
  container: { dir: 'containers', perspective: 'technical' as const },
  component: { dir: 'components', perspective: 'technical' as const },
  process: { dir: 'processes', perspective: null },
  sor: { dir: 'sors', perspective: null },
  adr: { dir: 'adrs', perspective: 'technical' as const },
  contract: { dir: 'contracts', perspective: 'technical' as const },
  feat: { dir: 'feat', perspective: null },
  checklist: { dir: 'checklists', perspective: null },
  spec: { dir: 'specs', perspective: null },
} as const;

/**
 * 所有实体类型
 */
export type EntityType = keyof typeof ENTITY_TYPE_DEFS;

/**
 * 实体类型到目录映射
 */
export const ENTITY_TYPE_TO_DIR = Object.fromEntries(
  Object.entries(ENTITY_TYPE_DEFS).map(([type, def]) => [type, def.dir]),
) as Record<EntityType, string>;

/**
 * 目录到实体类型映射
 */
export const DIR_TO_ENTITY_TYPE = Object.fromEntries(
  Object.entries(ENTITY_TYPE_DEFS).map(([type, def]) => [def.dir, type]),
) as Record<string, EntityType>;

/**
 * Schema 验证类型
 *
 * 用于 JSON Schema 验证器，包含所有可验证的 DSL 类型。
 * 注意：这与 DSL 文件中的 type 字段值不同
 * - DSL 文件使用 "software-system"（符合 C4 模型命名）
 * - Schema 验证使用 "system"（简化内部使用）
 */
export const SCHEMA_TYPES = [
  'product',
  'system',
  'container',
  'component',
  'process',
  'sor',
  'adr',
  'contract',
  'spec',
] as const;

export type SchemaType = (typeof SCHEMA_TYPES)[number];

/**
 * 核心实体类型（三构件）
 */
export const CORE_ENTITY_TYPES = [
  'product',
  'system',
  'container',
  'component',
  'process',
  'sor',
] as const;

export type CoreEntityType = (typeof CORE_ENTITY_TYPES)[number];

/**
 * 技术视角实体类型
 */
export const TECHNICAL_ENTITY_TYPES = ['system', 'container', 'component'] as const;

export type TechnicalEntityType = (typeof TECHNICAL_ENTITY_TYPES)[number];

export const BUSINESS_ENTITY_TYPES = ['product', 'process', 'sor'] as const;

export type BusinessEntityType = (typeof BUSINESS_ENTITY_TYPES)[number];

export const TECHNICAL_PERSPECTIVE_TYPES = [
  'system',
  'container',
  'component',
  'adr',
  'contract',
  'process',
  'sor',
] as const;

export type TechnicalPerspectiveType = (typeof TECHNICAL_PERSPECTIVE_TYPES)[number];

export const SOR_ENTITY_TYPES = ['product', 'system', 'container', 'component'] as const;

export type SoREntityType = (typeof SOR_ENTITY_TYPES)[number];

/**
 * 附属实体类型
 */
export type AttachedEntityType = 'adr' | 'contract';

// ============================================================================
// 基础元数据接口
// ============================================================================

/**
 * Owner 信息
 */
export interface Owner {
  team?: string;
  tech_lead?: string;
  product_owner?: string;
  contact?: string;
}

/**
 * 外部系统信息
 */
export interface ExternalInfo {
  name: string;
  description?: string;
  url?: string;
  owner?: string;
  contact?: string;
}

/**
 * 链接
 */
export interface Link {
  type?: 'repository' | 'documentation' | 'dashboard' | 'wiki' | 'other';
  url: string;
  description?: string;
}

/**
 * 基础实体元数据
 * 所有实体都必须包含这些字段
 */
export interface BaseEntityMetadata {
  /** 物理主键（UUID），由系统生成 */
  uuid?: string;

  /** 实体唯一标识 */
  id: string;

  /** 包边界标识（Feat/Checklist 为空字符串） */
  root_id?: string;

  /** 版本集合（受控字段） */
  versions?: string[];

  /** 关联的 Feat UUID（可选，用于追溯来源） */
  requirement_id?: string;

  /** 归属的父 Component（用户可见） */
  component_id?: string;

  /** 实体类型 */
  type: EntityType;

  /** 知识层级 */
  scope: Scope;

  /** 知识点类型 */
  kind?: EntityKind;

  /** 视角（业务/技术） */
  perspective?: Perspective;

  /** 显示名称 */
  name: string;

  /** 描述 */
  description?: string;

  /** 标签 */
  tags?: string[];

  /** 所属者信息 */
  owner?: Owner;

  /** 相关链接 */
  links?: Link[];

  /** 生命周期状态 */
  status: LifecycleStatus;

  /** 创建时间 */
  created_at?: string;

  /** 更新时间 */
  updated_at?: string;

  /** 创建者 */
  created_by?: string;

  /** 更新者 */
  updated_by?: string;
}

/**
 * 数据库存储的实体元数据
 * 包含额外的存储层字段
 */
export interface StoredEntityMetadata extends BaseEntityMetadata {
  /** 物理主键（UUID），必填 */
  uuid: string;

  /** 包边界标识（Feat/Checklist 为空字符串），必填 */
  root_id: string;

  /** 版本集合（受控字段），必填 */
  versions: string[];

  /** 外部系统/组件 URL */
  external_url?: string | null;

  /** 内容哈希，用于变更检测 */
  content_hash?: string;
}

// ============================================================================
// 批量性级别 (Criticality)
// ============================================================================

/**
 * 重要性级别
 */
export type Criticality = 'critical' | 'high' | 'medium' | 'low';
