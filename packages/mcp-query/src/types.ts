/**
 * Query 工具输出类型定义
 *
 * 基于设计文档：v0.3.0/detailed-design/mcp/query.md
 */
import type { EntityType } from "@c4a/storage";

/**
 * 分页信息
 */
export interface Pagination {
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

/**
 * Query 通用返回结构
 */
export interface QueryResult<T> {
  items: T[];
  pagination?: Pagination;
  degraded?: boolean;
  degraded_reason?: string;
  degraded_message?: string;
  search_mode?: "vector" | "fulltext";
  suggestion?: string;
}

export interface QuerySuccessResult<T> extends QueryResult<T> {
  success?: true;
  max_depth_allowed?: number;
}

export interface QueryErrorResult {
  success: false;
  error: string;
  message: string;
  suggestion?: string;
}

/**
 * 查询上下文（降级/一致性状态）
 */
export interface QueryContext {
  degraded: boolean;
  degraded_reason?: string;
  degraded_message?: string;
  affected_entities?: string[];
}

/**
 * 搜索结果项
 */
export interface SearchHit {
  id: string;
  type: EntityType;
  score?: number;
  summary?: string;
  highlights?: string[];
}

export type QuerySearchResult = QuerySuccessResult<SearchHit>;

/**
 * 依赖节点
 */
export interface DepsNode {
  uuid: string;
  id: string;
  root_id: string;
  type: EntityType;
  distance: number;
  relation_type: string;
  path?: string[];
}

export type QueryDepsResult = QuerySuccessResult<DepsNode>;

/**
 * 影响节点
 */
export interface ImpactNode {
  uuid: string;
  id: string;
  root_id: string;
  type: EntityType;
  distance: number;
  impact_level: "direct" | "indirect";
  reason?: string;
}

export type QueryImpactResult = QuerySuccessResult<ImpactNode>;
export type QueryImpactResponse = QueryImpactResult | QueryErrorResult;
