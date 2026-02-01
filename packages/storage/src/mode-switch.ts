/**
 * 模式切换模块
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/mode-switch.md §5.2
 */

export { LocalBackup, migrateLocalToServer } from './modeSwitchBackup.js';
export { LocalRestore, migrateServerToLocal } from './modeSwitchRestore.js';
export { formatConflictSummary } from './modeSwitchSummary.js';
export type {
  ConflictPolicy,
  PermissionPolicy,
  BackupOptions,
  RestoreOptions,
  BackupResult,
  RestoreResult,
  ConflictSummary,
  MigrateOptions,
  MigrateResult,
  MigrateProgress,
  MigrationCheckpoint,
  PermissionCheckResult,
  PermissionChecker,
  MigrateFailure,
  MigrateStats,
} from './modeSwitchTypes.js';
export { MigrationError } from './modeSwitchErrors.js';
