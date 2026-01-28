import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

/**
 * SQLite Store for Local Mode
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/sqlite-schema.md
 *
 * 核心特性:
 * - 单文件数据库 (SQLite)
 * - 复合主键支持 (source_project, id, proposal_id)
 * - Copy-on-Write (CoW) 机制
 * - WAL 模式并发访问
 */

export interface SQLiteStoreConfig {
  /**
   * 数据库文件路径
   * 默认: .context/c4a.db
   */
  dbPath?: string;

  /**
   * 是否只读模式
   */
  readonly?: boolean;

  /**
   * 忙等待超时时间 (毫秒)
   * 默认: 5000
   */
  busyTimeout?: number;
}

/**
 * SQLite Store 实现
 *
 * Local 模式的核心存储引擎，使用 SQLite 替代 Server 模式的三库架构
 */
export class SQLiteStore {
  private static instance: SQLiteStore | null = null;
  private db: Database.Database;
  private config: Required<SQLiteStoreConfig>;
  private vectorSearchEnabled: boolean = false;

  private constructor(config: SQLiteStoreConfig = {}) {
    this.config = {
      dbPath: config.dbPath || join(process.cwd(), '.context', 'c4a.db'),
      readonly: config.readonly || false,
      busyTimeout: config.busyTimeout || 5000,
    };

    // 确保目录存在
    const dbDir = join(this.config.dbPath, '..');
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // 初始化数据库
    this.db = new Database(this.config.dbPath, {
      readonly: this.config.readonly,
      fileMustExist: false,
    });

    // 配置并发访问参数 (设计文档 §1.2)
    this.configureConcurrency();

    // 尝试加载 sqlite-vec 扩展
    this.loadVectorExtension();

    // 创建表结构
    if (!this.config.readonly) {
      this.createTables();
    }
  }

  /**
   * 配置并发访问
   *
   * 设计文档: sqlite-schema.md L27-51
   *
   * - WAL 模式: 允许读写并发
   * - busy_timeout: 避免 SQLITE_BUSY 错误
   * - synchronous=NORMAL: 平衡性能和安全性
   */
  private configureConcurrency(): void {
    // 启用 WAL 模式（Write-Ahead Logging）
    // 允许读写并发，显著提升并发性能
    this.db.pragma('journal_mode = WAL');

    // 设置忙等待超时（毫秒）
    // 当数据库被锁定时，等待而非立即失败
    this.db.pragma(`busy_timeout = ${this.config.busyTimeout}`);

    // 同步模式设置为 NORMAL（平衡性能和安全性）
    this.db.pragma('synchronous = NORMAL');
  }

  /**
   * 加载 sqlite-vec 扩展
   *
   * 设计文档: appendix.md Q1 降级策略
   */
  private loadVectorExtension(): void {
    try {
      this.db.loadExtension('vec0');
      this.vectorSearchEnabled = true;
    } catch {
      // 扩展不可用，降级到全文搜索
      this.vectorSearchEnabled = false;
    }
  }

  /**
   * 检查向量搜索是否可用
   */
  isVectorSearchEnabled(): boolean {
    return this.vectorSearchEnabled;
  }

  /**
   * 创建表结构
   *
   * 设计文档: sqlite-schema.md §2
   */
  private createTables(): void {
    // 项目配置表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS configs (
        id TEXT PRIMARY KEY,
        repo_id TEXT,
        created_at TEXT,
        updated_at TEXT
      );
    `);

    // 实体数据表 (复合主键: source_project, id, proposal_id)
    // 设计文档: L89-107
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT NOT NULL,
        source_project TEXT NOT NULL,
        proposal_id TEXT,
        type TEXT NOT NULL,
        kind TEXT,
        scope TEXT,
        perspective TEXT,
        data TEXT NOT NULL,
        PRIMARY KEY (source_project, id, proposal_id)
      );

      CREATE INDEX IF NOT EXISTS idx_entities_proposal_id ON entities(proposal_id);
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_source_project ON entities(source_project);
      CREATE INDEX IF NOT EXISTS idx_entities_id ON entities(id);
    `);

    // 实体元数据表
    // 设计文档: L108-127
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        entity_id TEXT NOT NULL,
        source_project TEXT NOT NULL,
        proposal_id TEXT,
        source_repo TEXT,
        external_url TEXT,
        status TEXT NOT NULL,
        content_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT,
        PRIMARY KEY (source_project, entity_id, proposal_id),
        FOREIGN KEY (source_project, entity_id, proposal_id)
          REFERENCES entities(source_project, id, proposal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_metadata_content_hash ON metadata(content_hash);
    `);

    // 实体关系表 (无外键约束，支持跨项目引用)
    // 设计文档: L128-148
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        proposal_id TEXT,
        from_project TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_project TEXT NOT NULL,
        to_id TEXT NOT NULL,
        rel_type TEXT NOT NULL,
        properties TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_relations_proposal_id ON relations(proposal_id);
      CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_project, from_id);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_project, to_id);
      CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(rel_type);
    `);

    // 实体变更历史表
    // 设计文档: L166-188
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entity_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id TEXT NOT NULL,
        source_project TEXT NOT NULL,
        proposal_id TEXT,
        entity_type TEXT NOT NULL,
        feat_id TEXT,
        action TEXT NOT NULL,
        changed_fields TEXT,
        snapshot_after TEXT,
        changed_by TEXT,
        changed_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_entity_history_entity_id ON entity_history(entity_id);
      CREATE INDEX IF NOT EXISTS idx_entity_history_source_project ON entity_history(source_project);
      CREATE INDEX IF NOT EXISTS idx_entity_history_proposal_id ON entity_history(proposal_id);
      CREATE INDEX IF NOT EXISTS idx_entity_history_feat_id ON entity_history(feat_id);
      CREATE INDEX IF NOT EXISTS idx_entity_history_changed_at ON entity_history(changed_at);
    `);

    // Feat 表 (feat 生命周期管理)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feats (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'draft',
        title TEXT,
        description TEXT,
        created_by TEXT,
        checklist TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_feats_status ON feats(status);
    `);

    // Feat 发布历史表 (用于回滚)
    // 设计文档: L219-231
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feat_id TEXT NOT NULL,
        published_at TEXT NOT NULL,
        entities_snapshot TEXT NOT NULL,
        published_by TEXT,
        UNIQUE (feat_id, published_at)
      );

      CREATE INDEX IF NOT EXISTS idx_feat_history_feat_id ON feat_history(feat_id);
      CREATE INDEX IF NOT EXISTS idx_feat_history_published_at ON feat_history(published_at);
    `);

    // 图查询缓存表
    // 设计文档: L281-291
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_cache (
        query_hash TEXT PRIMARY KEY,
        result TEXT,
        created_at TEXT,
        expires_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_graph_cache_expires ON graph_cache(expires_at);
    `);

    // vectors 表：使用 sqlite-vec 扩展创建虚拟表
    // 设计文档: L254-267
    if (this.vectorSearchEnabled) {
      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(
            entity_id TEXT NOT NULL,
            source_project TEXT NOT NULL,
            proposal_id TEXT,
            embedding FLOAT[384],
            PRIMARY KEY (source_project, entity_id, proposal_id)
          );
        `);
      } catch {
        // 虚拟表创建失败，禁用向量搜索
        this.vectorSearchEnabled = false;
      }
    }
  }

  // ============================================================
  // Merge View 查询 (设计文档 §3)
  // ============================================================

  /**
   * 获取合并视图的实体列表
   *
   * 设计文档: sqlite-schema.md L300-370
   *
   * Merge View 核心原则:
   * 1. Feat 优先: 当前 Feat 中的版本覆盖主分支版本
   * 2. 主分支兜底: Feat 中不存在的实体从主分支获取
   * 3. 其他 Feat 不可见
   *
   * @param proposalId - 当前 Feat ID (null 表示只查主分支)
   */
  getMergedEntities(proposalId: string | null = null): unknown[] {
    if (proposalId === null) {
      // 只查主分支
      return this.db.prepare(`
        SELECT * FROM entities WHERE proposal_id IS NULL
      `).all();
    }

    // Merge View: Feat 优先 + 主分支兜底
    return this.db.prepare(`
      WITH ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY source_project, id
            ORDER BY
              CASE
                WHEN proposal_id = ? THEN 1
                WHEN proposal_id IS NULL THEN 2
                ELSE 3
              END
          ) AS rn
        FROM entities
        WHERE proposal_id = ? OR proposal_id IS NULL
      )
      SELECT id, source_project, proposal_id, type, kind, scope, perspective, data
      FROM ranked WHERE rn = 1
    `).all(proposalId, proposalId);
  }

  /**
   * 获取合并视图的关系列表
   *
   * @param proposalId - 当前 Feat ID (null 表示只查主分支)
   */
  getMergedRelations(proposalId: string | null = null): unknown[] {
    if (proposalId === null) {
      return this.db.prepare(`
        SELECT * FROM relations WHERE proposal_id IS NULL
      `).all();
    }

    return this.db.prepare(`
      WITH ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY from_project, from_id, to_project, to_id, rel_type
            ORDER BY
              CASE
                WHEN proposal_id = ? THEN 1
                WHEN proposal_id IS NULL THEN 2
                ELSE 3
              END
          ) AS rn
        FROM relations
        WHERE proposal_id = ? OR proposal_id IS NULL
      )
      SELECT id, proposal_id, from_project, from_id, to_project, to_id, rel_type, properties, created_at, updated_at
      FROM ranked WHERE rn = 1
    `).all(proposalId, proposalId);
  }

  /**
   * 获取 SQLiteStore 单例实例
   *
   * 设计文档: vector-search.md L493-526
   *
   * @param config - 配置参数（仅首次调用有效）
   * @returns SQLiteStore 实例
   */
  static getInstance(config?: SQLiteStoreConfig): SQLiteStore {
    if (!this.instance) {
      this.instance = new SQLiteStore(config);

      // 注册进程退出钩子，确保数据库正确关闭
      process.on('exit', () => {
        this.closeInstance();
      });

      process.on('SIGINT', () => {
        this.closeInstance();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        this.closeInstance();
        process.exit(0);
      });
    }
    return this.instance;
  }

  /**
   * 关闭单例实例
   */
  private static closeInstance(): void {
    if (this.instance) {
      this.instance.db.close();
      this.instance = null;
    }
  }

  /**
   * 关闭数据库连接（实例方法）
   */
  close(): void {
    this.db.close();
  }

  /**
   * 获取原生数据库对象 (用于高级操作)
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  // ============================================================
  // 向量索引维护 (设计文档 §3.4)
  // ============================================================

  /**
   * 保存实体并同步创建向量
   *
   * 设计文档: vector-search.md L528-575
   *
   * @param entity - 实体数据
   * @param embedding - 向量（如未提供，需外部先生成）
   */
  saveEntityWithVector(
    entity: {
      id: string;
      source_project: string;
      proposal_id: string | null;
      type: string;
      kind?: string;
      scope?: string;
      perspective?: string;
      data: Record<string, unknown>;
    },
    embedding: Float32Array
  ): void {
    // 使用事务保证 entities 和 vectors 表的一致性
    const transaction = this.db.transaction(() => {
      // 1. 插入实体
      this.db
        .prepare(
          `
        INSERT INTO entities (id, source_project, proposal_id, type, kind, scope, perspective, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (source_project, id, proposal_id) DO UPDATE SET
          type = excluded.type,
          kind = excluded.kind,
          scope = excluded.scope,
          perspective = excluded.perspective,
          data = excluded.data
      `
        )
        .run(
          entity.id,
          entity.source_project,
          entity.proposal_id,
          entity.type,
          entity.kind || null,
          entity.scope || null,
          entity.perspective || null,
          JSON.stringify(entity.data)
        );

      // 2. 插入向量（需要 sqlite-vec 扩展）
      // 注意: 此处使用 INSERT OR REPLACE 语义
      // 实际 SQL 需要根据 sqlite-vec 的 API 调整
      this.db
        .prepare(
          `
        INSERT INTO vectors (entity_id, source_project, proposal_id, embedding)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (source_project, entity_id, proposal_id) DO UPDATE SET
          embedding = excluded.embedding
      `
        )
        .run(entity.id, entity.source_project, entity.proposal_id, embedding);
    });

    transaction();
  }

  /**
   * 批量重建向量索引
   *
   * 设计文档: vector-search.md L589-594
   *
   * @param proposalId - Feat ID (null 表示重建主分支)
   * @param generateEmbedding - 向量生成函数
   */
  async rebuildVectorIndex(
    proposalId: string | null,
    generateEmbedding: (text: string) => Promise<Float32Array>
  ): Promise<void> {
    // 1. 获取指定版本的所有实体
    const entities = this.db
      .prepare(
        `
      SELECT id, source_project, proposal_id, type, data
      FROM entities
      WHERE proposal_id IS ?
    `
      )
      .all(proposalId) as Array<{
      id: string;
      source_project: string;
      proposal_id: string | null;
      type: string;
      data: string;
    }>;

    // 2. 批量生成向量（每 100 条提交一次事务）
    const BATCH_SIZE = 100;
    for (let i = 0; i < entities.length; i += BATCH_SIZE) {
      const batch = entities.slice(i, i + BATCH_SIZE);

      // 先生成所有向量（事务外）
      const embeddings = await Promise.all(
        batch.map(async (entity) => {
          const parsedData = JSON.parse(entity.data) as Record<string, unknown>;
          const text = this.generateSearchText(parsedData);
          return generateEmbedding(text);
        })
      );

      // 再批量插入（事务内）
      const transaction = this.db.transaction(() => {
        batch.forEach((entity, idx) => {
          this.db
            .prepare(
              `
            INSERT INTO vectors (entity_id, source_project, proposal_id, embedding)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (source_project, entity_id, proposal_id) DO UPDATE SET
              embedding = excluded.embedding
          `
            )
            .run(
              entity.id,
              entity.source_project,
              entity.proposal_id,
              embeddings[idx]
            );
        });
      });

      transaction();
    }
  }

  /**
   * 生成搜索文本（用于向量化）
   *
   * 设计文档: vector-search.md L566-575
   */
  private generateSearchText(data: Record<string, unknown>): string {
    const parts = [
      data.name,
      data.description,
      Array.isArray(data.tags) ? data.tags.join(' ') : null,
    ].filter(Boolean);

    return parts.join(' ');
  }
}
