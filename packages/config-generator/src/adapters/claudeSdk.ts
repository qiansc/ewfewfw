/**
 * Claude SDK 适配器
 */
import { BaseAdapter } from "./base.js";
import type { UnifiedConfig, SkillConfig } from "../schema.js";
import type { GenerateOptions, GenerateResult, ValidationResult } from "../types.js";
import { writeFileContent, fileExists, joinPath, readFileContent, ensureDir, cleanByPrefix } from "../utils/fileUtils.js";
import { dirname } from "node:path";
import { logger } from "../utils/logger.js";
import { expandToolPatterns, toClaudeSdkToolNames } from "../toolResolver.js";

/**
 * 解析后的 Skill（prompt 已读取）
 */
interface ResolvedSkill {
  description: string;
  category: string;
  args?: string;
  prompt: string;
  tools?: string[];
}

/**
 * 解析 Skills 配置，读取 promptFile 内容
 */
async function resolveSkills(
  skills: Record<string, SkillConfig>,
  baseDir: string
): Promise<Record<string, ResolvedSkill>> {
  const resolved: Record<string, ResolvedSkill> = {};

  for (const [name, skill] of Object.entries(skills)) {
    let prompt: string;

    if (skill.promptFile) {
      // 从文件读取 prompt
      const promptPath = joinPath(baseDir, skill.promptFile);
      try {
        prompt = await readFileContent(promptPath);
      } catch (err) {
        throw new Error(`无法读取 Skill '${name}' 的 promptFile: ${promptPath}`);
      }
    } else {
      prompt = skill.prompt || "";
    }

    resolved[name] = {
      description: skill.description,
      category: skill.category,
      args: skill.args,
      prompt,
      tools: skill.tools,
    };
  }

  return resolved;
}

/**
 * 生成单个 Command 的 Markdown 文件内容
 * Claude Code Slash Commands 格式：YAML frontmatter + prompt content
 * 参考: https://code.claude.com/docs/en/slash-commands.md
 */
function generateCommandContent(_name: string, skill: ResolvedSkill): string {
  // YAML frontmatter
  let md = "---\n";
  md += `description: ${skill.description}\n`;

  // 如果有参数，添加 argument-hint
  if (skill.args) {
    md += `argument-hint: ${skill.args}\n`;
  }

  md += "---\n\n";

  // 工具说明
  if (skill.tools && skill.tools.length > 0) {
    md += `**使用工具**: \`${skill.tools.join("`, `")}\`\n\n`;
  }

  // 参数说明（作为正文的一部分）
  if (skill.args) {
    md += `**参数**: ${skill.args}\n\n`;
  }

  md += skill.prompt;

  return md;
}

/**
 * MCP 服务器配置（用于 .mcp.json）
 */
interface McpJsonConfig {
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> } | { type: "http"; url: string }>;
}

/**
 * 权限配置（用于 .claude/settings.json）
 */
interface SettingsJsonConfig {
  permissions: {
    allow: string[];
    deny: string[];
  };
}

export class ClaudeSdkAdapter extends BaseAdapter {
  readonly platform = "claude-sdk" as const;

  async generate(config: UnifiedConfig, options: GenerateOptions): Promise<GenerateResult> {
    try {
      const outputDir = options.outputDir || process.cwd();
      const configDir = joinPath(outputDir, ".claude");
      const settingsFile = joinPath(configDir, "settings.json");
      const mcpJsonFile = joinPath(outputDir, ".mcp.json");
      const commandsDir = joinPath(configDir, "commands");
      const outputFiles: string[] = [];

      // 1. 生成 .mcp.json（MCP 服务器配置）
      // 读取现有配置，保留用户自定义的 MCP 服务器
      let existingMcpConfig: McpJsonConfig = { mcpServers: {} };
      if (await fileExists(mcpJsonFile)) {
        try {
          const existingContent = await readFileContent(mcpJsonFile);
          existingMcpConfig = JSON.parse(existingContent);
        } catch {
          logger.warn("读取现有 .mcp.json 失败，将创建新文件");
        }
      }

      // 收集本次生成的 MCP 服务器名称
      const generatedServerNames = new Set<string>();

      for (const [name, server] of Object.entries(config.mcpServers)) {
        generatedServerNames.add(name);
        if (server.transport === "stdio") {
          existingMcpConfig.mcpServers[name] = {
            command: server.command!,
            args: server.args,
            env: server.env,
          };
        } else if (server.transport === "http" && server.url) {
          // HTTP 传输
          existingMcpConfig.mcpServers[name] = {
            type: "http",
            url: server.url,
          };
        } else {
          logger.warn(`未知的 MCP 传输类型，跳过: ${name}`);
        }
      }

      if (!options.dryRun) {
        const mcpContent = JSON.stringify(existingMcpConfig, null, 2);
        await writeFileContent(mcpJsonFile, mcpContent);
        logger.success(`生成 MCP 配置: ${mcpJsonFile}（保留用户自定义服务器）`);
      } else {
        logger.info("[Dry Run] 将生成:", mcpJsonFile);
      }
      outputFiles.push(mcpJsonFile);

      // 2. 生成 .claude/settings.json（权限配置）
      const allAllowed = new Set<string>();
      const allDenied = new Set<string>();

      for (const agent of Object.values(config.agents)) {
        const expanded = expandToolPatterns(agent.allowedTools);
        const converted = toClaudeSdkToolNames(expanded);
        converted.forEach((tool) => allAllowed.add(tool));

        const deniedExpanded = expandToolPatterns(agent.deniedTools);
        const deniedConverted = toClaudeSdkToolNames(deniedExpanded);
        deniedConverted.forEach((tool) => allDenied.add(tool));
      }

      const settingsConfig: SettingsJsonConfig = {
        permissions: {
          allow: Array.from(allAllowed).sort(),
          deny: Array.from(allDenied).sort(),
        },
      };

      if (!options.dryRun) {
        await ensureDir(configDir);
        const settingsContent = JSON.stringify(settingsConfig, null, 2);
        await writeFileContent(settingsFile, settingsContent);
        logger.success(`生成 Claude SDK 权限配置: ${settingsFile}`);
      } else {
        logger.info("[Dry Run] 将生成:", settingsFile);
      }
      outputFiles.push(settingsFile);

      // 3. 生成 Slash Commands 命令文件（基于 config.skills）
      if (config.skills && Object.keys(config.skills).length > 0) {
        await ensureDir(commandsDir);

        // 先清理旧的 c4a 目录（嵌套结构）
        if (!options.dryRun) {
          const removed = await cleanByPrefix(commandsDir, "c4a");
          if (removed.length > 0) {
            logger.info(`清理旧的 c4a command 文件/目录: ${removed.length} 个`);
          }
        }

        // 解析 skills，读取 promptFile 内容
        const resolvedSkills = await resolveSkills(config.skills, outputDir);

        // 为每个 skill 生成命令文件
        for (const [name, skill] of Object.entries(resolvedSkills)) {
          const commandFile = joinPath(commandsDir, name + ".md");

          // 确保父目录存在
          const parentDir = dirname(commandFile);
          await ensureDir(parentDir);

          const content = generateCommandContent(name, skill);

          if (!options.dryRun) {
            await writeFileContent(commandFile, content);
            logger.success(`生成 Claude Code Command: ${commandFile}`);
          } else {
            logger.info("[Dry Run] 将生成:", commandFile);
          }
          outputFiles.push(commandFile);
        }
      }

      return this.createSuccessResult(outputFiles);
    } catch (err) {
      logger.error("生成 Claude SDK 配置失败:", err);
      return this.createErrorResult([(err as Error).message]);
    }
  }

  async validate(outputDir: string): Promise<ValidationResult> {
    const settingsFile = joinPath(outputDir, ".claude", "settings.json");
    const mcpJsonFile = joinPath(outputDir, ".mcp.json");
    const errors: string[] = [];

    // 验证 .mcp.json
    if (!(await fileExists(mcpJsonFile))) {
      errors.push(`MCP 配置文件不存在: ${mcpJsonFile}`);
    } else {
      try {
        const content = await readFileContent(mcpJsonFile);
        JSON.parse(content);
      } catch (err) {
        errors.push(`MCP 配置文件格式错误: ${(err as Error).message}`);
      }
    }

    // 验证 .claude/settings.json
    if (!(await fileExists(settingsFile))) {
      errors.push(`Claude SDK 权限配置文件不存在: ${settingsFile}`);
    } else {
      try {
        const content = await readFileContent(settingsFile);
        JSON.parse(content);
      } catch (err) {
        errors.push(`Claude SDK 权限配置文件格式错误: ${(err as Error).message}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
