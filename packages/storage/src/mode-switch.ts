/**
 * 模式切换模块
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/mode-switch.md §5.2
 */

export { LocalBackup } from './modeSwitchBackup.js';
export { LocalRestore } from './modeSwitchRestore.js';
export { formatConflictSummary } from './modeSwitchSummary.js';
export type {
  ConflictPolicy,
  BackupOptions,
  RestoreOptions,
  BackupResult,
  RestoreResult,
  ConflictSummary,
} from './modeSwitchTypes.js';
