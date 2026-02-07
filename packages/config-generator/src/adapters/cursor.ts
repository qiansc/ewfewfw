/**
 * Cursor 适配器
 *
 * 生成两个配置文件：
 * 1. .cursor/mcp.json - MCP Server 配置（智能合并，保留用户自定义配置）
 * 2. .cursorrules - Agent 规则说明（标记块更新，保留用户自定义内容）
 */
import { BaseAdapter } from "./base.js";
import type { UnifiedConfig, MCPServerConfig } from "../schema.js";
import type { GenerateOptions, GenerateResult, ValidationResult } from "../types.js";
import {
  writeFileContent,
  readFileContent,
  fileExists,
  joinPath,
  ensureDir,
} from "../utils/fileUtils.js";
import { logger } from "../utils/logger.js";
import { expandToolPatterns } from "../toolResolver.js";

// C4A 配置块标记（使用 HTML 注释格式，在 markdown 中不可见）
const C4A_BLOCK_START = "<!-- c4a:start -->";
const C4A_BLOCK_END = "<!-- c4a:end -->";

// C4A 管理的 MCP Server 前缀
const C4A_SERVER_PREFIX = "c4a-";

/**
 * Cursor MCP 配置格式
 */
interface CursorMcpConfig {
  mcpServers: Record<string, CursorMcpServerConfig>;
}

/**
 * Cursor MCP Server 配置格式
 */
interface CursorMcpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export class CursorAdapter extends BaseAdapter {
  readonly platform = "cursor" as const;

  async generate(config: UnifiedConfig, options: GenerateOptions): Promise<GenerateResult> {
    try {
      const outputDir = options.outputDir || process.cwd();
      const outputFiles: string[] = [];

      // 1. 生成 .cursor/mcp.json
      const mcpJsonFile = await this.generateMcpJson(config, outputDir, options.dryRun);
      outputFiles.push(mcpJsonFile);

      // 2. 生成 .cursorrules
      const rulesFile = await this.generateCursorrules(config, outputDir, options.dryRun);
      outputFiles.push(rulesFile);

      return this.createSuccessResult(outputFiles);
    } catch (err) {
      logger.error("生成 Cursor 配置失败:", err);
      return this.createErrorResult([(err as Error).message]);
    }
  }

  /**
   * 生成 .cursor/mcp.json（智能合并）
   *
   * 策略：
   * - 只更新以 c4a- 开头的 server
   * - 保留用户自定义的其他 server
   */
  private async generateMcpJson(
    config: UnifiedConfig,
    outputDir: string,
    dryRun?: boolean
  ): Promise<string> {
    const cursorDir = joinPath(outputDir, ".cursor");
    const mcpJsonPath = joinPath(cursorDir, "mcp.json");

    // 读取现有配置
    let existingConfig: CursorMcpConfig = { mcpServers: {} };
    if (await fileExists(mcpJsonPath)) {
      try {
        const content = await readFileContent(mcpJsonPath);
        existingConfig = JSON.parse(content);
        if (!existingConfig.mcpServers) {
          existingConfig.mcpServers = {};
        }
        logger.debug("读取现有 .cursor/mcp.json 配置");
      } catch (err) {
        logger.warn("解析现有 .cursor/mcp.json 失败，将创建新文件");
        existingConfig = { mcpServers: {} };
      }
    }

    // 移除所有 c4a 管理的 server（以便重新生成）
    for (const name of Object.keys(existingConfig.mcpServers)) {
      if (name.startsWith(C4A_SERVER_PREFIX)) {
        delete existingConfig.mcpServers[name];
      }
    }

    // 添加 c4a 配置的 server
    for (const [name, server] of Object.entries(config.mcpServers)) {
      existingConfig.mcpServers[name] = this.convertToMcpConfig(server);
    }

    const jsonContent = JSON.stringify(existingConfig, null, 2);

    if (!dryRun) {
      await ensureDir(cursorDir);
      await writeFileContent(mcpJsonPath, jsonContent);
      logger.success(`生成 Cursor MCP 配置: ${mcpJsonPath}`);
    } else {
      logger.info("[Dry Run] 将生成:", mcpJsonPath);
      logger.debug(jsonContent);
    }

    return mcpJsonPath;
  }

  /**
   * 将统一配置转换为 Cursor MCP 配置格式
   */
  private convertToMcpConfig(server: MCPServerConfig): CursorMcpServerConfig {
    // HTTP 类型
    if (server.transport === "http") {
      return { url: server.url };
    }

    // stdio 类型 - 使用 ${workspaceFolder} 让路径可移植
    const result: CursorMcpServerConfig = {
      command: server.command,
    };

    if (server.args && server.args.length > 0) {
      result.args = server.args.map((arg) => this.convertToWorkspaceFolder(arg));
    }

    if (server.env && Object.keys(server.env).length > 0) {
      result.env = server.env;
    }

    return result;
  }

  /**
   * 将相对路径转换为 ${workspaceFolder} 形式
   *
   * 转换规则：
   * - ./path -> ${workspaceFolder}/path
   * - 已包含 ${workspaceFolder} 的保持不变
   * - 绝对路径保持不变
   * - 其他参数（如 run 等命令）保持不变
   */
  private convertToWorkspaceFolder(arg: string): string {
    // 如果已经包含 ${workspaceFolder}，保持不变
    if (arg.includes("${workspaceFolder}")) {
      return arg;
    }

    // 如果以 ./ 开头，转换为 ${workspaceFolder}/
    if (arg.startsWith("./")) {
      return "${workspaceFolder}/" + arg.slice(2);
    }

    // 如果是绝对路径，保持不变
    if (arg.startsWith("/")) {
      return arg;
    }

    // 其他情况保持不变（如 run 等命令参数）
    return arg;
  }

  /**
   * 生成 .cursorrules（标记块更新）
   *
   * 策略：
   * - 使用 <!-- c4a:start --> 和 <!-- c4a:end --> 标记 c4a 配置块
   * - 只更新标记块内的内容
   * - 保留用户在标记块外的自定义内容
   */
  private async generateCursorrules(
    config: UnifiedConfig,
    outputDir: string,
    dryRun?: boolean
  ): Promise<string> {
    const rulesPath = joinPath(outputDir, ".cursorrules");

    // 读取现有内容
    let existingContent = "";
    if (await fileExists(rulesPath)) {
      existingContent = await readFileContent(rulesPath);
      logger.debug("读取现有 .cursorrules 文件");
    }

    // 生成 c4a 配置块内容
    const c4aBlock = this.generateC4aBlock(config);

    // 合并内容
    const newContent = this.mergeC4aBlock(existingContent, c4aBlock);

    if (!dryRun) {
      await writeFileContent(rulesPath, newContent);
      logger.success(`生成 Cursor 规则文件: ${rulesPath}`);
    } else {
      logger.info("[Dry Run] 将生成:", rulesPath);
    }

    return rulesPath;
  }

  /**
   * 生成 c4a 配置块内容
   */
  private generateC4aBlock(config: UnifiedConfig): string {
    let content = "";

    // 标题
    content += `# C4A Agent 配置\n\n`;

    // 项目说明
    if (config.instructions.length > 0) {
      content += `## 项目说明\n\n`;
      content += `请参考以下文件了解项目架构和开发规范：\n\n`;
      config.instructions.forEach((file) => {
        content += `- ${file}\n`;
      });
      content += `\n`;
    }

    // MCP 工具列表
    const allTools = new Set<string>();
    for (const agent of Object.values(config.agents)) {
      const expanded = expandToolPatterns(agent.allowedTools);
      expanded.forEach((tool) => allTools.add(tool));
    }

    if (allTools.size > 0) {
      content += `## 可用的 MCP 工具\n\n`;
      Array.from(allTools)
        .sort()
        .forEach((tool) => {
          content += `- ${tool}\n`;
        });
      content += `\n`;
    }

    // MCP Server 配置说明
    content += `## MCP Server 配置\n\n`;
    content += `MCP Server 已自动配置到 \`.cursor/mcp.json\`，包括：\n\n`;
    for (const name of Object.keys(config.mcpServers)) {
      content += `- ${name}\n`;
    }
    content += `\n`;

    // Agent 角色描述
    content += `## Agent 角色\n\n`;
    const defaultAgent = config.agents[config.defaultAgent];
    if (defaultAgent) {
      content += `默认使用 **${config.defaultAgent}** Agent。\n\n`;
      content += `${defaultAgent.description}\n\n`;
      content += `详细提示词参考: ${defaultAgent.promptFile}\n\n`;
    }

    // 其他 Agent
    const otherAgents = Object.entries(config.agents).filter(
      ([name]) => name !== config.defaultAgent
    );
    if (otherAgents.length > 0) {
      content += `### 其他可用 Agent\n\n`;
      otherAgents.forEach(([name, agent]) => {
        content += `- **${name}**: ${agent.description} (${agent.promptFile})\n`;
      });
      content += `\n`;
    }

    return content;
  }

  /**
   * 合并 c4a 配置块到现有内容
   */
  private mergeC4aBlock(existingContent: string, c4aBlock: string): string {
    const wrappedBlock = `${C4A_BLOCK_START}\n${c4aBlock}${C4A_BLOCK_END}`;

    // 如果没有现有内容，直接返回 c4a 块
    if (!existingContent.trim()) {
      return wrappedBlock + "\n";
    }

    // 检查是否存在 c4a 配置块
    const startIndex = existingContent.indexOf(C4A_BLOCK_START);
    const endIndex = existingContent.indexOf(C4A_BLOCK_END);

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      // 替换现有的 c4a 配置块
      const before = existingContent.slice(0, startIndex);
      const after = existingContent.slice(endIndex + C4A_BLOCK_END.length);
      return before.trimEnd() + (before.trim() ? "\n\n" : "") + wrappedBlock + after;
    }

    // 没有现有的 c4a 配置块，追加到文件末尾
    return existingContent.trimEnd() + "\n\n" + wrappedBlock + "\n";
  }

  async validate(outputDir: string): Promise<ValidationResult> {
    const mcpJsonPath = joinPath(outputDir, ".cursor", "mcp.json");
    const rulesPath = joinPath(outputDir, ".cursorrules");
    const errors: string[] = [];

    // 检查 .cursor/mcp.json
    if (!(await fileExists(mcpJsonPath))) {
      errors.push(`Cursor MCP 配置文件不存在: ${mcpJsonPath}`);
    } else {
      try {
        const content = await readFileContent(mcpJsonPath);
        const config = JSON.parse(content);
        if (!config.mcpServers || typeof config.mcpServers !== "object") {
          errors.push(`${mcpJsonPath}: 缺少 mcpServers 字段`);
        }
      } catch (err) {
        errors.push(`${mcpJsonPath}: JSON 格式无效 - ${(err as Error).message}`);
      }
    }

    // 检查 .cursorrules
    if (!(await fileExists(rulesPath))) {
      errors.push(`Cursor 规则文件不存在: ${rulesPath}`);
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true };
  }
}
