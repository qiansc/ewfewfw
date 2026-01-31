/**
 * C4A 实体类型定义
 *
 * 定义三个构建块：Entity、Process、SoR
 * 以及它们在双视角（业务/技术）下的表现
 */

import type {
  BaseEntityMetadata,
  Criticality,
  EntityKind,
  ExternalInfo,
  Link,
  Owner,
  Perspective,
  Scope,
  SoREntityType,
  StoredEntityMetadata,
} from './base.js';

export interface Entity extends BaseEntityMetadata {
  orphaned?: boolean;
  orphaned_at?: string;
}

// ============================================================================
// Entity 构件
// ============================================================================

/**
 * Product（业务视角实体）
 *
 * 业务产品分类，在 Domain/Enterprise 层定义
 * Project 层通过 REFERENCES 关系引用
 */
export interface Product extends Entity {
  type: 'product';
  data: {
    /** 基于哪个上层 Product（Domain → Enterprise → Project 继承链） */
    based_on?: string;
    /** 引用来源（project 层引用 enterprise 时使用） */
    reference_from?: 'domain' | 'enterprise';
    /** 产品文档 URI */
    doc_uri?: string;
    /** 扩展数据 */
    [key: string]: unknown;
  };
}

/**
 * System（技术视角顶层实体）
 *
 * 软件系统，与 Product 1:1 对应
 * 只在 Project 层存在
 */
export interface System extends Entity {
  type: 'system';
  data: {
    /** 对应的 Product ID（1:1 对应） */
    corresponds_to?: string;
    /** 是否外部系统 */
    external?: boolean;
    /** 外部系统信息 */
    external_info?: ExternalInfo;
    /** 包含的 Container ID 列表 */
    containers?: string[];
    /** 扩展数据 */
    [key: string]: unknown;
  };
}

/**
 * Container（容器/服务）
 *
 * System 的组成部分，可独立部署的单元
 */
export interface Container extends Entity {
  type: 'container';
  data: {
    /** 所属 System ID */
    system_id: string;
    /** 技术栈列表（支持多语言/多框架场景） */
    technology?: Array<{
      language: string;
      framework?: string;
      runtime?: string;
      protocol?: string;
    }>;
    /** 端口配置 */
    ports?: Array<{
      port: number;
      protocol: 'HTTP' | 'gRPC' | 'TCP' | 'WebSocket';
      description?: string;
    }>;
    /** 代码仓库 */
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
    /** 包含的 Component ID 列表 */
    components?: string[];
    /** API 契约引用 */
    apis?: Array<{
      type: 'openapi' | 'asyncapi' | 'proto' | 'graphql';
      ref: string;
      version?: string;
    }>;
    /** 扩展数据 */
    [key: string]: unknown;
  };
}

/**
 * Component（组件/模块）
 *
 * Container 的组成部分，代码级别的模块
 */
export interface Component extends Entity {
  type: 'component';
  data: {
    /** 所属 Container ID */
    container_id: string;
    /** 技术 */
    technology?: string;
    /** 代码路径（关联代码文件） */
    code_path?: string;
    /** 实现的 Contract ID 列表 */
    implements_contracts?: string[];
    /** 扩展数据 */
    [key: string]: unknown;
  };
}

// ============================================================================
// Process 构件
// ============================================================================

/**
 * Process 类型
 */
export type ProcessType = 'business' | 'technical';

/**
 * Flow 类型（流程图）
 */
export type FlowType = 'sequence_diagram' | 'activity_diagram' | 'state_machine';

/**
 * Flow 信息（流程图元数据）
 */
export interface FlowInfo {
  type: FlowType;
  diagram_uri?: string;
  diagram_content?: string;
}

/**
 * Process（流程）
 *
 * 业务或技术流程，描述"怎么运作"
 */
export interface Process extends Entity {
  type: 'process';
  data: {
    /** 流程类型：业务流程或技术流程 */
    process_type: ProcessType;
    /** 基于哪个上层 Process */
    based_on?: string;
    /** 父流程 ID（形成流程树） */
    parent_id?: string;
    /** 流程描述 */
    description?: string;
    /** 流程图信息 */
    flow?: FlowInfo;
    /** 扩展数据 */
    [key: string]: unknown;
  };
}

// ============================================================================
// SoR 构件 (Statement of Requirements)
// ============================================================================

/**
 * SoR 类型（9 种）
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
 * SoR（需求项）
 *
 * Statement of Requirements，描述"要满足什么"
 * 由 Entity × Process 交叉产生
 */
export interface SoR extends Entity {
  type: 'sor';
  data: {
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
    /** 基于哪个上层 SoR */
    based_on?: string;
    /** 对应的 SoR ID（Business SoR ↔ Technical SoR 对应） */
    corresponds_to?: string;
    /** 扩展数据 */
    [key: string]: unknown;
  };
}

// ============================================================================
// Entity-Process Mesh 辅助类型
// ============================================================================

/**
 * Mesh 交叉点
 * Entity × Process → SoR
 */
export interface MeshPoint {
  entity_id: string;
  entity_type: SoREntityType;
  process_id: string;
  sor_ids: string[];
}

/**
 * Mesh 视图
 */
export interface MeshView {
  perspective: Perspective;
  entities: Array<{
    id: string;
    type: SoREntityType;
    name: string;
  }>;
  processes: Array<{
    id: string;
    name: string;
  }>;
  matrix: MeshPoint[];
}

// ============================================================================
// 联合类型
// ============================================================================

/**
 * 核心实体联合类型
 */
export type CoreEntity = Product | System | Container | Component | Process | SoR;

/**
 * 技术视角实体联合类型
 */
export type TechnicalEntity = System | Container | Component;

/**
 * 业务视角实体联合类型
 */
export type BusinessEntity = Product;

// ============================================================================
// 类型守卫
// ============================================================================

export function isProduct(entity: unknown): entity is Product {
  return (entity as Product)?.type === 'product';
}

export function isSystem(entity: unknown): entity is System {
  return (entity as System)?.type === 'system';
}

export function isContainer(entity: unknown): entity is Container {
  return (entity as Container)?.type === 'container';
}

export function isComponent(entity: unknown): entity is Component {
  return (entity as Component)?.type === 'component';
}

export function isProcess(entity: unknown): entity is Process {
  return (entity as Process)?.type === 'process';
}

export function isSoR(entity: unknown): entity is SoR {
  return (entity as SoR)?.type === 'sor';
}

export function isTechnicalEntity(entity: unknown): entity is TechnicalEntity {
  return isSystem(entity) || isContainer(entity) || isComponent(entity);
}

export function isBusinessEntity(entity: unknown): entity is BusinessEntity {
  return isProduct(entity);
}

export function isCoreEntity(entity: unknown): entity is CoreEntity {
  return (
    isProduct(entity) ||
    isSystem(entity) ||
    isContainer(entity) ||
    isComponent(entity) ||
    isProcess(entity) ||
    isSoR(entity)
  );
}
