/**
 * Storage Adapter Layer - CRUD 类型定义
 */

import type {
  Entity,
  EntityMetadata,
  EntityType,
  EntityStatus,
  OutputFormat,
  Relation,
} from './adapterBaseTypes.js';

// ============================================================
// CRUD 类型定义
// ============================================================

/**
 * 保存选项
 */
export interface SaveOptions {
  expected_updated_at?: string;
  force?: boolean;
}

/**
 * 保存输入（允许缺省 uuid/versions/metadata）
 */
export type EntityInput = Omit<Entity, 'uuid' | 'versions' | 'metadata'> & {
  uuid?: string;
  versions?: string[];
  metadata?: Partial<EntityMetadata>;
};

/**
 * 实体过滤条件
 */
export interface EntityFilter {
  root_id?: string;
  id?: string;
  version?: string;
  requirement_id?: string;
  type?: EntityType | EntityType[];
  limit?: number;
  offset?: number;
}

/**
 * 保存结果
 */
export type SaveResult = LegacySaveResult;

/**
 * 读取结果
 */
export type ReadResult = Entity | null;

/**
 * 列表结果
 */
export type ListResult = LegacyListResult;

/**
 * 删除结果
 */
export type DeleteResult = LegacyDeleteResult;

// ============================================================
// Legacy CRUD types (v0.3.0 compatibility)
// ============================================================

/**
 * ADR 缺失时的行为
 * @deprecated v0.3.1
 */
export type ADROnMissing = 'error' | 'warning' | 'ignore';

/**
 * ADR 策略配置
 * @deprecated v0.3.1
 */
export interface ADRPolicyConfig {
  enforce?: boolean;
  scope?: Array<'system' | 'container' | 'component'>;
  on_missing?: ADROnMissing;
}

/**
 * 警告信息
 * @deprecated v0.3.1
 */
export interface Warning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  details?: Record<string, unknown>;
}

/**
 * 保存实体参数（旧版）
 * @deprecated v0.3.1
 */
export interface SaveParams {
  type: EntityType;
  data?: Record<string, unknown>;
  content?: string;
  format?: 'yaml' | 'json';
  id?: string;
  root_id?: string;
  requirement_id?: string | null;
  enforce_adr?: boolean;
  adr_policy?: ADRPolicyConfig;
  skip_adr_check?: boolean;
  ignore_concurrent_warning?: boolean;
  force_save?: boolean;
}

/**
 * 保存结果（旧版）
 * @deprecated v0.3.1
 */
export interface LegacySaveResult {
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
 * 读取实体参数（旧版）
 * @deprecated v0.3.1
 */
export interface ReadParams {
  id?: string;
  format?: OutputFormat;
  requirement_id?: string | string[] | null;
  filter?: Record<string, unknown>;
  limit?: number;
  include_relations?: boolean;
  filter_relations?: Record<string, unknown>;
}

/**
 * 读取结果（对象格式，旧版）
 * @deprecated v0.3.1
 */
export interface ReadResultObject {
  entity: Entity | null;
  relations?: Relation[];
}

/**
 * 读取结果（字符串格式，旧版）
 * @deprecated v0.3.1
 */
export interface ReadResultString {
  id: string;
  type: EntityType;
  status: EntityStatus;
  content: string;
  format: 'yaml' | 'json';
}

/**
 * 列表参数（旧版）
 * @deprecated v0.3.1
 */
export interface ListParams {
  filter?: Record<string, unknown>;
  type?: EntityType | 'all';
  root_id?: string;
  requirement_id?: string | null;
  status?: EntityStatus;
  updated_after?: string;
  limit?: number;
  offset?: number;
  group_by?: 'type' | 'status';
  count_only?: boolean;
}

/**
 * 列表项概要（旧版）
 * @deprecated v0.3.1
 */
export interface ListItem {
  id: string;
  type: EntityType;
  status: EntityStatus;
  updated_at: string;
  content_hash: string;
  root_id?: string;
  requirement_id?: string | null;
}

/**
 * 分页信息（旧版）
 * @deprecated v0.3.1
 */
export interface Pagination {
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

/**
 * 列表结果（旧版）
 * @deprecated v0.3.1
 */
export interface LegacyListResult {
  items?: ListItem[];
  pagination?: Pagination;
  total?: number;
  by_type?: Record<string, number>;
  by_status?: Record<string, number>;
  groups?: Record<string, { count: number; items?: ListItem[] }>;
}

/**
 * 删除参数（旧版）
 * @deprecated v0.3.1
 */
export interface DeleteParams {
  id: string;
  requirement_id?: string | null;
  force?: boolean;
}

/**
 * 删除结果（旧版）
 * @deprecated v0.3.1
 */
export interface LegacyDeleteResult {
  success: boolean;
  id: string;
  deleted_relations?: number;
  soft_deleted?: boolean;
  warnings?: Warning[];
}
