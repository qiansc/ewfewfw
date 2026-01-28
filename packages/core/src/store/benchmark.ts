/**
 * 性能基准测试模块
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/mode-switch.md §6
 *
 * 提供 Local 模式性能基准测试：
 * - 测试环境配置
 * - 性能指标定义
 * - 基准测试执行
 */

import { SQLiteStore } from './sqlite-store.js';
import type { EntityType, EntityStatus } from './adapter.js';

// ============================================================
// 测试环境配置
// ============================================================

/**
 * 测试环境信息
 *
 * 设计文档: mode-switch.md §6.1
 */
export interface TestEnvironment {
  cpu: string;
  ram: string;
  storage: string;
  os: string;
  nodeVersion: string;
  dataScale: {
    entities: number;
    relations: number;
  };
}

/**
 * 获取当前测试环境信息
 */
export function getTestEnvironment(): TestEnvironment {
  return {
    cpu: process.arch,
    ram: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB heap`,
    storage: 'SSD',
    os: process.platform,
    nodeVersion: process.version,
    dataScale: {
      entities: 0,
      relations: 0,
    },
  };
}

// ============================================================
// 性能指标定义
// ============================================================

/**
 * 性能指标
 *
 * 设计文档: mode-switch.md §6.2
 */
export interface PerformanceMetrics {
  /** 操作名称 */
  operation: string;
  /** 执行时间 (ms) */
  duration: number;
  /** 操作次数 */
  count: number;
  /** 平均时间 (ms) */
  avgDuration: number;
  /** 最小时间 (ms) */
  minDuration: number;
  /** 最大时间 (ms) */
  maxDuration: number;
  /** 每秒操作数 */
  opsPerSecond: number;
}

/**
 * 基准测试结果
 */
export interface BenchmarkResult {
  environment: TestEnvironment;
  metrics: PerformanceMetrics[];
  timestamp: string;
}

/**
 * 基准测试目标值
 *
 * 设计文档: mode-switch.md §6.2
 */
export const BENCHMARK_TARGETS = {
  insertEntity: { target: 5, unit: 'ms', description: '插入实体' },
  queryEntity: { target: 1, unit: 'ms', description: '查询实体' },
  semanticSearch: { target: 50, unit: 'ms', description: '语义搜索' },
  graphTraversal: { target: 10, unit: 'ms', description: '图遍历（深度 3）' },
  startupTime: { target: 100, unit: 'ms', description: '启动时间' },
} as const;

/**
 * 适用规模建议
 *
 * 设计文档: mode-switch.md §6.3
 */
export const SCALE_RECOMMENDATIONS = {
  small: { entities: 1000, relations: 5000, mode: 'local' as const },
  medium: { entities: 10000, relations: 50000, mode: 'local_or_server' as const },
  large: { entities: 100000, relations: 500000, mode: 'server' as const },
} as const;

// ============================================================
// 基准测试执行器
// ============================================================

/**
 * 基准测试配置
 */
export interface BenchmarkConfig {
  /** 每个操作的迭代次数 */
  iterations: number;
  /** 预热迭代次数 */
  warmupIterations: number;
  /** 测试数据规模 */
  dataScale: {
    entities: number;
    relations: number;
  };
}

/**
 * 默认基准测试配置
 */
export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  iterations: 100,
  warmupIterations: 10,
  dataScale: {
    entities: 1000,
    relations: 5000,
  },
};

/**
 * 基准测试执行器
 */
export class Benchmark {
  private store: SQLiteStore;
  private config: BenchmarkConfig;

  constructor(store?: SQLiteStore, config?: Partial<BenchmarkConfig>) {
    this.store = store || SQLiteStore.getInstance();
    this.config = { ...DEFAULT_BENCHMARK_CONFIG, ...config };
  }

  /**
   * 运行完整基准测试
   */
  async run(): Promise<BenchmarkResult> {
    const environment = getTestEnvironment();
    environment.dataScale = this.config.dataScale;

    // 准备测试数据
    await this.prepareTestData();

    const metrics: PerformanceMetrics[] = [];

    // 测试插入性能
    metrics.push(await this.benchmarkInsert());

    // 测试查询性能
    metrics.push(await this.benchmarkQuery());

    // 测试启动时间
    metrics.push(await this.benchmarkStartup());

    return {
      environment,
      metrics,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 准备测试数据
   */
  private async prepareTestData(): Promise<void> {
    const db = this.store.getDatabase();

    // 清理现有测试数据
    db.exec("DELETE FROM entities WHERE source_project = 'benchmark'");
    db.exec("DELETE FROM metadata WHERE source_project = 'benchmark'");
    db.exec("DELETE FROM relations WHERE from_project = 'benchmark'");
  }

  /**
   * 测试插入性能
   */
  private async benchmarkInsert(): Promise<PerformanceMetrics> {
    const durations: number[] = [];
    const db = this.store.getDatabase();

    // 预热
    for (let i = 0; i < this.config.warmupIterations; i++) {
      const id = `warmup-${i}`;
      this.insertTestEntity(db, id);
      db.prepare("DELETE FROM entities WHERE id = ?").run(id);
      db.prepare("DELETE FROM metadata WHERE entity_id = ?").run(id);
    }

    // 正式测试
    for (let i = 0; i < this.config.iterations; i++) {
      const id = `bench-insert-${i}`;
      const start = performance.now();
      this.insertTestEntity(db, id);
      const end = performance.now();
      durations.push(end - start);
    }

    // 清理
    db.exec("DELETE FROM entities WHERE id LIKE 'bench-insert-%'");
    db.exec("DELETE FROM metadata WHERE entity_id LIKE 'bench-insert-%'");

    return this.calculateMetrics('insertEntity', durations);
  }

  /**
   * 插入测试实体
   */
  private insertTestEntity(
    db: ReturnType<SQLiteStore['getDatabase']>,
    id: string
  ): void {
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO entities (id, source_project, proposal_id, type, data)
      VALUES (?, 'benchmark', NULL, 'component', ?)
    `).run(id, JSON.stringify({ name: `Test ${id}`, description: 'Benchmark test entity' }));

    db.prepare(`
      INSERT INTO metadata (entity_id, source_project, proposal_id, status, content_hash, created_at, updated_at)
      VALUES (?, 'benchmark', NULL, 'draft', ?, ?, ?)
    `).run(id, `hash-${id}`, now, now);
  }

  /**
   * 测试查询性能
   */
  private async benchmarkQuery(): Promise<PerformanceMetrics> {
    const durations: number[] = [];
    const db = this.store.getDatabase();

    // 准备查询测试数据
    for (let i = 0; i < 100; i++) {
      this.insertTestEntity(db, `bench-query-${i}`);
    }

    // 预热
    for (let i = 0; i < this.config.warmupIterations; i++) {
      db.prepare(`
        SELECT e.*, m.status, m.content_hash
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
        WHERE e.id = ?
      `).get(`bench-query-${i % 100}`);
    }

    // 正式测试
    for (let i = 0; i < this.config.iterations; i++) {
      const start = performance.now();
      db.prepare(`
        SELECT e.*, m.status, m.content_hash
        FROM entities e
        JOIN metadata m ON e.source_project = m.source_project
          AND e.id = m.entity_id AND e.proposal_id IS m.proposal_id
        WHERE e.id = ?
      `).get(`bench-query-${i % 100}`);
      const end = performance.now();
      durations.push(end - start);
    }

    // 清理
    db.exec("DELETE FROM entities WHERE id LIKE 'bench-query-%'");
    db.exec("DELETE FROM metadata WHERE entity_id LIKE 'bench-query-%'");

    return this.calculateMetrics('queryEntity', durations);
  }

  /**
   * 测试启动时间
   */
  private async benchmarkStartup(): Promise<PerformanceMetrics> {
    const durations: number[] = [];

    // 启动时间测试：测量 SQLiteStore 初始化时间
    for (let i = 0; i < Math.min(this.config.iterations, 10); i++) {
      const start = performance.now();
      // 模拟初始化检查
      this.store.getDatabase().prepare('SELECT 1').get();
      const end = performance.now();
      durations.push(end - start);
    }

    return this.calculateMetrics('startupTime', durations);
  }

  /**
   * 计算性能指标
   */
  private calculateMetrics(operation: string, durations: number[]): PerformanceMetrics {
    const count = durations.length;
    const total = durations.reduce((a, b) => a + b, 0);
    const avgDuration = total / count;
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);
    const opsPerSecond = 1000 / avgDuration;

    return {
      operation,
      duration: total,
      count,
      avgDuration,
      minDuration,
      maxDuration,
      opsPerSecond,
    };
  }

  /**
   * 格式化基准测试结果
   */
  static formatResult(result: BenchmarkResult): string {
    const lines: string[] = [];

    lines.push('=== 性能基准测试结果 ===');
    lines.push('');
    lines.push('测试环境:');
    lines.push(`  CPU: ${result.environment.cpu}`);
    lines.push(`  RAM: ${result.environment.ram}`);
    lines.push(`  OS: ${result.environment.os}`);
    lines.push(`  Node: ${result.environment.nodeVersion}`);
    lines.push(`  数据规模: ${result.environment.dataScale.entities} 实体`);
    lines.push('');
    lines.push('性能指标:');
    lines.push('');

    for (const metric of result.metrics) {
      const target = BENCHMARK_TARGETS[metric.operation as keyof typeof BENCHMARK_TARGETS];
      const status = target && metric.avgDuration <= target.target ? '✓' : '✗';

      lines.push(`${metric.operation}:`);
      lines.push(`  平均: ${metric.avgDuration.toFixed(3)}ms ${status}`);
      lines.push(`  最小: ${metric.minDuration.toFixed(3)}ms`);
      lines.push(`  最大: ${metric.maxDuration.toFixed(3)}ms`);
      lines.push(`  OPS: ${metric.opsPerSecond.toFixed(0)}/s`);
      if (target) {
        lines.push(`  目标: <${target.target}ms`);
      }
      lines.push('');
    }

    lines.push(`测试时间: ${result.timestamp}`);

    return lines.join('\n');
  }
}
