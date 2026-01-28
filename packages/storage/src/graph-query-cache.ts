/**
 * Graph Query Cache Module for Local Mode
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/graph-query.md §4.2
 *
 * 核心特性:
 * - 两层缓存机制（TTL + 反向索引）
 * - 精确失效（基于反向索引）
 * - 支持跨图实例的查询结果复用
 */

/**
 * 缓存条目
 */
interface CacheEntry {
  result: unknown;
  expiresAt: number;
  relatedEntities: Set<string>;
}

/**
 * 图查询缓存
 *
 * 设计文档: graph-query.md L232-308
 *
 * 设计要点:
 * - TTL 过期机制（默认 5 分钟）
 * - 反向索引：entity → cache keys
 * - 实体变更时精确清除相关缓存
 */
export class GraphQueryCache {
  private cache: Map<string, CacheEntry> = new Map();
  private ttl: number = 5 * 60 * 1000; // 5 分钟
  private entityToCacheKeys: Map<string, Set<string>> = new Map(); // 反向索引

  /**
   * 获取缓存
   *
   * @param key - 缓存键
   * @returns 缓存结果，如果不存在或已过期则返回 null
   */
  get(key: string): unknown | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return null;
    }

    return entry.result;
  }

  /**
   * 设置缓存
   *
   * @param key - 缓存键
   * @param result - 查询结果
   * @param relatedEntities - 相关实体 ID 列表（用于失效）
   */
  set(key: string, result: unknown, relatedEntities: string[]): void {
    // 清理旧条目的反向索引
    this.delete(key);

    // 存储缓存条目
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + this.ttl,
      relatedEntities: new Set(relatedEntities),
    });

    // 建立反向索引：entity → cache keys
    for (const entityId of relatedEntities) {
      if (!this.entityToCacheKeys.has(entityId)) {
        this.entityToCacheKeys.set(entityId, new Set());
      }
      this.entityToCacheKeys.get(entityId)!.add(key);
    }
  }

  /**
   * 删除缓存条目
   *
   * @param key - 缓存键
   */
  private delete(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      // 清理反向索引
      for (const entityId of Array.from(entry.relatedEntities)) {
        this.entityToCacheKeys.get(entityId)?.delete(key);
      }
      this.cache.delete(key);
    }
  }

  /**
   * 实体变更时精确清除相关缓存（使用反向索引）
   *
   * 设计文档: graph-query.md L291-308
   *
   * @param entityId - 实体 ID
   */
  invalidate(entityId: string): void {
    const keysToDelete = this.entityToCacheKeys.get(entityId);
    if (keysToDelete) {
      for (const key of Array.from(keysToDelete)) {
        this.delete(key);
      }
      this.entityToCacheKeys.delete(entityId);
    }
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
    this.entityToCacheKeys.clear();
  }

  /**
   * 获取缓存统计信息（用于监控）
   */
  getStats(): {
    cacheSize: number;
    entityIndexSize: number;
    ttl: number;
  } {
    return {
      cacheSize: this.cache.size,
      entityIndexSize: this.entityToCacheKeys.size,
      ttl: this.ttl,
    };
  }

  /**
   * 设置 TTL（生存时间）
   *
   * @param ttl - TTL（毫秒）
   */
  setTTL(ttl: number): void {
    this.ttl = ttl;
  }

  /**
   * 清理过期缓存（定期调用）
   */
  cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (now > entry.expiresAt) {
        this.delete(key);
      }
    }
  }
}
