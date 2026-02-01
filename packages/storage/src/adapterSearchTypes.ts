/**
 * Storage Adapter Layer - 查询类型定义
 */

import type { EntityType, EntityMetadata } from './adapterBaseTypes.js';

// ============================================================
// 查询参数类型
// ============================================================

/**
 * 语义搜索参数
 */
export interface SearchParams {
  query: string;
  scope?: EntityType | 'all';
  proposal_id?: string | null;
  limit?: number;
  offset?: number;
}

/**
 * 搜索结果项
 */
export interface SearchResultItem {
  id: string;
  type: EntityType;
  score: number;
  snippet?: string;
  metadata: Partial<EntityMetadata>;
}

/**
 * 搜索模式
 */
export type SearchMode = 'vector' | 'fulltext' | 'like';

/**
 * 搜索结果（包含降级状态）
 *
 * 设计文档: appendix.md Q1 降级策略
 */
export interface SearchResult {
  items: SearchResultItem[];
  /** 是否降级 */
  degraded: boolean;
  /** 降级原因 */
  degraded_reason?:
    | 'VECTOR_SEARCH_UNAVAILABLE'
    | 'VECTOR_SEARCH_FAILED'
    | 'NO_VECTOR_RESULTS'
    | 'FULLTEXT_SEARCH_UNAVAILABLE';
  /** 降级提示信息 */
  degraded_message?: string;
  /** 搜索模式 */
  search_mode: SearchMode;
  /** 匹配总数（用于分页） */
  total?: number;
  /** 是否还有更多结果 */
  has_more?: boolean;
}

/**
 * 依赖查询参数
 */
export interface DepsParams {
  id: string;
  source_project?: string | null;
  direction?: 'upstream' | 'downstream' | 'both';
  depth?: number;
  proposal_id?: string | null;
}

/**
 * 依赖节点
 */
export interface DepsNode {
  id: string;
  source_project?: string | null;
  type: EntityType;
  distance: number;
  relation_type: string;
}

/**
 * 依赖查询结果（包含降级状态）
 */
export interface DepsResult {
  nodes: DepsNode[];
  degraded: boolean;
  degraded_reason?: 'NEO4J_QUERY_FAILED' | 'NEO4J_UNAVAILABLE';
  degraded_message?: string;
}

/**
 * 影响分析参数
 */
export interface ImpactParams {
  id: string;
  source_project?: string | null;
  change_type?: 'upgrade' | 'deprecate' | 'remove';
  depth?: number;
  proposal_id?: string | null;
}

/**
 * 影响节点
 */
export interface ImpactNode {
  id: string;
  source_project?: string | null;
  type: EntityType;
  distance: number;
  impact_level: 'direct' | 'indirect';
  reason?: string;
}

/**
 * 影响分析结果（包含降级状态）
 */
export interface ImpactResult {
  nodes: ImpactNode[];
  degraded: boolean;
  degraded_reason?: 'NEO4J_QUERY_FAILED' | 'NEO4J_UNAVAILABLE';
  degraded_message?: string;
}
