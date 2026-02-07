/**
 * C4A 配置管理
 *
 * 用于加载和保存项目配置
 * 基于 v0.3.0 架构设计：.context/.c4a.yaml
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseYAML, stringifyYAML } from './yaml.js';
import { CONTEXT_ROOT_DIR, CONFIG_FILENAME } from './path.js';

// ============================================================================
// 配置类型
// ============================================================================

/** 运行模式 */
export type C4AMode = 'local' | 'server' | 'remote';

/** ADR 缺失时的行为 */
export type ADROnMissing = 'error' | 'warning' | 'ignore';

/** Skills 配置 */
export interface SkillsConfig {
  cursor?: boolean;
  claude?: boolean;
  opencode?: boolean;
}

/** ADR 策略配置 */
export interface ADRPolicyConfig {
  /** 是否强制要求 ADR */
  enforce?: boolean;
  /** 哪些实体类型需要 ADR */
  scope?: Array<'system' | 'container' | 'component'>;
  /** 缺少 ADR 时的行为 */
  on_missing?: ADROnMissing;
}

/**
 * C4A 项目配置（.context/.c4a.yaml）
 */
export interface C4AConfig {
  /** 包边界标识 */
  root_id?: string;

  /** 当前工作版本 */
  version?: string;

  /** 运行模式 */
  mode?: C4AMode;

  /** Skills 配置 */
  skills?: SkillsConfig;

  /** ADR 策略配置 */
  adr_policy?: ADRPolicyConfig;

  /** Server 模式配置 */
  server?: {
    url?: string;
  };

  /** Remote 模式配置 */
  remote?: {
    url?: string;
  };
}

/** 默认配置 */
const DEFAULT_CONFIG: C4AConfig = {
  mode: 'local',
};

// ============================================================================
// 配置加载
// ============================================================================

/**
 * 获取配置文件完整路径
 */
function getConfigFilePath(projectRoot: string): string {
  return join(projectRoot, CONTEXT_ROOT_DIR, CONFIG_FILENAME);
}

/**
 * 加载配置文件
 */
export async function loadConfig(projectRoot?: string): Promise<C4AConfig> {
  const root = projectRoot || process.cwd();
  const configPath = getConfigFilePath(root);

  try {
    const content = await readFile(configPath, 'utf-8');
    const config = parseYAML<C4AConfig>(content);
    return mergeConfig(DEFAULT_CONFIG, config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { ...DEFAULT_CONFIG };
    }
    throw error;
  }
}

/**
 * 保存配置文件
 */
export async function saveConfig(config: C4AConfig, projectRoot?: string): Promise<void> {
  const root = projectRoot || process.cwd();
  const configPath = getConfigFilePath(root);
  const content = stringifyYAML(config);
  await writeFile(configPath, content, 'utf-8');
}

// ============================================================================
// 配置工具函数
// ============================================================================

/**
 * 深度合并配置
 */
function mergeConfig(base: C4AConfig, override: C4AConfig): C4AConfig {
  return {
    ...base,
    ...override,
    skills: { ...base.skills, ...override.skills },
    adr_policy: { ...base.adr_policy, ...override.adr_policy },
    server: { ...base.server, ...override.server },
    remote: { ...base.remote, ...override.remote },
  };
}

/**
 * 验证配置
 */
export function validateConfig(config: C4AConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (config.mode) {
    const validModes: C4AMode[] = ['local', 'server', 'remote'];
    if (!validModes.includes(config.mode)) {
      errors.push(`Invalid mode: ${config.mode}`);
    }
  }

  if (config.mode === 'server' && !config.server?.url) {
    errors.push('Server mode requires server.url');
  }

  if (config.mode === 'remote' && !config.remote?.url) {
    errors.push('Remote mode requires remote.url');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 获取默认配置
 */
export function getDefaultConfig(): C4AConfig {
  return { ...DEFAULT_CONFIG };
}
