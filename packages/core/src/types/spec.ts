/**
 * C4A Spec 类型定义
 *
 * Functional Spec 和 Technical Spec 是视图概念，
 * 由现有实体组合而成，不是独立的实体类型
 */

import type { Product, System, Container, Component, Process, SoR, Entity } from './entities.js';
import type { Contract } from './attached.js';

// ============================================================================
// Functional Spec（PRD 的 DSL 版本）
// ============================================================================

/**
 * Functional Spec 组成
 * = Product + Business Process + Business SoR
 */
export interface FunctionalSpec {
  /** 关联的产品 */
  product?: Product;
  /** 业务流程列表 */
  processes: Process[];
  /** 业务 SoR 列表 */
  sors: SoR[];
}

// ============================================================================
// Technical Spec（技术设计的 DSL 版本）
// ============================================================================

/**
 * Technical Spec 组成
 * = System/Container/Component + Technical Process + Technical SoR + Contract
 */
export interface TechnicalSpec {
  /** 系统 */
  system?: System;
  /** 容器列表 */
  containers: Container[];
  /** 组件列表 */
  components: Component[];
  /** 技术流程列表 */
  processes: Process[];
  /** 技术 SoR 列表 */
  sors: SoR[];
  /** 契约列表 */
  contracts: Contract[];
}

// ============================================================================
// Spec 实体
// ============================================================================

/**
 * Spec 实体（Functional/Technical Spec 存储体）
 */
export interface SpecEntity extends Entity {
  type: 'spec';
  data?: {
    /** 视角（功能/技术） */
    perspective?: 'business' | 'technical';
    /** 规格内容（可为结构化对象或字符串） */
    content?: Record<string, unknown> | string;
    /** 内容格式 */
    format?: 'markdown' | 'yaml' | 'json';
    /** 扩展字段 */
    [key: string]: unknown;
  };
}

// ============================================================================
// Spec 查询参数
// ============================================================================

/**
 * 按 feat 查询 Spec
 */
export interface SpecByFeatQuery {
  /** feat ID */
  feat_id: string;
  /** 视角过滤 */
  perspective?: 'business' | 'technical';
}

/**
 * 按 Product 查询 Functional Spec
 */
export interface FunctionalSpecByProductQuery {
  /** Product ID */
  product_id: string;
}

/**
 * 按 System 查询 Technical Spec
 */
export interface TechnicalSpecBySystemQuery {
  /** System ID */
  system_id: string;
}
