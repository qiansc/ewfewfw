/**
 * C4A DSL 文件类型定义（与 JSON Schema 完全一致）
 *
 * 这些类型用于 DSL 文件解析和验证，与 Schema 结构保持一致。
 * 基于 v0.3.0/concepts.md 的双视角三构件模型。
 */

import type { SoREntityType } from './base.js';

// ============================================================================
// 基础类型
// ============================================================================

export interface Owner {
  team?: string;
  tech_lead?: string;
  product_owner?: string;
  contact?: string;
}

export type Criticality = 'critical' | 'high' | 'medium' | 'low';

export type LifecycleStatus =
  | 'draft'
  | 'approved'
  | 'published'
  | 'deprecated'
  | 'archived';

export type Scope = 'domain' | 'enterprise' | 'project';

export type ContractType = 'openapi' | 'asyncapi' | 'proto' | 'graphql';

/**
 * ADR 状态（与 attached.ts 中的 ADRStatus 保持一致）
 * 使用通用生命周期状态 + superseded（被替代）
 */
export type ADRStatus =
  | 'draft'
  | 'approved'
  | 'published'
  | 'deprecated'
  | 'archived'
  | 'superseded';

/**
 * Contract 状态（与 Schema 一致）
 * Contract 有独立的生命周期，包含 implemented 状态表示已被 Component 实现
 */
export type ContractStatus =
  | 'draft'
  | 'approved'
  | 'implemented'
  | 'published'
  | 'deprecated';

export interface ExternalInfo {
  name: string;
  description?: string;
  url?: string;
  owner?: string;
  contact?: string;
}

export interface Link {
  type?: 'repository' | 'documentation' | 'dashboard' | 'wiki' | 'other';
  url: string;
  description?: string;
}

// ============================================================================
// Product DSL（业务视角实体）
// ============================================================================

/**
 * Product DSL - 业务产品定义
 *
 * 在 Domain/Enterprise 层定义，Project 层通过 REFERENCES 关系引用
 */
export interface ProductDSL {
  schema: 'c4a/v1';
  type: 'product';
  product: {
    id: string;
    name: string;
    description: string;
    scope: Scope;
    owner?: Owner;
    tags?: string[];
    /** 引用其他实体（跨层级/跨项目） */
    references?: string[];
    /** 基于哪个上层 Product（Domain → Enterprise → Project 继承链） */
    based_on?: string;
    /** 引用来源（project 层引用 enterprise 时使用） */
    reference_from?: 'domain' | 'enterprise';
    /** 产品文档 URI */
    doc_uri?: string;
  };
  links?: Link[];
}

// ============================================================================
// System DSL（技术视角顶层实体）
// ============================================================================

/**
 * System DSL - 软件系统定义
 *
 * 与 Product 1:1 对应，只在 Project 层存在
 */
export interface SystemDSL {
  schema: 'c4a/v1';
  type: 'software-system';
  system: {
    id: string;
    name: string;
    description: string;
    /** System 只在 Project 层存在 */
    scope: 'project';
    owner?: Owner;
    tags?: string[];
    /** 引用其他实体（跨层级/跨项目） */
    references?: string[];
    /** 对应的 Product ID（1:1 对应） */
    corresponds_to?: string;
    /** 是否外部系统 */
    external?: boolean;
    /** 外部系统信息 */
    external_info?: ExternalInfo;
  };
  relationships?: {
    consumers?: Array<{
      id: string;
      type: 'person' | 'software-system';
      description?: string;
    }>;
    dependencies?: Array<{
      id: string;
      description?: string;
      technology?: string;
      criticality?: Criticality;
      external?: boolean;
      external_info?: ExternalInfo;
    }>;
  };
  containers?: {
    $ref?: string;
  };
  deployment?: {
    regions?: string[];
    environments?: string[];
    [key: string]: unknown;
  };
}

// ============================================================================
// Container DSL
// ============================================================================

export interface ContainerDSL {
  schema: 'c4a/v1';
  type: 'container';
  container: {
    id: string;
    name: string;
    description: string;
    /** Container 只在 Project 层存在 */
    scope: 'project';
    /** 所属 System ID */
    system_id: string;
    technology?: Array<{
      language: string;
      framework?: string;
      runtime?: string;
      protocol?: string;
    }>;
    ports?: Array<{
      port: number;
      protocol: 'HTTP' | 'gRPC' | 'TCP' | 'WebSocket';
      description?: string;
    }>;
    repository?: {
      url?: string;
      path?: string;
    };
    /** 代码路径（关联代码目录） */
    code_path?: string;
    /** 是否外部容器 */
    external?: boolean;
    /** 外部容器信息 */
    external_info?: ExternalInfo;
    /** API 契约引用 */
    apis?: Array<{
      type: ContractType;
      ref: string;
      version?: string;
    }>;
    /** 引用其他实体（跨层级/跨项目） */
    references?: string[];
  };
  relationships?: Array<{
    to: string;
    description?: string;
    technology?: string;
    async?: boolean;
    /** 是否为外部容器（如 Redis、Kafka 等） */
    external?: boolean;
    /** 外部容器信息 */
    external_info?: ExternalInfo;
  }>;
}

// ============================================================================
// Component DSL
// ============================================================================

export interface ComponentDSL {
  schema: 'c4a/v1';
  type: 'component';
  component: {
    id: string;
    name: string;
    description: string;
    /** Component 只在 Project 层存在 */
    scope: 'project';
    /** 所属 Container ID */
    container_id: string;
    technology?: string;
    /** 代码路径（关联代码文件） */
    code_path?: string;
    /** 实现的 Contract ID 列表 */
    implements_contracts?: string[];
    /** 引用其他实体（跨层级/跨项目） */
    references?: string[];
  };
  relationships?: Array<{
    to: string;
    description?: string;
  }>;
}

// ============================================================================
// Process DSL（流程）
// ============================================================================

export type ProcessType = 'business' | 'technical';

export type FlowType = 'sequence_diagram' | 'activity_diagram' | 'state_machine';

export interface FlowInfo {
  type: FlowType;
  diagram_uri?: string;
  diagram_content?: string;
}

/**
 * Process DSL - 业务或技术流程
 *
 * 描述"怎么运作"
 */
export interface ProcessDSL {
  schema: 'c4a/v1';
  type: 'process';
  process: {
    /** ID 格式：prc-b-{id} 或 prc-t-{id} */
    id: string;
    name: string;
    description: string;
    scope: Scope;
    /** 流程类型：业务流程或技术流程 */
    process_type: ProcessType;
    owner?: Owner;
    tags?: string[];
    /** 引用其他实体（跨层级/跨项目） */
    references?: string[];
    /** 基于哪个上层 Process */
    based_on?: string;
    /** 父流程 ID（形成流程树） */
    parent_id?: string;
    /** 流程图信息 */
    flow?: FlowInfo;
  };
  /** 流程步骤 */
  steps?: Array<{
    id: string;
    name: string;
    description?: string;
    actor?: string;
  }>;
}

// ============================================================================
// SoR DSL（需求项）
// ============================================================================

/**
 * SoR 的 9 种类型
 */
export type SoRType =
  | 'business_rule'
  | 'business_data'
  | 'non_functional'
  | 'report'
  | 'communication'
  | 'utility'
  | 'user_interface'
  | 'message'
  | 'kpi';

/**
 * SoR 子类型
 */
export type SoRSubType =
  // Business Rule 子类型
  | 'policy'
  | 'validation'
  | 'business_scenario'
  // Non-functional 子类型
  | 'performance'
  | 'security'
  | 'usability'
  | 'scalability'
  | 'reliability'
  // Communication 子类型
  | 'inbound'
  | 'outbound';

/**
 * SoR 关联的实体类型
 */
export type { SoREntityType };

/**
 * SoR DSL - Statement of Requirements
 *
 * 描述"要满足什么"，由 Entity × Process 交叉产生
 */
export interface SoRDSL {
  schema: 'c4a/v1';
  type: 'sor';
  sor: {
    /** ID 格式：sor-b-{id} 或 sor-t-{id} */
    id: string;
    /** SoR 名称 */
    name: string;
    description: string;
    scope: Scope;
    /** SoR 类型 */
    sor_type: SoRType;
    /** SoR 子类型 */
    sor_subtype?: SoRSubType;
    /** 关联的实体类型 */
    entity_type: SoREntityType;
    /** 关联的实体 ID */
    entity_id: string;
    /** 关联的流程 ID（可选，Entity × Process → SoR） */
    process_id?: string;
    owner?: Owner;
    tags?: string[];
    /** 引用其他实体（跨层级/跨项目） */
    references?: string[];
    /** 基于哪个上层 SoR */
    based_on?: string;
    /** 对应的 SoR ID（Business SoR ↔ Technical SoR 对应） */
    corresponds_to?: string;
    /** 验收标准 */
    acceptance_criteria?: string[];
  };
}

// ============================================================================
// ADR DSL（架构决策记录）
// ============================================================================

export interface ADRDSL {
  schema: 'c4a/v1';
  type: 'adr';
  adr: {
    /** ID 格式：adr-{id}-{slug} */
    id: string;
    title: string;
    /** 所属系统 ID */
    system_id?: string;
    status: ADRStatus;
    date?: string;
    authors?: string[];
    reviewers?: string[];
    approved_by?: string;
    approved_at?: string;
    /** 引用其他实体（跨层级/跨项目） */
    references?: string[];
  };
  context: string;
  decision: string;
  consequences?: {
    positive?: string[];
    negative?: string[];
    neutral?: string[];
  };
  alternatives?: Array<{
    name: string;
    description?: string;
    pros?: string[];
    cons?: string[];
    /** 未选择该方案的原因 */
    reason?: string;
    /** 评分 1-5 */
    evaluation?: number;
  }>;
  /** 影响的实体 ID 列表 */
  related_entities?: string[];
  related?: {
    supersedes?: string;
    superseded_by?: string;
    related_adrs?: string[];
  };
}

// ============================================================================
// Contract DSL（接口规格）
// ============================================================================

/**
 * Contract DSL - SoR 的技术设计表达
 */
export interface ContractDSL {
  schema: 'c4a/v1';
  type: 'contract';
  contract: {
    id: string;
    name: string;
    description?: string;
    contract_type: ContractType;
    /** Contract 状态（含 implemented，与 Schema 一致） */
    status: ContractStatus;
    version?: string;
    /** 此 Contract 实现的 SoR ID 列表 */
    implements_sor?: string[];
    /** 引用其他实体（跨层级/跨项目） */
    references?: string[];
  };
  /** 内联存储规格内容（小型契约） */
  spec?: unknown;
  /** 外部引用（大型契约） */
  spec_uri?: string;
}

// ============================================================================
// 联合类型
// ============================================================================

export type C4ADSL =
  | ProductDSL
  | SystemDSL
  | ContainerDSL
  | ComponentDSL
  | ProcessDSL
  | SoRDSL
  | ADRDSL
  | ContractDSL;

/**
 * DSL 类型字符串
 */
export type DSLType =
  | 'product'
  | 'software-system'
  | 'container'
  | 'component'
  | 'process'
  | 'sor'
  | 'adr'
  | 'contract';
