/**
 * 配置生成器类型定义
 */

import type { UnifiedConfig, SkillConfig } from "./schema.js";

/**
 * 生成目标平台
 */
export type TargetPlatform = "opencode" | "claude-sdk" | "cursor" | "all";

/**
 * 生成选项
 */
export interface GenerateOptions {
  target?: TargetPlatform;
  configPath?: string;
  outputDir?: string;
  verbose?: boolean;
  dryRun?: boolean;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * 生成结果
 */
export interface GenerateResult {
  success: boolean;
  platform: TargetPlatform;
  outputFiles: string[];
  errors?: string[];
}

/**
 * 配置适配器接口
 */
export interface ConfigAdapter {
  /**
   * 平台名称
   */
  readonly platform: TargetPlatform;

  /**
   * 生成配置文件
   */
  generate(config: UnifiedConfig, options: GenerateOptions): Promise<GenerateResult>;

  /**
   * 验证生成的配置
   */
  validate(outputDir: string): Promise<ValidationResult>;
}

/**
 * Skill 元数据（用于生成）
 */
export interface SkillMetadata {
  name: string;
  description: string;
  category: string;
  args?: string;
  prompt: string;
  tools?: string[];
}

/**
 * 按分类分组的 Skills
 */
export type GroupedSkills = Map<string, Array<[string, SkillConfig]>>;

/**
 * OpenCode Provider 配置
 */
export interface OpencodeProviderOptions {
  baseURL?: string;
  apiKey?: string;
  model?: string;
}

export interface OpencodeProviderConfig {
  options?: OpencodeProviderOptions;
}

/**
 * OpenCode 配置格式
 */
export interface OpencodeConfig {
  $schema?: string;
  provider?: Record<string, OpencodeProviderConfig>;
  instructions: string[];
  mcp: Record<string, OpencodeServerConfig>;
  agent: Record<string, OpencodeAgentConfig>;
  default_agent: string;
}

export interface OpencodeServerConfig {
  type: "local" | "remote";
  command?: string[];  // OpenCode 期望 command 是数组格式 [cmd, arg1, arg2, ...]
  url?: string;
}

export interface OpencodeAgentConfig {
  mode: "primary" | "subagent";
  prompt: string;
  permission?: Record<string, "allow" | "deny">;
  subagents?: string[];
}

/**
 * Claude SDK 配置格式
 */
export interface ClaudeSdkConfig {
  permissions?: {
    allow: string[];
    deny: string[];
  };
  mcpServers: Record<string, ClaudeSdkStdioServerConfig | ClaudeSdkSseServerConfig>;
}

/**
 * Claude SDK stdio 类型 MCP 服务器配置
 */
export interface ClaudeSdkStdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Claude SDK SSE 类型 MCP 服务器配置
 */
export interface ClaudeSdkSseServerConfig {
  type: "sse";
  url: string;
}

/**
 * Cursor 配置格式（纯文本）
 */
export type CursorConfig = string;
