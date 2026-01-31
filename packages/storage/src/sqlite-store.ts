import { Database } from 'bun:sqlite';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { VectorStore } from './usearch-store.js';
import { generateEmbedding, generateVectorKey, getEmbeddingDimension } from './vector-search.js';

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
  private db: Database;
  private config: Required<SQLiteStoreConfig>;
  private vectorSearchEnabled: boolean = false;
  private vectorStore: VectorStore | null = null;
  private ftsEnabled: boolean = false;

  private constructor(config: SQLiteStoreConfig = {}) {
    this.config = {
      dbPath: config.dbPath || join(process.cwd(), '.context', 'c4a.db'),
      readonly: config.readonly || false,
      busyTimeout: config.busyTimeout || 5000,
    };

    // 确保目录存在
    const dbDir = dirname(this.config.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // 初始化数据库
    const dbOptions = this.config.readonly ? { readonly: true } : { create: true };
    this.db = new Database(this.config.dbPath, dbOptions);

    // 配置并发访问参数 (设计文档 §1.2)
    this.configureConcurrency();

    // 探测 FTS5 可用性
    this.ftsEnabled = this.probeFTS5();

    // 初始化向量索引（USearch）
    this.initVectorStore();

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
    this.db.exec('PRAGMA journal_mode = WAL;');

    // 设置忙等待超时（毫秒）
    // 当数据库被锁定时，等待而非立即失败
    this.db.exec(`PRAGMA busy_timeout = ${this.config.busyTimeout};`);

    // 同步模式设置为 NORMAL（平衡性能和安全性）
    this.db.exec('PRAGMA synchronous = NORMAL;');
  }

  /**
   * 探测 FTS5 可用性（只读模式下仅检查表是否存在）
   */
  private probeFTS5(): boolean {
    if (this.config.readonly) {
      try {
        const row = this.db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entities_fts'`)
          .get();
        return Boolean(row);
      } catch {
        return false;
      }
    }

    try {
      this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_probe USING fts5(content)');
      this.db.exec('DROP TABLE IF EXISTS _fts5_probe');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 创建 FTS5 索引表与触发器
   */
  private createFtsTables(): void {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
          entity_id UNINDEXED,
          source_project UNINDEXED,
          proposal_id UNINDEXED,
          search_text,
          tokenize = 'unicode61'
        );
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS entities_fts_insert AFTER INSERT ON entities
        BEGIN
          INSERT INTO entities_fts(entity_id, source_project, proposal_id, search_text)
          SELECT
            NEW.id,
            NEW.source_project,
            NEW.proposal_id,
            COALESCE(json_extract(NEW.data, '$.name'), '') || ' ' ||
            COALESCE(json_extract(NEW.data, '$.description'), '') || ' ' ||
            COALESCE(json_extract(NEW.data, '$.tags'), '');
        END;
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS entities_fts_update AFTER UPDATE ON entities
        BEGIN
          DELETE FROM entities_fts
          WHERE entity_id = OLD.id
            AND source_project = OLD.source_project
            AND proposal_id = OLD.proposal_id;
          INSERT INTO entities_fts(entity_id, source_project, proposal_id, search_text)
          SELECT
            NEW.id,
            NEW.source_project,
            NEW.proposal_id,
            COALESCE(json_extract(NEW.data, '$.name'), '') || ' ' ||
            COALESCE(json_extract(NEW.data, '$.description'), '') || ' ' ||
            COALESCE(json_extract(NEW.data, '$.tags'), '');
        END;
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS entities_fts_delete AFTER DELETE ON entities
        BEGIN
          DELETE FROM entities_fts
          WHERE entity_id = OLD.id
            AND source_project = OLD.source_project
            AND proposal_id = OLD.proposal_id;
        END;
      `);
    } catch {
      this.ftsEnabled = false;
    }
  }

  /**
   * 初始化向量索引（USearch）
   */
  private initVectorStore(): void {
    try {
      const indexDir = dirname(this.config.dbPath);
      const indexPath = join(indexDir, 'c4a.usearch');
      const keyMapPath = join(indexDir, 'c4a.keymap.json');
      this.vectorStore = new VectorStore({
        dimensions: getEmbeddingDimension(),
        indexPath,
        keyMapPath,
        readonly: this.config.readonly,
      });
      this.vectorSearchEnabled = true;
    } catch {
      // USearch 不可用，降级到全文搜索
      this.vectorSearchEnabled = false;
      this.vectorStore = null;
    }
  }

  /**
   * 检查向量搜索是否可用
   */
  isVectorSearchEnabled(): boolean {
    return this.vectorSearchEnabled && this.vectorStore !== null;
  }

  /**
   * 获取向量索引实例
   */
  getVectorStore(): VectorStore | null {
    return this.vectorStore;
  }

  /**
   * 检查 FTS5 是否可用
   */
  isFtsEnabled(): boolean {
    return this.ftsEnabled;
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
        source_project TEXT NOT NULL DEFAULT '',
        proposal_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        kind TEXT,
        scope TEXT,
        perspective TEXT,
        data TEXT NOT NULL,
        orphaned INTEGER DEFAULT 0,
        orphaned_at TEXT,
        PRIMARY KEY (source_project, id, proposal_id)
      );

      CREATE INDEX IF NOT EXISTS idx_entities_proposal_id ON entities(proposal_id);
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_source_project ON entities(source_project);
      CREATE INDEX IF NOT EXISTS idx_entities_id ON entities(id);
      CREATE INDEX IF NOT EXISTS idx_entities_composite ON entities(source_project, id, proposal_id);
    `);

    try {
      this.db.exec(`ALTER TABLE entities ADD COLUMN orphaned INTEGER DEFAULT 0;`);
    } catch {
      // column already exists
    }

    try {
      this.db.exec(`ALTER TABLE entities ADD COLUMN orphaned_at TEXT;`);
    } catch {
      // column already exists
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entities_orphaned
      ON entities(orphaned)
      WHERE orphaned = 1;
    `);

    // 实体元数据表
    // 设计文档: L108-127
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        entity_id TEXT NOT NULL,
        source_project TEXT NOT NULL DEFAULT '',
        proposal_id TEXT NOT NULL DEFAULT '',
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

    // Workflow 状态表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_states (
        id TEXT PRIMARY KEY,
        workflow_type TEXT NOT NULL,
        current_step INTEGER DEFAULT 0,
        total_steps INTEGER NOT NULL,
        state TEXT DEFAULT 'pending',
        context_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_states_state ON workflow_states(state);
    `);

    // 补偿日志表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS compensation_logs (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL,
        action TEXT NOT NULL,
        rollback_action TEXT NOT NULL,
        params_json TEXT,
        executed INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_compensation_logs_tx ON compensation_logs(transaction_id);
    `);

    // 实体关系表 (无外键约束，支持跨项目引用)
    // 设计文档: L128-148
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL DEFAULT '',
        from_project TEXT NOT NULL DEFAULT '',
        from_id TEXT NOT NULL,
        to_project TEXT NOT NULL DEFAULT '',
        to_id TEXT NOT NULL,
        rel_type TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        properties TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_relations_proposal_id ON relations(proposal_id);
      CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_project, from_id);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_project, to_id);
      CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(rel_type);
    `);

    try {
      this.db.exec(`ALTER TABLE relations ADD COLUMN status TEXT DEFAULT 'active';`);
    } catch {
      // column already exists
    }

    try {
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_unique
          ON relations(proposal_id, from_project, from_id, to_project, to_id, rel_type);
      `);
    } catch {
      // duplicates may exist; ignore to avoid breaking startup
    }

    // 实体变更历史表
    // 设计文档: L166-188
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entity_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id TEXT NOT NULL,
        source_project TEXT NOT NULL DEFAULT '',
        proposal_id TEXT NOT NULL DEFAULT '',
        entity_type TEXT NOT NULL,
        feat_id TEXT NOT NULL DEFAULT '',
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
        checklist_version TEXT,
        workflow_steps TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_feats_status ON feats(status);
    `);

    try {
      this.db.exec(`ALTER TABLE feats ADD COLUMN workflow_steps TEXT;`);
    } catch {
      // column already exists
    }
    try {
      this.db.exec(`ALTER TABLE feats ADD COLUMN checklist_version TEXT;`);
    } catch {
      // column already exists
    }

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

    // 全文搜索索引表（USearch 降级方案）
    // 设计文档: sqlite-schema.md §2.3.2
    if (this.ftsEnabled) {
      this.createFtsTables();
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
        SELECT * FROM entities WHERE proposal_id IS NULL OR proposal_id = ''
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
                WHEN proposal_id IS NULL OR proposal_id = '' THEN 2
                ELSE 3
              END
          ) AS rn
        FROM entities
        WHERE proposal_id = ? OR proposal_id = '' OR proposal_id IS NULL
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
        SELECT * FROM relations
        WHERE (proposal_id IS NULL OR proposal_id = '')
          AND (status IS NULL OR status != 'deleted')
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
                WHEN proposal_id IS NULL OR proposal_id = '' THEN 2
                ELSE 3
              END
          ) AS rn
        FROM relations
        WHERE proposal_id = ? OR proposal_id = '' OR proposal_id IS NULL
      )
      SELECT id, proposal_id, from_project, from_id, to_project, to_id, rel_type, properties, created_at, updated_at
      FROM ranked WHERE rn = 1 AND (status IS NULL OR status != 'deleted')
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
      this.instance.vectorStore?.flush();
      this.instance.db.close();
      this.instance = null;
    }
  }

  /**
   * 关闭数据库连接（实例方法）
   */
  close(): void {
    this.vectorStore?.flush();
    this.db.close();
    if (SQLiteStore.instance === this) {
      SQLiteStore.instance = null;
    }
  }

  /**
   * 获取原生数据库对象 (用于高级操作)
   */
  getDatabase(): Database {
    return this.db;
  }

  /**
   * 批量重建向量索引
   *
   * 设计文档: vector-search.md §3.4
   */
  async rebuildVectorIndex(): Promise<{ total: number; indexed: number; skipped: number }> {
    if (!this.vectorStore || !this.vectorSearchEnabled) {
      return { total: 0, indexed: 0, skipped: 0 };
    }

    const stmt = this.db.prepare(`
      SELECT e.id, e.source_project, e.proposal_id, e.data, m.status
      FROM entities e
      JOIN metadata m ON e.source_project = m.source_project
        AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
      WHERE m.status NOT IN ('archived', 'deprecated')
    `);

    let total = 0;
    let skipped = 0;
    let indexed = 0;

    this.vectorStore.beginBulkUpdate();

    try {
      for (const row of stmt.iterate() as Iterable<{
        id: string;
        source_project: string;
        proposal_id: string | null;
        data: string;
        status: string;
      }>) {
        total += 1;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(row.data) as Record<string, unknown>;
        } catch {
          skipped += 1;
          continue;
        }

        const text = buildSearchText(data);
        if (!text) {
          skipped += 1;
          continue;
        }

        try {
          const embedding = await generateEmbedding(text);
          const proposalId = row.proposal_id === '' ? null : row.proposal_id;
          const key = generateVectorKey(row.source_project ?? '', row.id, proposalId);
          this.vectorStore.add(key, embedding);
          indexed += 1;
        } catch {
          skipped += 1;
        }
      }
    } finally {
      this.vectorStore.endBulkUpdate();
    }

    return {
      total,
      indexed,
      skipped,
    };
  }

}

function buildSearchText(data: Record<string, unknown>): string {
  const tags = Array.isArray(data.tags) ? data.tags.join(' ') : null;
  const parts = [data.name, data.description, data.title, tags].filter(Boolean);
  return parts.join(' ');
}
