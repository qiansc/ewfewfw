/**
 * OpenCode 适配器
 */
import { BaseAdapter } from "./base.js";
import type { UnifiedConfig, SkillConfig } from "../schema.js";
import type { GenerateOptions, GenerateResult, ValidationResult, OpencodeConfig, OpencodeProviderConfig } from "../types.js";
import { writeFileContent, fileExists, joinPath, readFileContent, ensureDir, cleanByPrefix } from "../utils/fileUtils.js";
import { dirname } from "node:path";
import { logger } from "../utils/logger.js";
import { expandToolPatterns } from "../toolResolver.js";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

/**
 * 解析 .env 文件内容
 */
function parseEnvFile(envPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(envPath)) {
    return env;
  }

  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      env[key] = value;
    }
  }
  return env;
}

/**
 * 从 .env 文件读取 provider 配置
 */
function loadProviderConfig(outputDir: string): Record<string, OpencodeProviderConfig> | undefined {
  const envPath = joinPath(outputDir, ".env");
  const env = parseEnvFile(envPath);

  const providers: Record<string, OpencodeProviderConfig> = {};

  // 检查 Anthropic 配置
  const anthropicAuthToken = env["ANTHROPIC_AUTH_TOKEN"];
  const anthropicBaseUrl = env["ANTHROPIC_BASE_URL"];

  if (anthropicAuthToken && anthropicBaseUrl) {
    // 拼接 baseURL，支持 ANTHROPIC_BASE_URL_VERSION
    const baseUrlVersion = env["ANTHROPIC_BASE_URL_VERSION"] || "";
    const fullBaseUrl = anthropicBaseUrl.replace(/\/+$/, "") + baseUrlVersion;

    const anthropicConfig: OpencodeProviderConfig = {
      options: {
        apiKey: anthropicAuthToken,
        baseURL: fullBaseUrl,
        model: env["ANTHROPIC_MODEL"],
      },
    };

    providers["anthropic"] = anthropicConfig;
    logger.info("检测到 Anthropic 配置，已添加到 provider");
  }

  return Object.keys(providers).length > 0 ? providers : undefined;
}

/**
 * 解析命令路径，处理常见工具的路径查找
 */
function resolveCommandPath(command: string): string {
  // 如果已经是绝对路径，直接返回
  if (command.startsWith("/")) {
    return command;
  }

  // 常见工具的默认安装路径
  const toolPaths: Record<string, string[]> = {
    bun: [`${homedir()}/.bun/bin/bun`],
    node: [`${homedir()}/.nvm/current/bin/node`, "/usr/local/bin/node"],
    npm: [`${homedir()}/.nvm/current/bin/npm`, "/usr/local/bin/npm"],
    npx: [`${homedir()}/.nvm/current/bin/npx`, "/usr/local/bin/npx"],
    uv: [`${homedir()}/.local/bin/uv`],
    python: [`${homedir()}/.local/bin/python`, "/usr/bin/python3"],
  };

  const paths = toolPaths[command];
  if (paths) {
    for (const p of paths) {
      if (existsSync(p)) {
        return p;
      }
    }
  }

  // 找不到则返回原命令，依赖 PATH 环境变量
  return command;
}

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
 * 生成单个命令的 Markdown 文件内容
 * OpenCode 命令文件格式：YAML frontmatter + prompt content
 */
function generateCommandMarkdown(name: string, skill: ResolvedSkill): string {
  let md = "---\n";
  md += `description: ${skill.description}\n`;
  md += "---\n\n";

  // 添加命令标题和工具说明
  if (skill.tools && skill.tools.length > 0) {
    md += `**使用工具**: \`${skill.tools.join("`, `")}\`\n\n`;
  }

  // 如果有参数，用 $ARGUMENTS 替换
  if (skill.args) {
    md += `**参数**: ${skill.args}\n\n`;
  }

  md += skill.prompt;

  return md;
}

export class OpencodeAdapter extends BaseAdapter {
  readonly platform = "opencode" as const;

  async generate(config: UnifiedConfig, options: GenerateOptions): Promise<GenerateResult> {
    try {
      const outputDir = options.outputDir || process.cwd();
      const configDir = joinPath(outputDir, ".opencode");
      const configFile = joinPath(configDir, "opencode.json");
      const outputFiles: string[] = [];

      // 加载 provider 配置
      const providerConfig = loadProviderConfig(outputDir);

      // 转换为 OpenCode 格式
      const opencodeConfig: OpencodeConfig = {
        $schema: "https://opencode.ai/config.json",
        provider: providerConfig,
        instructions: [...config.instructions],
        mcp: {},
        agent: {},
        default_agent: config.defaultAgent,
      };

      // 处理 Skills（生成命令文件到 .opencode/command/）
      // 支持嵌套目录结构：c4a/adr/draft → .opencode/command/c4a/adr/draft.md
      if (config.skills && Object.keys(config.skills).length > 0) {
        // 解析 skills，读取 promptFile 内容
        const resolvedSkills = await resolveSkills(config.skills, outputDir);
        const commandDir = joinPath(configDir, "command");

        // 先清理旧的 c4a 目录（嵌套结构）
        if (!options.dryRun) {
          const removed = await cleanByPrefix(commandDir, "c4a");
          if (removed.length > 0) {
            logger.info(`清理旧的 c4a 命令文件/目录: ${removed.length} 个`);
          }
        }

        // 生成每个 skill 对应的命令文件
        // 支持嵌套目录：c4a/adr/draft → command/c4a/adr/draft.md
        await ensureDir(commandDir);
        for (const [name, skill] of Object.entries(resolvedSkills)) {
          // skill 名称可能是 "c4a/adr/draft" 格式
          // 转换为文件路径：command/c4a/adr/draft.md
          const commandFile = joinPath(commandDir, name + ".md");

          // 确保父目录存在
          const parentDir = dirname(commandFile);
          await ensureDir(parentDir);

          const commandContent = generateCommandMarkdown(name, skill);

          if (!options.dryRun) {
            await writeFileContent(commandFile, commandContent);
            logger.success(`生成 OpenCode 命令: ${commandFile}`);
          } else {
            logger.info("[Dry Run] 将生成:", commandFile);
          }
          outputFiles.push(commandFile);
        }
      }

      // 转换 MCP Servers
      for (const [name, server] of Object.entries(config.mcpServers)) {
        if (server.transport === "stdio") {
          // OpenCode 期望 command 是数组格式 [cmd, arg1, arg2, ...]
          const resolvedCommand = resolveCommandPath(server.command!);
          const commandArray = [resolvedCommand, ...(server.args || [])];
          opencodeConfig.mcp[name] = {
            type: "local",
            command: commandArray,
          };
        } else if (server.transport === "http") {
          opencodeConfig.mcp[name] = {
            type: "remote",
            url: server.url!,
          };
        }
      }

      // 转换 Agents
      for (const [name, agent] of Object.entries(config.agents)) {
        const expandedDenied = expandToolPatterns(agent.deniedTools);

        // 构建 permission 对象
        const permission: Record<string, "allow" | "deny"> = {};

        // 先处理 allowed（支持通配符）
        for (const tool of agent.allowedTools) {
          permission[tool] = "allow";
        }

        // 再处理 denied
        for (const tool of expandedDenied) {
          permission[tool] = "deny";
        }

        opencodeConfig.agent[name] = {
          mode: agent.mode || "subagent",
          prompt: agent.promptFile,
          permission: Object.keys(permission).length > 0 ? permission : undefined,
          subagents: agent.subagents,
        };
      }

      // 写入文件
      if (!options.dryRun) {
        const content = JSON.stringify(opencodeConfig, null, 2);
        await writeFileContent(configFile, content);
        logger.success(`生成 OpenCode 配置: ${configFile}`);
      } else {
        logger.info("[Dry Run] 将生成:", configFile);
      }

      outputFiles.push(configFile);
      return this.createSuccessResult(outputFiles);
    } catch (err) {
      logger.error("生成 OpenCode 配置失败:", err);
      return this.createErrorResult([(err as Error).message]);
    }
  }

  async validate(outputDir: string): Promise<ValidationResult> {
    const configFile = joinPath(outputDir, ".opencode", "opencode.json");

    if (!(await fileExists(configFile))) {
      return {
        valid: false,
        errors: [`OpenCode 配置文件不存在: ${configFile}`],
      };
    }

    try {
      const content = await readFileContent(configFile);
      JSON.parse(content); // 验证 JSON 语法
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        errors: [`OpenCode 配置文件格式错误: ${(err as Error).message}`],
      };
    }
  }
}
