/**
 * Storage Adapter Layer - 基础类型定义
 */

// ============================================================
// 基础类型定义
// ============================================================

/**
 * 实体类型
 */
export type EntityType =
  | 'system'
  | 'container'
  | 'component'
  | 'adr'
  | 'contract'
  | 'product'
  | 'process'
  | 'sor'
  | 'concept';

/**
 * 实体状态
 */
export type EntityStatus =
  | 'draft'
  | 'approved'
  | 'published'
  | 'deprecated'
  | 'archived';

/**
 * 返回格式
 */
export type OutputFormat = 'object' | 'yaml' | 'json';

// ============================================================
// 实体数据结构
// ============================================================

/**
 * 实体基础数据
 */
export interface EntityData {
  id: string;
  type: EntityType;
  kind?: string;
  scope?: string;
  perspective?: string;
  data: Record<string, unknown>;
}

/**
 * 实体元数据
 */
export interface EntityMetadata {
  source_project: string;
  source_repo?: string;
  external_url?: string;
  status: EntityStatus;
  content_hash: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

/**
 * 完整实体（数据 + 元数据）
 */
export interface Entity extends EntityData {
  proposal_id: string | null;
  metadata: EntityMetadata;
}

/**
 * 实体关系
 */
export interface Relation {
  id: string;
  proposal_id: string | null;
  from_project: string;
  from_id: string;
  to_project: string;
  to_id: string;
  rel_type: string;
  properties?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
