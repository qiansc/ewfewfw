/**
 * C4A 日期工具
 *
 * 用于日期时间的格式化和解析
 */

// ============================================================================
// 日期格式常量
// ============================================================================

/** ISO 8601 日期时间格式 */
export const ISO_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSSZ';

/** 简短日期格式 */
export const DATE_FORMAT = 'YYYY-MM-DD';

/** 简短时间格式 */
export const TIME_FORMAT = 'HH:mm:ss';

// ============================================================================
// 日期获取
// ============================================================================

/**
 * 获取当前时间的 ISO 字符串
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * 获取当前日期（不含时间）
 */
export function today(): string {
  return new Date().toISOString().split('T')[0];
}

// ============================================================================
// 日期解析
// ============================================================================

/**
 * 解析日期字符串为 Date 对象
 */
export function parseDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/**
 * 检查日期字符串是否有效
 */
export function isValidDate(dateStr: string): boolean {
  return parseDate(dateStr) !== null;
}

// ============================================================================
// 日期格式化
// ============================================================================

/**
 * 格式化日期为 ISO 字符串
 */
export function formatDate(date: Date | string): string {
  if (typeof date === 'string') {
    const parsed = parseDate(date);
    if (!parsed) return date;
    return parsed.toISOString();
  }
  return date.toISOString();
}

/**
 * 格式化日期为简短格式 (YYYY-MM-DD)
 */
export function formatDateShort(date: Date | string): string {
  const iso = formatDate(date);
  return iso.split('T')[0];
}

/**
 * 格式化为相对时间描述
 */
export function formatRelative(date: Date | string): string {
  const d = typeof date === 'string' ? parseDate(date) : date;
  if (!d) return 'unknown';

  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;

  return formatDateShort(d);
}
