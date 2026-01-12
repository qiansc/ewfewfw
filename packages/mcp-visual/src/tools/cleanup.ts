/**
 * 临时文件清理工具
 */
import { cleanupTempFiles, getStorageStats } from "../storage/storage-manager.js";

export interface CleanupInput {
  older_than_hours?: number;
}

export interface CleanupResult {
  success: boolean;
  deleted: number;
  errors: string[];
  message: string;
}

export interface StorageStatsResult {
  success: boolean;
  stats: {
    cache: { count: number; size: number; size_readable: string };
    permanent: { count: number; size: number; size_readable: string };
    report: { count: number; size: number; size_readable: string };
    total: { count: number; size: number; size_readable: string };
  };
}

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * 清理过期的临时文件
 */
export async function cleanupHandler(input: CleanupInput): Promise<CleanupResult> {
  const olderThanHours = input.older_than_hours ?? 24;

  const result = await cleanupTempFiles(olderThanHours);

  return {
    success: result.errors.length === 0,
    deleted: result.deleted,
    errors: result.errors,
    message: result.deleted > 0
      ? `成功清理 ${result.deleted} 个过期文件（超过 ${olderThanHours} 小时）`
      : `没有需要清理的文件（阈值：${olderThanHours} 小时）`,
  };
}

/**
 * 获取存储统计信息
 */
export async function storageStatsHandler(): Promise<StorageStatsResult> {
  const stats = await getStorageStats();

  const total = {
    count: stats.cache.count + stats.permanent.count + stats.report.count,
    size: stats.cache.size + stats.permanent.size + stats.report.size,
  };

  return {
    success: true,
    stats: {
      cache: {
        ...stats.cache,
        size_readable: formatSize(stats.cache.size),
      },
      permanent: {
        ...stats.permanent,
        size_readable: formatSize(stats.permanent.size),
      },
      report: {
        ...stats.report,
        size_readable: formatSize(stats.report.size),
      },
      total: {
        ...total,
        size_readable: formatSize(total.size),
      },
    },
  };
}
