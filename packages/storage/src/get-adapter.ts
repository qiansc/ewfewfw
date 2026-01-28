/**
 * Adapter 工厂函数
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/mode-switch.md §5.1
 *
 * 根据配置返回对应的 StorageAdapter 实例：
 * - mode: local → LiteAdapter (SQLite)
 * - mode: server → ServerAdapter (HTTP API)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { LiteAdapter } from './lite-adapter.js';
import { ServerAdapter } from './server-adapter.js';
import type { LiteAdapterConfig } from './lite-adapter.js';
import type { StorageAdapter } from './adapter.js';

// ============================================================
// 配置类型
// ============================================================

/**
 * 存储模式
 */
export type StorageMode = 'local' | 'server';

/**
 * Server 模式配置
 */
export interface ServerConfig {
  url: string;
  timeout?: number;
}

/**
 * C4A 配置文件结构
 */
export interface C4AConfig {
  mode?: StorageMode;
  server?: ServerConfig;
  local?: {
    dbPath?: string;
  };
}

// ============================================================
// 配置加载
// ============================================================

/**
 * 默认配置文件路径
 */
const CONFIG_PATHS = [
  '.context/.c4a.yaml',
];

/**
 * 加载 C4A 配置
 */
export function loadConfig(basePath: string = process.cwd()): C4AConfig {
  for (const configPath of CONFIG_PATHS) {
    const fullPath = join(basePath, configPath);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8');
      return parseYaml(content) as C4AConfig;
    }
  }

  // 默认配置
  return { mode: 'local' };
}

// ============================================================
// Adapter 单例管理
// ============================================================

let adapterInstance: StorageAdapter | null = null;
let currentMode: StorageMode | null = null;
let currentConfigKey: string | null = null;

function buildAdapterConfigKey(params: {
  mode: StorageMode;
  local?: {
    dbPath?: string;
    defaultProject?: string;
    enableVectorSearch?: boolean;
  };
  server?: ServerConfig;
}): string {
  return JSON.stringify({
    mode: params.mode,
    local: {
      dbPath: params.local?.dbPath ?? null,
      defaultProject: params.local?.defaultProject ?? null,
      enableVectorSearch: params.local?.enableVectorSearch ?? null,
    },
    server: params.server
      ? {
          url: params.server.url ?? null,
          timeout: params.server.timeout ?? null,
        }
      : null,
  });
}

/**
 * 获取 StorageAdapter 实例
 *
 * 根据配置文件中的 mode 返回对应的 Adapter：
 * - local: LiteAdapter (SQLite)
 * - server: ServerAdapter (HTTP API，暂未实现)
 *
 * @param options - 可选配置覆盖
 * @returns StorageAdapter 实例
 */
export function getAdapter(options?: {
  basePath?: string;
  forceMode?: StorageMode;
  config?: Partial<LiteAdapterConfig>;
}): StorageAdapter {
  const config = loadConfig(options?.basePath);
  const mode = options?.forceMode || config.mode || 'local';
  const localConfig = {
    dbPath: config.local?.dbPath || options?.config?.dbPath,
    defaultProject: options?.config?.defaultProject,
    enableVectorSearch: options?.config?.enableVectorSearch,
  };
  const configKey = buildAdapterConfigKey({
    mode,
    local: localConfig,
    server: config.server,
  });

  // 如果配置改变，需要重新创建实例
  if (adapterInstance && currentConfigKey !== configKey) {
    adapterInstance.close().catch(() => {});
    adapterInstance = null;
    currentMode = null;
    currentConfigKey = null;
  }

  if (!adapterInstance) {
    currentMode = mode;
    currentConfigKey = configKey;

    if (mode === 'local') {
      adapterInstance = new LiteAdapter(localConfig);
    } else {
      const serverConfig = config.server;
      if (!serverConfig?.url) {
        throw new Error('Server mode requires server.url in .context/.c4a.yaml');
      }
      adapterInstance = new ServerAdapter(serverConfig);
    }
  }

  return adapterInstance;
}

/**
 * 重置 Adapter 实例（用于测试）
 */
export function resetAdapter(): void {
  if (adapterInstance) {
    adapterInstance.close().catch(() => {});
  }
  adapterInstance = null;
  currentMode = null;
  currentConfigKey = null;
}

/**
 * 获取当前存储模式
 */
export function getCurrentMode(): StorageMode | null {
  return currentMode;
}

/**
 * 检查是否为 Local 模式
 */
export function isLocalMode(): boolean {
  return currentMode === 'local';
}

/**
 * 检查是否为 Server 模式
 */
export function isServerMode(): boolean {
  return currentMode === 'server';
}
