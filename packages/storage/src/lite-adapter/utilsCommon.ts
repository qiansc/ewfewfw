import { createHash } from 'node:crypto';

/**
 * 计算校验和
 */
export function computeChecksum(data: string): string {
  return 'sha256:' + createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * 版本兼容性检查
 */
export function checkCompatibility(backupVersion: string, currentVersion: string): boolean {
  const [backupMajor, backupMinor] = backupVersion.split('.').map(Number);
  const [currentMajor, currentMinor] = currentVersion.split('.').map(Number);

  // 主版本号必须相同
  if (backupMajor !== currentMajor) {
    return false;
  }

  // 次版本号向后兼容
  if (backupMinor > currentMinor) {
    return false;
  }

  return true;
}
