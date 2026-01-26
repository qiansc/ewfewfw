/**
 * C4A 路径工具
 *
 * 用于生成和解析 DSL 文件路径
 * 基于 v0.3.0 架构设计：.context/ + business/technical/feat 双视角结构
 */

import type { EntityType } from '../types/base';

// ============================================================================
// 路径常量
// ============================================================================

/** 工作目录名 */
export const CONTEXT_ROOT_DIR = '.context';

/** 配置文件名 */
export const CONFIG_FILENAME = '.c4a.yaml';

/** DSL 文件扩展名 */
export const DSL_EXTENSION = '.c4a.yaml';

/** 视角类型 */
export type Perspective = 'business' | 'technical';

/** 业务视角实体类型 */
export const BUSINESS_TYPES = ['product', 'process', 'sor'] as const;
export type BusinessEntityType = (typeof BUSINESS_TYPES)[number];

/** 技术视角实体类型 */
export const TECHNICAL_TYPES = ['system', 'container', 'component', 'adr', 'contract', 'process', 'sor'] as const;
export type TechnicalEntityType = (typeof TECHNICAL_TYPES)[number];

/** 实体类型到目录名映射 */
export const TYPE_TO_DIR: Record<string, string> = {
  product: 'products',
  system: 'systems',
  container: 'containers',
  component: 'components',
  adr: 'adrs',
  contract: 'contracts',
  process: 'processes',
  sor: 'sors',
  feat: 'feat',
};

// ============================================================================
// 路径生成
// ============================================================================

/**
 * 判断实体类型的视角
 */
export function getPerspective(type: EntityType): Perspective | null {
  if (type === 'product') return 'business';
  if (['system', 'container', 'component', 'adr', 'contract'].includes(type)) {
    return 'technical';
  }
  // process 和 sor 需要根据 ID 前缀判断
  return null;
}

/**
 * 根据 ID 前缀判断 process/sor 的视角
 */
export function getPerspectiveFromId(id: string): Perspective | null {
  if (id.startsWith('prc-b-') || id.startsWith('sor-b-')) return 'business';
  if (id.startsWith('prc-t-') || id.startsWith('sor-t-')) return 'technical';
  return null;
}

/**
 * 获取实体的 DSL 文件路径
 */
export function getEntityPath(
  id: string,
  type: EntityType,
  options?: {
    featId?: string;
    perspective?: Perspective;
  },
): string {
  const typeDir = TYPE_TO_DIR[type] || type;
  const filename = `${id}${DSL_EXTENSION}`;

  // 确定视角
  let perspective = options?.perspective || getPerspective(type);
  if (!perspective && (type === 'process' || type === 'sor')) {
    perspective = getPerspectiveFromId(id);
  }
  if (!perspective) {
    perspective = 'technical'; // 默认技术视角
  }

  // feat 内实体
  if (options?.featId) {
    return `${CONTEXT_ROOT_DIR}/feat/${options.featId}/${perspective}/${typeDir}/${filename}`;
  }

  // 主分支实体
  return `${CONTEXT_ROOT_DIR}/${perspective}/${typeDir}/${filename}`;
}

/**
 * 获取 feat 元信息文件路径
 */
export function getFeatPath(featId: string): string {
  return `${CONTEXT_ROOT_DIR}/feat/${featId}/feat.yaml`;
}

/**
 * 获取配置文件路径
 */
export function getConfigPath(): string {
  return `${CONTEXT_ROOT_DIR}/${CONFIG_FILENAME}`;
}

/**
 * 获取资源目录路径
 */
export function getAssetsPath(featId?: string): string {
  if (featId) {
    return `${CONTEXT_ROOT_DIR}/feat/${featId}/assets`;
  }
  return `${CONTEXT_ROOT_DIR}/assets`;
}

// ============================================================================
// 路径解析
// ============================================================================

/**
 * 解析后的路径信息
 */
export interface ParsedEntityPath {
  /** 原始路径 */
  raw: string;
  /** 是否有效 */
  valid: boolean;
  /** 实体 ID */
  id: string | null;
  /** 实体类型 */
  type: EntityType | null;
  /** 视角 */
  perspective: Perspective | null;
  /** feat ID（如果在 feat 目录下） */
  featId: string | null;
}

/** 反向映射：目录名 → 类型 */
const DIR_TO_TYPE: Record<string, EntityType> = {
  products: 'product',
  systems: 'system',
  containers: 'container',
  components: 'component',
  adrs: 'adr',
  contracts: 'contract',
  processes: 'process',
  sors: 'sor',
};

/**
 * 解析实体路径
 */
export function parseEntityPath(path: string): ParsedEntityPath {
  const result: ParsedEntityPath = {
    raw: path,
    valid: false,
    id: null,
    type: null,
    perspective: null,
    featId: null,
  };

  if (!path || typeof path !== 'string') {
    return result;
  }

  // 标准化路径分隔符
  const normalizedPath = path.replace(/\\/g, '/');

  // 检查是否以 .context/ 开头
  const contextIndex = normalizedPath.indexOf(`${CONTEXT_ROOT_DIR}/`);
  if (contextIndex === -1) {
    return result;
  }

  // 获取 .context/ 之后的部分
  const relativePath = normalizedPath.slice(contextIndex + CONTEXT_ROOT_DIR.length + 1);
  const parts = relativePath.split('/');

  if (parts.length < 2) {
    return result;
  }

  // 检查文件名
  const filename = parts[parts.length - 1];
  if (!filename.endsWith(DSL_EXTENSION)) {
    return result;
  }

  // 提取 ID
  result.id = filename.slice(0, -DSL_EXTENSION.length);

  // 解析路径结构
  if (parts[0] === 'feat' && parts.length >= 5) {
    // feat 内实体: feat/{feat-id}/{perspective}/{type}/{file}
    result.featId = parts[1];
    result.perspective = parts[2] as Perspective;
    result.type = DIR_TO_TYPE[parts[3]] || null;
  } else if ((parts[0] === 'business' || parts[0] === 'technical') && parts.length >= 3) {
    // 主分支实体: {perspective}/{type}/{file}
    result.perspective = parts[0] as Perspective;
    result.type = DIR_TO_TYPE[parts[1]] || null;
  }

  result.valid = result.id !== null && result.type !== null;
  return result;
}
