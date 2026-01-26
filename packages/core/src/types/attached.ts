/**
 * C4A 附属实体类型定义
 *
 * ADR（架构决策记录）和 Contract（接口规格）
 */

import type { BaseEntityMetadata, Criticality, LifecycleStatus } from './base';

// ============================================================================
// ADR (Architecture Decision Record)
// ============================================================================

/**
 * ADR 状态
 * 注意：ADR 有自己的状态机，与通用生命周期略有不同
 */
export type ADRStatus =
  | 'draft' // 草稿
  | 'proposed' // 已提出，等待审核
  | 'approved' // 已批准
  | 'implemented' // 已实施
  | 'published' // 已发布
  | 'deprecated' // 已废弃
  | 'superseded'; // 已被替代

/**
 * ADR 影响的元素
 */
export interface ADRAffects {
  element_type: 'system' | 'container' | 'component';
  element_id: string;
  scope?: string;
}

/**
 * ADR 备选方案
 */
export interface ADRAlternative {
  name: string;
  description?: string;
  pros?: string[];
  cons?: string[];
  evaluation?: number; // 1-5 评分
}

/**
 * ADR 后果
 */
export interface ADRConsequences {
  positive?: string[];
  negative?: string[];
  neutral?: string[];
}

/**
 * ADR 相关引用
 */
export interface ADRRelated {
  /** 替代的 ADR */
  supersedes?: string;
  /** 被哪个 ADR 替代 */
  superseded_by?: string;
  /** 相关的 ADR */
  related_adrs?: string[];
  /** 相关的 Contract */
  related_contracts?: string[];
}

/**
 * ADR（架构决策记录）
 *
 * 记录架构决策的背景、选项和结论
 * 只在 Project Knowledge 层存在
 */
export interface ADR extends BaseEntityMetadata {
  type: 'adr';
  data: {
    /** ADR 状态 */
    adr_status: ADRStatus;
    /** 关联的 System ID */
    system_id?: string;
    /** 日期 */
    date?: string;
    /** 作者列表 */
    authors?: string[];
    /** 审核人列表 */
    reviewers?: string[];
    /** 批准人 */
    approved_by?: string;
    /** 批准时间 */
    approved_at?: string;
    /** 上下文背景 */
    context: string;
    /** 决策内容 */
    decision: string;
    /** 后果分析 */
    consequences?: ADRConsequences;
    /** 备选方案 */
    alternatives?: ADRAlternative[];
    /** 影响的元素 */
    affects?: ADRAffects[];
    /** 相关引用 */
    related?: ADRRelated;
    /** 完整内容（Markdown） */
    content?: string;
    /** 扩展数据 */
    [key: string]: unknown;
  };
}

// ============================================================================
// Contract（接口规格）
// ============================================================================

/**
 * Contract 类型
 */
export type ContractType = 'openapi' | 'asyncapi' | 'proto' | 'graphql';

/**
 * Contract 状态
 */
export type ContractStatus =
  | 'draft' // 草稿
  | 'approved' // 已批准
  | 'implemented' // 已实现
  | 'published' // 已发布
  | 'deprecated'; // 已废弃

/**
 * Contract 验证结果
 */
export interface ContractValidation {
  last_validated_at?: string;
  success?: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * Contract 破坏性变更记录
 */
export interface ContractBreakingChange {
  version: string;
  description: string;
  migration_guide?: string;
}

/**
 * Contract 相关引用
 */
export interface ContractRelated {
  /** 关联的 ADR ID */
  adr_id?: string;
  /** 消费者列表 */
  consumers?: string[];
  /** 替代的 Contract */
  supersedes?: string;
  /** 被哪个 Contract 替代 */
  superseded_by?: string;
}

/**
 * Contract（接口规格）
 *
 * SoR 的技术设计表达，描述接口的具体规格
 * 关系链路：SoR → Contract → Component
 */
export interface Contract extends BaseEntityMetadata {
  type: 'contract';
  data: {
    /** Contract 类型 */
    contract_type: ContractType;
    /** Contract 状态 */
    contract_status: ContractStatus;
    /** 版本号 */
    version?: string;
    /** 关联的 Container ID */
    container_id?: string;
    /** 实现此 Contract 的 Component ID */
    component_id?: string;
    /** 实现了哪些 SoR（IMPLEMENTS 关系的数据字段冗余） */
    implements_sor?: string[];

    /**
     * 内联存储规格内容
     * 适用于小型契约，便于版本管理
     */
    spec?: Record<string, unknown>;

    /**
     * 外部引用 URI
     * 适用于大型契约，URI 作为唯一标识
     * 注意：spec_uri 指向的文件不在 C4A 同步范围内
     */
    spec_uri?: string;

    /** 元数据 */
    metadata?: {
      created_at?: string;
      updated_at?: string;
      created_by?: string;
      approved_by?: string;
      approved_at?: string;
    };

    /** 验证结果 */
    validation?: ContractValidation;

    /** 相关引用 */
    related?: ContractRelated;

    /** 破坏性变更记录 */
    breaking_changes?: ContractBreakingChange[];

    /** 扩展数据 */
    [key: string]: unknown;
  };
}

// ============================================================================
// 附属实体联合类型
// ============================================================================

/**
 * 附属实体联合类型
 */
export type AttachedEntity = ADR | Contract;

// ============================================================================
// 类型守卫
// ============================================================================

export function isADR(entity: unknown): entity is ADR {
  return (entity as ADR)?.type === 'adr';
}

export function isContract(entity: unknown): entity is Contract {
  return (entity as Contract)?.type === 'contract';
}

export function isAttachedEntity(entity: unknown): entity is AttachedEntity {
  return isADR(entity) || isContract(entity);
}

// ============================================================================
// ADR 检测相关
// ============================================================================

/**
 * 架构变更类型（需要 ADR 的变更）
 */
export type ArchitectureChangeType =
  | 'new_system' // 新增系统
  | 'new_container' // 新增容器
  | 'new_dependency' // 新增依赖
  | 'technology_change' // 技术栈变更
  | 'api_breaking_change' // API 破坏性变更
  | 'security_change' // 安全相关变更
  | 'data_model_change'; // 数据模型变更

/**
 * ADR 检测结果
 */
export interface ADRDetectionResult {
  /** 是否需要 ADR */
  requires_adr: boolean;
  /** 变更类型 */
  change_types: ArchitectureChangeType[];
  /** 影响的实体 */
  affected_entities: Array<{
    id: string;
    type: string;
    change_description: string;
  }>;
  /** 建议的 ADR 模板 */
  suggested_template?: string;
}
