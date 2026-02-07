/**
 * Adapter 工厂函数
 *
 * 设计文档: v0.3.0/detailed-design/local-mode/mode-switch.md §5.1
 *
 * 根据配置返回对应的 StorageAdapter 实例：
 * - mode: local → LiteAdapter (SQLite)
 * - mode: server/remote → ServerAdapter (HTTP API)
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { LiteAdapter } from './lite-adapter.js';
import { ServerAdapter } from './server-adapter.js';
import type { LiteAdapterConfig } from './lite-adapter.js';
import type { StorageAdapter } from './adapter.js';
import type { ADRPolicyConfig } from './adapterCrudTypes.js';

// ============================================================
// 配置类型
// ============================================================

/**
 * 存储模式
 */
export type StorageMode = 'local' | 'server' | 'remote';

/**
 * Server 模式配置
 */
export interface ServerConfig {
  url: string;
  mongoUrl?: string;
  neo4jUrl?: string;
  neo4jUser?: string;
  neo4jPassword?: string;
  milvusUrl?: string;
  milvusToken?: string;
  embedding?: {
    provider?: 'ollama' | 'openai' | 'claude' | 'doubao' | 'onnx' | 'pseudo';
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    timeoutMs?: number;
    vectorDim?: number;
  };
  timeout?: number;
  retries?: number;
  retryDelayMs?: number;
  maxConnections?: number;
  headers?: Record<string, string>;
  logRequests?: boolean;
}

/**
 * C4A 配置文件结构
 */
export interface C4AConfig {
  mode?: StorageMode;
  server?: ServerConfig;
  remote?: ServerConfig;
  root_id?: string;
  repo_id?: string;
  embedding?: {
    provider?: 'ollama' | 'openai' | 'claude' | 'doubao' | 'onnx' | 'pseudo';
    model?: string;
    base_url?: string;
    api_key?: string;
    timeout_ms?: number;
    vector_dim?: number;
  };
  adr_policy?: ADRPolicyConfig;
  feat?: {
    concurrent_warning?: boolean;
    auto_notify?: boolean;
  };
  local?: {
    dbPath?: string;
    defaultProject?: string;
    enableVectorSearch?: boolean;
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
  let currentPath = resolve(basePath);
  while (true) {
    for (const configPath of CONFIG_PATHS) {
      const fullPath = join(currentPath, configPath);
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, 'utf-8');
        return parseYaml(content) as C4AConfig;
      }
    }
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  const backendUrl = process.env.C4A_STORAGE_BACKEND_URL;
  if (backendUrl) {
    return {
      mode: 'server',
      server: { url: backendUrl },
    };
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
    repoId?: string | null;
    feat?: {
      concurrent_warning?: boolean;
      auto_notify?: boolean;
    };
  };
  server?: ServerConfig;
  remote?: ServerConfig;
}): string {
  return JSON.stringify({
    mode: params.mode,
    local: {
      dbPath: params.local?.dbPath ?? null,
      defaultProject: params.local?.defaultProject ?? null,
      enableVectorSearch: params.local?.enableVectorSearch ?? null,
      repoId: params.local?.repoId ?? null,
      feat: params.local?.feat
        ? {
            concurrent_warning: params.local.feat.concurrent_warning ?? null,
            auto_notify: params.local.feat.auto_notify ?? null,
          }
        : null,
    },
    server: params.server
      ? {
          url: params.server.url ?? null,
          mongoUrl: params.server.mongoUrl ?? null,
          neo4jUrl: params.server.neo4jUrl ?? null,
          neo4jUser: params.server.neo4jUser ?? null,
          neo4jPassword: params.server.neo4jPassword ?? null,
          milvusUrl: params.server.milvusUrl ?? null,
          milvusToken: params.server.milvusToken ?? null,
          embedding: params.server.embedding
            ? {
                provider: params.server.embedding.provider ?? null,
                model: params.server.embedding.model ?? null,
                baseUrl: params.server.embedding.baseUrl ?? null,
                apiKey: params.server.embedding.apiKey ?? null,
                timeoutMs: params.server.embedding.timeoutMs ?? null,
                vectorDim: params.server.embedding.vectorDim ?? null,
              }
            : null,
          timeout: params.server.timeout ?? null,
          retries: params.server.retries ?? null,
          retryDelayMs: params.server.retryDelayMs ?? null,
          maxConnections: params.server.maxConnections ?? null,
          headers: params.server.headers ?? null,
          logRequests: params.server.logRequests ?? null,
        }
      : null,
    remote: params.remote
      ? {
          url: params.remote.url ?? null,
          mongoUrl: params.remote.mongoUrl ?? null,
          neo4jUrl: params.remote.neo4jUrl ?? null,
          neo4jUser: params.remote.neo4jUser ?? null,
          neo4jPassword: params.remote.neo4jPassword ?? null,
          milvusUrl: params.remote.milvusUrl ?? null,
          milvusToken: params.remote.milvusToken ?? null,
          embedding: params.remote.embedding
            ? {
                provider: params.remote.embedding.provider ?? null,
                model: params.remote.embedding.model ?? null,
                baseUrl: params.remote.embedding.baseUrl ?? null,
                apiKey: params.remote.embedding.apiKey ?? null,
                timeoutMs: params.remote.embedding.timeoutMs ?? null,
                vectorDim: params.remote.embedding.vectorDim ?? null,
              }
            : null,
          timeout: params.remote.timeout ?? null,
          retries: params.remote.retries ?? null,
          retryDelayMs: params.remote.retryDelayMs ?? null,
          maxConnections: params.remote.maxConnections ?? null,
          headers: params.remote.headers ?? null,
          logRequests: params.remote.logRequests ?? null,
        }
      : null,
  });
}

/**
 * 获取 StorageAdapter 实例
 *
 * 根据配置文件中的 mode 返回对应的 Adapter：
 * - local: LiteAdapter (SQLite)
 * - server/remote: ServerAdapter (HTTP API)
 *
 * @param options - 可选配置覆盖
 * @returns StorageAdapter 实例
 */
export async function getAdapter(options?: {
  basePath?: string;
  forceMode?: StorageMode;
  config?: Partial<LiteAdapterConfig>;
}): Promise<StorageAdapter> {
  const config = loadConfig(options?.basePath);
  const mode = options?.forceMode || config.mode || 'local';
  if (mode !== 'local' && mode !== 'server' && mode !== 'remote') {
    throw new Error(`Unknown mode: ${mode}`);
  }
  const featConfig = {
    concurrent_warning:
      options?.config?.feat?.concurrent_warning ?? config.feat?.concurrent_warning,
    auto_notify: options?.config?.feat?.auto_notify ?? config.feat?.auto_notify,
  };
  const localConfig = {
    dbPath: config.local?.dbPath || options?.config?.dbPath,
    defaultProject:
      options?.config?.defaultProject ||
      config.local?.defaultProject ||
      config.root_id,
    enableVectorSearch:
      options?.config?.enableVectorSearch ?? config.local?.enableVectorSearch,
    repoId: options?.config?.repoId ?? config.repo_id ?? null,
    feat: featConfig,
  };
  const configKey = buildAdapterConfigKey({
    mode,
    local: localConfig,
    server: mergeEmbeddingConfig(config.server, config.embedding),
    remote: mergeEmbeddingConfig(config.remote, config.embedding),
  });

  // 如果配置改变，需要重新创建实例
  if (adapterInstance && currentConfigKey !== configKey) {
    await adapterInstance.close().catch(() => {});
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
      const serverConfig = mode === 'server' ? config.server : config.remote;
      const mergedServerConfig = mergeEmbeddingConfig(serverConfig, config.embedding);
      const modeLabel = mode === 'server' ? 'server' : 'remote';
      if (!mergedServerConfig?.url) {
        throw new Error(`${modeLabel} mode requires ${modeLabel}.url in .context/.c4a.yaml`);
      }
      adapterInstance = new ServerAdapter(mergedServerConfig);
    }
  }

  try {
    await adapterInstance.initialize();
  } catch (error) {
    adapterInstance = null;
    currentMode = null;
    currentConfigKey = null;
    throw error;
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
  return currentMode === 'server' || currentMode === 'remote';
}

function mergeEmbeddingConfig(
  server: ServerConfig | undefined,
  embedding: C4AConfig['embedding'] | undefined
): ServerConfig | undefined {
  if (!server) return server;
  if (!embedding) return server;
  if (server.embedding) return server;
  return {
    ...server,
    embedding: {
      provider: embedding.provider,
      model: embedding.model,
      baseUrl: embedding.base_url,
      apiKey: embedding.api_key,
      timeoutMs: embedding.timeout_ms,
      vectorDim: embedding.vector_dim,
    },
  };
}
