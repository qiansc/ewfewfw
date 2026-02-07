/**
 * C4A ID 工具
 *
 * 用于生成和解析实体 ID
 */

import type { EntityType } from '../types/base.js';

// ============================================================================
// ID 格式常量
// ============================================================================

/** 序号格式正则：三位数字 或 一个小写字母 + 三位数字 */
const SEQUENCE_PATTERN = /^(?:\d{3}|[a-z]\d{3})$/;

/** npm 包名格式（含可选 scope） */
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9-]+\/)?[a-z][a-z0-9-]*$/;

/** kebab-case 格式正则 */
const KEBAB_CASE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** 带序号的 ID 前缀 */
const SEQUENCED_PREFIXES = ['adr', 'prc-b', 'prc-t', 'sor-b', 'sor-t'] as const;

type SequencedPrefix = (typeof SEQUENCED_PREFIXES)[number];

// ============================================================================
// 字符串转换
// ============================================================================

/**
 * 将字符串转换为 kebab-case
 */
export function toKebabCase(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-') // 空格和下划线转连字符
    .replace(/[^a-z0-9-]/g, '') // 移除非法字符
    .replace(/-+/g, '-') // 合并多个连字符
    .replace(/^-|-$/g, ''); // 移除首尾连字符
}

// ============================================================================
// ID 验证
// ============================================================================

/**
 * 验证 kebab-case 格式
 */
export function isValidKebabCase(id: string): boolean {
  return KEBAB_CASE_PATTERN.test(id);
}

/**
 * 验证序号格式
 */
export function isValidSequence(seq: string): boolean {
  return SEQUENCE_PATTERN.test(seq);
}

/**
 * 验证实体 ID 格式
 */
export function isValidEntityId(id: string, type?: EntityType): boolean {
  if (!id || typeof id !== 'string') return false;

  // 根据类型验证
  if (type) {
    switch (type) {
      case 'feat':
        return /^feat-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id);
      case 'adr':
        return /^adr-(?:\d{3}|[a-z]\d{3})(?:-[a-z0-9]+)*$/.test(id);
      case 'process':
        return /^prc-[bt]-(?:\d{3}|[a-z]\d{3})$/.test(id);
      case 'sor':
        return /^sor-[bt]-(?:\d{3}|[a-z]\d{3})$/.test(id);
      default:
        return PACKAGE_NAME_PATTERN.test(id) || isValidKebabCase(id);
    }
  }

  // 通用验证：kebab-case / npm 包名 / 带前缀的序号 ID
  // feat/adr 允许后缀：feat-user-login, adr-001-introduce-mq
  // prc/sor 不允许后缀：prc-b-001, sor-t-001
  return (
    PACKAGE_NAME_PATTERN.test(id) ||
    isValidKebabCase(id) ||
    /^feat-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) ||
    /^adr-(?:\d{3}|[a-z]\d{3})(?:-[a-z0-9]+)*$/.test(id) ||
    /^(prc|sor)-[bt]-(?:\d{3}|[a-z]\d{3})$/.test(id)
  );
}

// ============================================================================
// 序号操作
// ============================================================================

/**
 * 递增序号
 * 001 → 002 → ... → 999 → a001 → ... → a999 → b001 → ... → z999 → 溢出
 */
export function incrementSequence(seq: string): string {
  if (!isValidSequence(seq)) {
    throw new Error(`Invalid sequence format: ${seq}`);
  }

  if (/^\d{3}$/.test(seq)) {
    const num = parseInt(seq, 10);
    if (num < 999) {
      return String(num + 1).padStart(3, '0');
    }
    return 'a001';
  }

  const letter = seq[0];
  const num = parseInt(seq.slice(1), 10);

  if (num < 999) {
    return `${letter}${String(num + 1).padStart(3, '0')}`;
  }

  // 数字溢出，递增字母
  if (letter === 'z') {
    throw new Error('Sequence overflow: reached z999');
  }

  const nextLetter = String.fromCharCode(letter.charCodeAt(0) + 1);
  return `${nextLetter}001`;
}

/**
 * 获取初始序号
 */
export function getInitialSequence(): string {
  return '001';
}

// ============================================================================
// ID 生成
// ============================================================================

/**
 * 生成实体 ID
 * @param type 实体类型
 * @param name 实体名称（用于 kebab-case ID）
 * @param sequence 序号（用于带序号的 ID）
 * @param perspective 视角（用于 process/sor）
 */
export function generateEntityId(
  type: EntityType,
  name: string,
  sequence?: string,
  perspective?: 'business' | 'technical',
): string {
  switch (type) {
    case 'feat':
      return `feat-${toKebabCase(name)}`;

    case 'adr':
      if (!sequence) throw new Error('ADR ID requires sequence');
      return `adr-${sequence}-${toKebabCase(name)}`;

    case 'process':
      if (!sequence) throw new Error('Process ID requires sequence');
      if (!perspective) throw new Error('Process ID requires perspective');
      const prcPrefix = perspective === 'business' ? 'prc-b' : 'prc-t';
      return `${prcPrefix}-${sequence}`;

    case 'sor':
      if (!sequence) throw new Error('SoR ID requires sequence');
      if (!perspective) throw new Error('SoR ID requires perspective');
      const sorPrefix = perspective === 'business' ? 'sor-b' : 'sor-t';
      return `${sorPrefix}-${sequence}`;

    default:
      return toKebabCase(name);
  }
}

// ============================================================================
// ID 解析
// ============================================================================

/**
 * 解析后的实体 ID 信息
 */
export interface ParsedEntityId {
  /** 原始 ID */
  raw: string;
  /** 实体类型 */
  type: EntityType | null;
  /** 序号（如果有） */
  sequence: string | null;
  /** 名称部分（kebab-case） */
  name: string | null;
  /** 视角（process/sor） */
  perspective: 'business' | 'technical' | null;
}

/**
 * 解析实体 ID
 */
export function parseEntityId(id: string): ParsedEntityId {
  const result: ParsedEntityId = {
    raw: id,
    type: null,
    sequence: null,
    name: null,
    perspective: null,
  };

  if (!id || typeof id !== 'string') {
    return result;
  }

  // feat-xxx
  const featMatch = id.match(/^feat-([a-z0-9]+(?:-[a-z0-9]+)*)$/);
  if (featMatch) {
    result.type = 'feat';
    result.name = featMatch[1];
    return result;
  }

  // adr-001-xxx 或 adr-a001-xxx
  const adrMatch = id.match(/^adr-((?:\d{3}|[a-z]\d{3}))(?:-(.+))?$/);
  if (adrMatch) {
    result.type = 'adr';
    result.sequence = adrMatch[1];
    result.name = adrMatch[2] || null;
    return result;
  }

  // prc-b-001 或 prc-t-a001
  const prcMatch = id.match(/^prc-([bt])-((?:\d{3}|[a-z]\d{3}))$/);
  if (prcMatch) {
    result.type = 'process';
    result.perspective = prcMatch[1] === 'b' ? 'business' : 'technical';
    result.sequence = prcMatch[2];
    return result;
  }

  // sor-b-001 或 sor-t-a001
  const sorMatch = id.match(/^sor-([bt])-((?:\d{3}|[a-z]\d{3}))$/);
  if (sorMatch) {
    result.type = 'sor';
    result.perspective = sorMatch[1] === 'b' ? 'business' : 'technical';
    result.sequence = sorMatch[2];
    return result;
  }

  // 普通 ID（kebab-case 或 npm 包名）
  if (isValidKebabCase(id) || PACKAGE_NAME_PATTERN.test(id)) {
    result.name = id;
  }

  return result;
}
