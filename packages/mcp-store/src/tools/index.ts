/**
 * Store 工具导出
 */
export { storeSaveHandler } from "./save.js";
export { storeReadHandler } from "./read.js";
export { storeListHandler } from "./list.js";
export { storeDeleteHandler } from "./delete.js";
export {
  storeAddVersionHandler,
  storeRemoveVersionHandler,
  storePublishVersionHandler,
} from "./version.js";
export { storeSyncHandler, storeSyncStatusHandler } from "./sync.js";
export { storePlanSyncHandler } from "./planSync.js";
export { storeReadHistoryHandler } from "./readHistory.js";
export { storeBackupHandler } from "./backup.js";
export { storeRestoreHandler } from "./restore.js";
export { storeRepairHandler } from "./repair.js";
export { storeValidateHandler } from "./validate.js";

// Double Check 机制（CLI 本地文件写入保护）
export {
  executeWriteAction,
  executeBatchWriteActions,
  computeHash,
  getFileHash,
  type WriteAction,
  type WriteResult,
} from "./doubleCheck.js";

// 大批量同步优化（CLI 分批 + 会话管理）
export {
  batchSync,
  resumeSync,
  cancelSync,
  shouldUseBatchSync,
  saveSessionState,
  loadSessionState,
  clearSessionState,
  createHttpClient,
  BATCH_THRESHOLD,
  DEFAULT_BATCH_SIZE,
  type LocalFile,
  type SyncSessionState,
  type BatchSyncOptions,
} from "./batchSync.js";

// 本地文件保护机制（CLI 渲染文件防覆盖）
export {
  parseC4AHeader,
  generateC4AHeader,
  generateProtectedContent,
  extractBody,
  checkBeforeRender,
  safeRenderFile,
  formatCheckError,
  type C4AFileHeader,
  type CheckBeforeRenderResult,
  type SafeRenderResult,
} from "./fileProtection.js";
