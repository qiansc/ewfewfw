/**
 * Storage Adapter Layer - CRUD 类型定义
 */

import type { EntityType, EntityStatus, OutputFormat, Entity, Relation } from './adapterBaseTypes.js';

// ============================================================
// 操作参数类型
// ============================================================

/**
 * ADR 缺失时的行为
 */
export type ADROnMissing = 'error' | 'warning' | 'ignore';

/**
 * ADR 策略配置
 */
export interface ADRPolicyConfig {
  enforce?: boolean;
  scope?: Array<'system' | 'container' | 'component'>;
  on_missing?: ADROnMissing;
}

/**
 * 保存实体参数
 * 设计文档: store-crud.md §3.1
 */
export interface SaveParams {
  type: EntityType;
  data?: Record<string, unknown>;
  content?: string;
  format?: 'yaml' | 'json';
  id?: string;
  source_project?: string;
  proposal_id?: string | null;
  enforce_adr?: boolean;
  adr_policy?: ADRPolicyConfig;
  skip_adr_check?: boolean;
  ignore_concurrent_warning?: boolean;
  force_save?: boolean;
}

/**
 * 保存结果
 */
export interface SaveResult {
  success: boolean;
  id: string;
  status: EntityStatus;
  content_hash: string;
  adr_check?: {
    required: boolean;
    passed: boolean;
    missing_adr?: boolean;
    message?: string;
  };
  warnings?: Warning[];
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * 警告信息
 */
export interface Warning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  details?: Record<string, unknown>;
}

/**
 * 读取实体参数
 * 设计文档: store-crud.md §3.2
 */
export interface ReadParams {
  id?: string;
  format?: OutputFormat;
  proposal_id?: string | string[] | null;
  filter?: Record<string, unknown>;
  limit?: number;
  include_relations?: boolean;
  filter_relations?: Record<string, unknown>;
}

/**
 * 读取结果（对象格式）
 */
export interface ReadResultObject {
  entity: Entity | null;
  relations?: Relation[];
}

/**
 * 读取结果（字符串格式）
 */
export interface ReadResultString {
  id: string;
  type: EntityType;
  status: EntityStatus;
  content: string;
  format: 'yaml' | 'json';
}

/**
 * 列表参数
 * 设计文档: store-crud.md §3.3
 */
export interface ListParams {
  filter?: Record<string, unknown>;
  type?: EntityType | 'all';
  project_id?: string;
  proposal_id?: string | null;
  status?: EntityStatus;
  updated_after?: string;
  limit?: number;
  offset?: number;
  group_by?: 'type' | 'status';
  count_only?: boolean;
}

/**
 * 列表项概要
 */
export interface ListItem {
  id: string;
  type: EntityType;
  status: EntityStatus;
  updated_at: string;
  content_hash: string;
  source_project?: string;
  proposal_id?: string | null;
}

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
 * 列表结果
 */
export interface ListResult {
  items?: ListItem[];
  pagination?: Pagination;
  total?: number;
  by_type?: Record<string, number>;
  by_status?: Record<string, number>;
  groups?: Record<string, { count: number; items?: ListItem[] }>;
}

/**
 * 删除参数
 * 设计文档: store-crud.md §3.4
 */
export interface DeleteParams {
  id: string;
  proposal_id?: string | null;
  force?: boolean;
}

/**
 * 删除结果
 */
export interface DeleteResult {
  success: boolean;
  id: string;
  deleted_relations?: number;
  soft_deleted?: boolean;
  warnings?: Warning[];
}
