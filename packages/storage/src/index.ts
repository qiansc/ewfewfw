/**
 * Store 模块 - Local 模式存储实现
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/
 */

// Adapter 层
export { LiteAdapter } from './lite-adapter.js';
export { ServerAdapter } from './server-adapter.js';
export type { LiteAdapterConfig } from './lite-adapter.js';
export type * from './adapter.js';

// Adapter 工厂
export {
  getAdapter,
  resetAdapter,
  getCurrentMode,
  isLocalMode,
  isServerMode,
  loadConfig,
} from './get-adapter.js';
export type { StorageMode, ServerConfig, C4AConfig } from './get-adapter.js';

// 模式切换
export { LocalBackup, LocalRestore, formatConflictSummary } from './mode-switch.js';
export type {
  ConflictPolicy,
  BackupOptions,
  RestoreOptions,
  BackupResult,
  RestoreResult,
  ConflictSummary,
} from './mode-switch.js';

// SQLite Store
export { SQLiteStore } from './sqlite-store.js';
export type { SQLiteStoreConfig } from './sqlite-store.js';

export {
  generateEmbedding,
  semanticSearch,
  generateVectorKey,
  parseVectorKey,
  initEmbedder,
  isEmbedderReady,
  getEmbeddingDimension,
} from './vector-search.js';
export type { VectorSearchResult } from './vector-search.js';

export { WriteQueue, getWriteQueue, resetWriteQueue } from './write-queue.js';
export type { WriteQueueConfig, WriteQueueStatus } from './write-queue.js';

export { InMemoryGraph } from './in-memory-graph.js';
export type { DependencyResult } from './in-memory-graph.js';

export { GraphQueryCache } from './graph-query-cache.js';

// 性能基准测试
export {
  Benchmark,
  getTestEnvironment,
  BENCHMARK_TARGETS,
  SCALE_RECOMMENDATIONS,
  DEFAULT_BENCHMARK_CONFIG,
} from './benchmark.js';
export type {
  TestEnvironment,
  PerformanceMetrics,
  BenchmarkResult,
  BenchmarkConfig,
} from './benchmark.js';

// 数据验证
export { DataValidator, MIGRATE_ERROR_CODES } from './validate.js';
export type {
  ValidationIssue,
  ValidationResult,
  ValidateOptions,
  MigrateErrorCode,
} from './validate.js';

// 数据修复
export { DataRepair } from './repair.js';
export type {
  RepairConfig,
  RepairOptions,
  RepairAction,
  RepairResult,
} from './repair.js';
