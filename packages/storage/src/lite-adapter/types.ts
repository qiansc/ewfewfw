/**
 * LiteAdapter 类型定义
 */

import type { SQLiteStore } from '../sqlite-store.js';
import type { InMemoryGraph } from '../in-memory-graph.js';
import type { GraphQueryCache } from '../graph-query-cache.js';

// ============================================================
// 配置类型
// ============================================================

export interface LiteAdapterConfig {
  /**
   * 数据库文件路径
   * 默认: ~/.c4a/store.db
   */
  dbPath?: string;

  /**
   * 默认项目 ID
   */
  defaultProject?: string;

  /**
   * 是否启用向量搜索
   * 默认: true (如果 USearch 可用)
   */
  enableVectorSearch?: boolean;

  /**
   * 仓库标识（用于备份元数据）
   */
  repoId?: string | null;

  /**
   * Feat 相关配置
   */
  feat?: {
    /**
     * 是否启用并发修改预警
     * 默认: true
     */
    concurrent_warning?: boolean;
    /**
     * 是否自动通知并发 feat 负责人
     * 默认: false
     */
    auto_notify?: boolean;
  };
}

export interface RequiredConfig extends Required<LiteAdapterConfig> {
  repoId: string | null;
  feat: {
    concurrent_warning: boolean;
    auto_notify: boolean;
  };
}

// ============================================================
// 数据库行类型
// ============================================================

export interface EntityRow {
  id: string;
  source_project: string;
  proposal_id: string | null;
  type: string;
  kind: string | null;
  scope: string | null;
  perspective: string | null;
  data: string;
  status: string;
  content_hash: string;
  created_at: string;
  updated_at: string;
  source_repo: string | null;
  external_url: string | null;
  created_by: string | null;
  updated_by: string | null;
}

// ============================================================
// 上下文类型（用于模块间共享状态）
// ============================================================

export interface AdapterContext {
  store: SQLiteStore;
  graph: InMemoryGraph;
  cache: GraphQueryCache;
  config: RequiredConfig;
}

// ============================================================
// 关系解析结果类型
// ============================================================

export interface ParsedRelation {
  fromProject?: string;
  fromId?: string;
  toProject: string;
  toId: string;
  relType: string;
  properties?: Record<string, unknown>;
}
